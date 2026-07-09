package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// withFakePIDAlive overrides isPIDAlive for the duration of a test, restoring
// the real implementation on cleanup.
func withFakePIDAlive(t *testing.T, fn func(pid int) bool) {
	t.Helper()
	orig := isPIDAlive
	isPIDAlive = fn
	t.Cleanup(func() { isPIDAlive = orig })
}

func writeGitSyncLock(t *testing.T, dir string, info gitSyncLockInfo) {
	t.Helper()
	lockDir := filepath.Join(dir, gitSyncLockDir)
	if err := os.MkdirAll(lockDir, 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(lockDir, gitSyncLockName), data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestAcquireGitSyncLock_HappyPathRoundTrip covers the basic contract: lock,
// see the file exist with our PID, release, see it gone, lock again.
func TestAcquireGitSyncLock_HappyPathRoundTrip(t *testing.T) {
	dir := t.TempDir()
	release, err := acquireGitSyncLock(dir)
	if err != nil {
		t.Fatalf("expected the first acquire to succeed, got %v", err)
	}
	lockPath := filepath.Join(dir, gitSyncLockDir, gitSyncLockName)
	info, readErr := readGitSyncLockInfo(lockPath)
	if readErr != nil {
		t.Fatalf("expected a readable lock file, got %v", readErr)
	}
	if info.PID != os.Getpid() {
		t.Errorf("expected lock to carry our own pid %d, got %d", os.Getpid(), info.PID)
	}
	release()
	if _, err := os.Stat(lockPath); !os.IsNotExist(err) {
		t.Errorf("expected the lock file to be removed after release, stat err: %v", err)
	}

	release2, err := acquireGitSyncLock(dir)
	if err != nil {
		t.Fatalf("expected re-acquire after release to succeed, got %v", err)
	}
	release2()
}

// TestAcquireGitSyncLock_BusyWhenHolderAlive is the fail-fast contract for
// item 2: a live holder (our own real, alive PID) must be rejected
// immediately, never blocked/waited on.
func TestAcquireGitSyncLock_BusyWhenHolderAlive(t *testing.T) {
	dir := t.TempDir()
	hostname, _ := os.Hostname()
	writeGitSyncLock(t, dir, gitSyncLockInfo{
		PID:        os.Getpid(), // the test process itself: guaranteed alive
		Hostname:   hostname,
		AcquiredAt: time.Now().UTC(),
	})

	start := time.Now()
	_, err := acquireGitSyncLock(dir)
	elapsed := time.Since(start)

	if !errors.Is(err, ErrGitSyncLocked) {
		t.Fatalf("expected ErrGitSyncLocked, got %v", err)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("expected acquire to fail fast (no wait/backoff loop), took %v", elapsed)
	}
}

// TestAcquireGitSyncLock_StealsDeadSameHostPID: a same-host lock whose PID is
// no longer alive is stale debris from a crashed daemon and must be stolen.
func TestAcquireGitSyncLock_StealsDeadSameHostPID(t *testing.T) {
	dir := t.TempDir()
	hostname, _ := os.Hostname()
	writeGitSyncLock(t, dir, gitSyncLockInfo{
		PID:        999999, // arbitrary; made "dead" via the injected fake below
		Hostname:   hostname,
		AcquiredAt: time.Now().UTC(), // fresh — only PID-deadness should trigger the steal
	})
	withFakePIDAlive(t, func(pid int) bool { return false })

	release, err := acquireGitSyncLock(dir)
	if err != nil {
		t.Fatalf("expected a dead-PID lock to be stolen, got %v", err)
	}
	defer release()

	info, readErr := readGitSyncLockInfo(filepath.Join(dir, gitSyncLockDir, gitSyncLockName))
	if readErr != nil {
		t.Fatalf("expected a readable lock file after steal, got %v", readErr)
	}
	if info.PID != os.Getpid() {
		t.Errorf("expected the stolen lock to now carry our pid, got %d", info.PID)
	}
}

// TestAcquireGitSyncLock_StealsExpiredTTL: a same-host lock past
// gitSyncLockTTL is stolen even if its PID looks alive (matches the
// TTL-as-backstop design: PID recycling by an unrelated process).
func TestAcquireGitSyncLock_StealsExpiredTTL(t *testing.T) {
	dir := t.TempDir()
	hostname, _ := os.Hostname()
	writeGitSyncLock(t, dir, gitSyncLockInfo{
		PID:        os.Getpid(), // genuinely alive — TTL alone must still steal
		Hostname:   hostname,
		AcquiredAt: time.Now().UTC().Add(-2 * gitSyncLockTTL),
	})

	release, err := acquireGitSyncLock(dir)
	if err != nil {
		t.Fatalf("expected a TTL-expired lock to be stolen, got %v", err)
	}
	release()
}

// TestAcquireGitSyncLock_NeverStealsForeignHost: a lock written by a
// different hostname is never stolen, even when it looks dead and expired —
// Syncthing (ADR-0013) can replicate a still-live remote daemon's lock file
// into this vault, and PID liveness cannot be verified across machines.
func TestAcquireGitSyncLock_NeverStealsForeignHost(t *testing.T) {
	dir := t.TempDir()
	writeGitSyncLock(t, dir, gitSyncLockInfo{
		PID:        999999,
		Hostname:   "some-other-host-xyz",
		AcquiredAt: time.Now().UTC().Add(-2 * gitSyncLockTTL), // old AND "dead" pid
	})
	withFakePIDAlive(t, func(pid int) bool { return false })

	_, err := acquireGitSyncLock(dir)
	if !errors.Is(err, ErrGitSyncLocked) {
		t.Fatalf("expected a foreign-host lock to never be stolen, got %v", err)
	}
}

// TestAcquireGitSyncLock_CorruptFileIsStale: an unparseable lock file cannot
// be verified and must be treated as stale debris, not a permanent wedge.
func TestAcquireGitSyncLock_CorruptFileIsStale(t *testing.T) {
	dir := t.TempDir()
	lockDir := filepath.Join(dir, gitSyncLockDir)
	if err := os.MkdirAll(lockDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(lockDir, gitSyncLockName), []byte("not json {{"), 0o644); err != nil {
		t.Fatal(err)
	}

	release, err := acquireGitSyncLock(dir)
	if err != nil {
		t.Fatalf("expected a corrupt lock file to be treated as stale, got %v", err)
	}
	release()
}

// TestGitSyncWith_CrossProcessLockBlocksSecondInstance is the end-to-end
// regression test for item 2: a "second instance" (simulated by pre-creating
// the lock with our own live pid) must make gitSyncWith fail fast without
// running any git commands and without recording a sync failure (busy is
// expected contention, not a real failure).
func TestGitSyncWith_CrossProcessLockBlocksSecondInstance(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	hostname, _ := os.Hostname()
	writeGitSyncLock(t, dir, gitSyncLockInfo{
		PID:        os.Getpid(),
		Hostname:   hostname,
		AcquiredAt: time.Now().UTC(),
	})

	r := newFakeRunner()
	err := gitSyncWith(context.Background(), discardLogger(), dir, r)
	if !errors.Is(err, ErrSyncBusy) {
		t.Fatalf("expected ErrSyncBusy (wrapping ErrGitSyncLocked), got %v", err)
	}
	if !errors.Is(err, ErrGitSyncLocked) {
		t.Fatalf("expected the error to also unwrap to ErrGitSyncLocked, got %v", err)
	}
	if len(r.calls) != 0 {
		t.Errorf("expected no git commands to run when the cross-process lock is busy, got: %v", r.calls)
	}
	if s := readState(); s.ConsecutiveSyncFailures != 0 {
		t.Errorf("a busy cross-process lock must not count as a sync failure, got %d", s.ConsecutiveSyncFailures)
	}
}
