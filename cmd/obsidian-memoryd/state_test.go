package main

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// withTempStateDir redirects state file writes to a fresh tmp dir per test.
// Goes through stateDirOverride because xdg.StateFile caches XDG_STATE_HOME
// at package init and doesn't notice test-time env changes.
func withTempStateDir(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	stateDirOverride = dir
	t.Cleanup(func() { stateDirOverride = "" })
}

func TestStateRoundTrip(t *testing.T) {
	withTempStateDir(t)
	s1 := &DaemonState{
		Heartbeat:               time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		LastPush:                time.Date(2026, 1, 2, 3, 0, 0, 0, time.UTC),
		ConsecutivePushFailures: 2,
	}
	if err := writeState(s1); err != nil {
		t.Fatal(err)
	}
	s2 := readState()
	if !s1.Heartbeat.Equal(s2.Heartbeat) {
		t.Errorf("heartbeat: %v vs %v", s1.Heartbeat, s2.Heartbeat)
	}
	if !s1.LastPush.Equal(s2.LastPush) {
		t.Errorf("last push: %v vs %v", s1.LastPush, s2.LastPush)
	}
	if s2.ConsecutivePushFailures != 2 {
		t.Errorf("failures: got %d", s2.ConsecutivePushFailures)
	}
}

func TestUpdateStateConcurrent(t *testing.T) {
	withTempStateDir(t)
	const goroutines = 20
	const incrementsPer = 5
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < incrementsPer; j++ {
				_ = updateState(func(s *DaemonState) {
					s.ConsecutivePushFailures++
				})
			}
		}()
	}
	wg.Wait()
	s := readState()
	want := goroutines * incrementsPer
	if s.ConsecutivePushFailures != want {
		t.Errorf("expected %d, got %d (lost updates → race)", want, s.ConsecutivePushFailures)
	}
}

func TestReadStateMissingFile(t *testing.T) {
	withTempStateDir(t)
	s := readState()
	if !s.Heartbeat.IsZero() {
		t.Error("missing file should yield zero state, got non-zero heartbeat")
	}
}

func TestReadStateCorruptFile(t *testing.T) {
	withTempStateDir(t)
	// Corrupt the state file deliberately.
	if err := writeState(&DaemonState{Heartbeat: time.Now()}); err != nil {
		t.Fatal(err)
	}
	// Overwrite with garbage.
	fp := stateFilePath()
	if err := overwriteFile(fp, []byte("not json {{")); err != nil {
		t.Fatal(err)
	}
	s := readState()
	if !s.Heartbeat.IsZero() {
		t.Errorf("corrupt file should reset to zero state, got %v", s.Heartbeat)
	}
}

func TestStaleHeartbeatBoundaries(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	zero := &DaemonState{}
	if staleHeartbeat(zero, now, time.Minute) {
		t.Error("zero heartbeat should not be considered stale")
	}
	fresh := &DaemonState{Heartbeat: now.Add(-30 * time.Second)}
	if staleHeartbeat(fresh, now, time.Minute) {
		t.Error("30s old should not be stale at 1m threshold")
	}
	old := &DaemonState{Heartbeat: now.Add(-2 * time.Minute)}
	if !staleHeartbeat(old, now, time.Minute) {
		t.Error("2m old should be stale at 1m threshold")
	}
}

func TestDoctorHealthy(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat: now.Add(-30 * time.Second),
		LastPush:  now.Add(-2 * time.Minute),
	})
	var buf bytes.Buffer
	if err := doctor(&buf, "", now); err != nil {
		t.Fatalf("healthy doctor should return nil, got %v", err)
	}
	out := buf.String()
	for _, want := range []string{"obsidian-memoryd doctor", "heartbeat:", "30s ago", "last successful push", "2m0s ago"} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q\n---\n%s", want, out)
		}
	}
}

func TestDoctorStaleHeartbeat(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat: now.Add(-10 * time.Minute), // stale
	})
	var buf bytes.Buffer
	err := doctor(&buf, "", now)
	if !errors.Is(err, ErrDoctorAlarm) {
		t.Fatalf("stale heartbeat should trigger alarm, got %v", err)
	}
	if !strings.Contains(buf.String(), "daemon may be stopped") {
		t.Errorf("output missing stale marker\n---\n%s", buf.String())
	}
}

func TestDoctorPushFailures(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat:               now.Add(-30 * time.Second),
		ConsecutivePushFailures: 4,
	})
	var buf bytes.Buffer
	err := doctor(&buf, "", now)
	if !errors.Is(err, ErrDoctorAlarm) {
		t.Fatalf("4 consecutive push failures should trigger alarm, got %v", err)
	}
	if !strings.Contains(buf.String(), "consecutive push fails:   4") {
		t.Errorf("output missing failure count\n---\n%s", buf.String())
	}
}

// TestDoctorRebaseAbortFailed verifies a FAILED abort attempt alarms doctor
// with a distinct message from a successful one — the worktree may still be
// sitting mid-rebase, which must never be reported as resolved.
func TestDoctorRebaseAbortFailed(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat:               now.Add(-30 * time.Second),
		LastRebaseAbortFailedAt: now.Add(-2 * time.Minute),
	})
	var buf bytes.Buffer
	err := doctor(&buf, "", now)
	if !errors.Is(err, ErrDoctorAlarm) {
		t.Fatalf("a failed rebase abort should trigger alarm, got %v", err)
	}
	if !strings.Contains(buf.String(), "rebase abort FAILED") {
		t.Errorf("output missing abort-failed marker\n---\n%s", buf.String())
	}
}

// TestRecordRebaseAbortClearsFailureFlag verifies a later SUCCESSFUL abort
// clears any earlier failure marker, and vice versa a failure never sets the
// success timestamp — the two signals must stay mutually exclusive.
func TestRecordRebaseAbortClearsFailureFlag(t *testing.T) {
	withTempStateDir(t)
	recordRebaseAbortFailure()
	if s := readState(); s.LastRebaseAbortFailedAt.IsZero() {
		t.Fatal("expected LastRebaseAbortFailedAt to be set")
	}
	recordRebaseAbort()
	s := readState()
	if s.LastRebaseAbort.IsZero() {
		t.Error("expected LastRebaseAbort to be set after a successful abort")
	}
	if !s.LastRebaseAbortFailedAt.IsZero() {
		t.Error("a successful abort must clear a prior failure marker")
	}
}

func TestTruncateStringIsRuneSafe(t *testing.T) {
	got := truncateString("código está OK", 5)
	if r := []rune(strings.TrimSuffix(got, "...")); len(r) != 5 {
		t.Errorf("expected exactly 5 runes before the ellipsis, got %d (%q)", len(r), got)
	}
}

// TestDoctorSyncFailures is the health-fix regression test: a vault with a FRESH
// heartbeat and ZERO push failures, but repeated sync failures (e.g. a stuck
// pull), must alarm — before the fix this state reported perfectly healthy.
func TestDoctorSyncFailures(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat:               now.Add(-30 * time.Second), // fresh — daemon is alive
		ConsecutivePushFailures: 0,                          // push never even ran
		ConsecutiveSyncFailures: 3,
		LastSyncError:           "git pull --rebase: auth failed",
		LastSyncErrorAt:         now.Add(-1 * time.Minute),
	})
	var buf bytes.Buffer
	err := doctor(&buf, "", now)
	if !errors.Is(err, ErrDoctorAlarm) {
		t.Fatalf("3 consecutive sync failures should trigger alarm, got %v", err)
	}
	out := buf.String()
	for _, want := range []string{"consecutive sync fails:   3", "vault not syncing", "last sync error:"} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q\n---\n%s", want, out)
		}
	}
}

// TestDoctorRebaseAbortAlarms is the regression test for the alarm blind spot:
// LastRebaseAbort was recorded and displayed with a warning glyph, but never
// fed into the `alarm` bool — a vault stuck on a stale rebase abort, with a
// fresh heartbeat and zero failure counters, used to report perfectly
// healthy.
func TestDoctorRebaseAbortAlarms(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat:       now.Add(-30 * time.Second), // fresh
		LastRebaseAbort: now.Add(-2 * time.Minute),
	})
	var buf bytes.Buffer
	err := doctor(&buf, "", now)
	if !errors.Is(err, ErrDoctorAlarm) {
		t.Fatalf("a recorded rebase abort should trigger alarm, got %v", err)
	}
	if !strings.Contains(buf.String(), "last rebase abort:") {
		t.Errorf("output missing rebase abort line\n---\n%s", buf.String())
	}
}

// TestRecordSyncSuccessClearsRebaseAbort proves a subsequent successful sync
// clears a historical rebase abort, so it does not alarm forever after one
// resolved divergence.
func TestRecordSyncSuccessClearsRebaseAbort(t *testing.T) {
	withTempStateDir(t)
	_ = writeState(&DaemonState{LastRebaseAbort: time.Now().UTC()})
	recordSyncSuccess()
	s := readState()
	if !s.LastRebaseAbort.IsZero() {
		t.Errorf("expected LastRebaseAbort cleared after a successful sync, got %v", s.LastRebaseAbort)
	}
}

// TestDoctorAlarmsOnWatchStartFailureEvenWithZeroHeartbeat is the regression
// test for item 4: a watcher that fails to start never writes a heartbeat
// (that happens later in runWatchWith), so a zero heartbeat alone is NOT
// stale and used to leave `doctor` reporting healthy while the watch
// goroutine was actually dead.
func TestDoctorAlarmsOnWatchStartFailureEvenWithZeroHeartbeat(t *testing.T) {
	withTempStateDir(t)
	recordWatchStartFailure(errors.New("too many open files"))
	var buf bytes.Buffer
	err := doctor(&buf, "", time.Now().UTC())
	if !errors.Is(err, ErrDoctorAlarm) {
		t.Fatalf("a watch-start failure should alarm doctor even with a zero heartbeat, got %v", err)
	}
	out := buf.String()
	for _, want := range []string{"watcher start failed:", "too many open files"} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q\n---\n%s", want, out)
		}
	}
}

// syncTrackingWriter records writes and whether/when Sync() was called, so
// tests can prove doctor flushes its writer before returning (item 5).
type syncTrackingWriter struct {
	buf              bytes.Buffer
	syncCalled       bool
	writesBeforeSync int
}

func (w *syncTrackingWriter) Write(p []byte) (int, error) {
	if !w.syncCalled {
		w.writesBeforeSync++
	}
	return w.buf.Write(p)
}

func (w *syncTrackingWriter) Sync() error {
	w.syncCalled = true
	return nil
}

// TestDoctorFlushesWriterBeforeReturning: doctor's real root-cause fix for the
// broken -H windowsgui exit-code/output ordering is documented (PowerShell
// does not wait for a GUI-subsystem child process unless output is
// redirected — see docs/en/troubleshooting.md), since that is shell behavior
// outside this process's control. This test covers the defensive code-side
// half: whatever doctor writes to must be flushed before the function
// returns.
func TestDoctorFlushesWriterBeforeReturning(t *testing.T) {
	withTempStateDir(t)
	w := &syncTrackingWriter{}
	_ = doctor(w, "", time.Now().UTC())
	if !w.syncCalled {
		t.Fatal("expected doctor to Sync() its writer before returning")
	}
	if w.writesBeforeSync == 0 {
		t.Error("expected at least one write to have happened before Sync was called")
	}
}

// TestRecordConflictFile: the watcher's sighting must round-trip through state
// (basename only) and surface in doctor as a warning line — without alarming,
// since a conflict file is a "human should look" signal, not a daemon failure.
func TestRecordConflictFile(t *testing.T) {
	withTempStateDir(t)
	recordConflictFile("/some/vault/notes/MEMORY.sync-conflict-20260706-120000-ABCDEF.md")
	s := readState()
	if s.LastConflictFile != "MEMORY.sync-conflict-20260706-120000-ABCDEF.md" {
		t.Errorf("expected basename recorded, got %q", s.LastConflictFile)
	}
	if s.LastConflictFileAt.IsZero() {
		t.Error("LastConflictFileAt should be set")
	}
	var buf bytes.Buffer
	if err := doctor(&buf, "", time.Now().UTC()); err != nil {
		// A fresh heartbeat is absent, but zero heartbeat is not stale; a conflict
		// file alone must not alarm.
		t.Fatalf("conflict file alone should not alarm doctor, got %v", err)
	}
	out := buf.String()
	for _, want := range []string{"syncthing conflict seen:", "MEMORY.sync-conflict-20260706-120000-ABCDEF.md", "resolve manually"} {
		if !strings.Contains(out, want) {
			t.Errorf("doctor output missing %q\n---\n%s", want, out)
		}
	}
}

func TestRecordPushSuccessResetsFailures(t *testing.T) {
	withTempStateDir(t)
	_ = writeState(&DaemonState{ConsecutivePushFailures: 5})
	recordPushSuccess()
	s := readState()
	if s.ConsecutivePushFailures != 0 {
		t.Errorf("expected 0 after success, got %d", s.ConsecutivePushFailures)
	}
	if s.LastPush.IsZero() {
		t.Error("LastPush should be set after success")
	}
}

func TestRecordPushFailureIncrements(t *testing.T) {
	withTempStateDir(t)
	recordPushFailure()
	recordPushFailure()
	s := readState()
	if s.ConsecutivePushFailures != 2 {
		t.Errorf("expected 2, got %d", s.ConsecutivePushFailures)
	}
}

func TestRecordSyncFailureThenSuccess(t *testing.T) {
	withTempStateDir(t)
	recordSyncFailure(errors.New("git pull --rebase: auth failed"))
	s := readState()
	if s.ConsecutiveSyncFailures != 1 || s.LastSyncError == "" || s.LastSyncErrorAt.IsZero() {
		t.Fatalf("failure should record count+error+time, got %+v", s)
	}
	recordSyncSuccess()
	s = readState()
	if s.ConsecutiveSyncFailures != 0 || s.LastSyncError != "" || s.LastSyncOK.IsZero() {
		t.Fatalf("success should reset count+error and set LastSyncOK, got %+v", s)
	}
}

// TestDoctorScansVaultForConflictFiles: files that predate the daemon (or landed
// while it was down) never hit the watcher, so doctor does its own read-only scan.
func TestDoctorScansVaultForConflictFiles(t *testing.T) {
	withTempStateDir(t)
	vault := t.TempDir()
	if err := writeRaw(vault+"/note.sync-conflict-20260101-000000-XYZ.md", []byte("x")); err != nil {
		t.Fatal(err)
	}
	// A conflict file inside .git must be ignored (skipDir).
	if err := writeRaw(vault+"/clean.md", []byte("y")); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := doctor(&buf, vault, time.Now().UTC()); err != nil {
		t.Fatalf("conflict files alone should not alarm, got %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "conflict files in vault:  1") ||
		!strings.Contains(out, "note.sync-conflict-20260101-000000-XYZ.md") {
		t.Errorf("doctor should list the scanned conflict file\n---\n%s", out)
	}
}

func TestScanConflictFilesSkipsGitAndCaps(t *testing.T) {
	vault := t.TempDir()
	mustWrite := func(rel string) {
		fp := vault + "/" + rel
		if err := writeRaw(fp, []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(vault+"/.git", 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(".git/hidden.sync-conflict-1.md") // must be skipped
	mustWrite("a.sync-conflict-1.md")
	mustWrite("b.sync-conflict-2.md")
	mustWrite("c.sync-conflict-3.md")
	got := scanConflictFiles(vault, 2)
	if len(got) != 2 {
		t.Fatalf("expected cap at 2, got %d: %v", len(got), got)
	}
	for _, p := range got {
		if strings.Contains(p, ".git") {
			t.Errorf("scan must skip .git, got %v", got)
		}
	}
}

func TestHeartbeatTickerWrites(t *testing.T) {
	withTempStateDir(t)
	stop := startHeartbeat(50 * time.Millisecond)
	time.Sleep(150 * time.Millisecond)
	stop()
	s := readState()
	if s.Heartbeat.IsZero() {
		t.Error("heartbeat should have been written by ticker")
	}
}

// overwriteFile bypasses atomic write to plant invalid content for the corrupt-file test.
func overwriteFile(fp string, data []byte) error {
	return writeRaw(fp, data)
}
