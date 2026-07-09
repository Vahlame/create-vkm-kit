package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Cross-process lock for git-sync operations against a vault. In-process
// concurrency is already handled by syncMu (a sync.Mutex), but that means
// nothing across processes: two obsidian-memoryd instances pointed at the
// same vault, or a running daemon plus a manual `sync once`/git operation,
// can still interleave `git add`/`commit`/`pull --rebase`/`push` against the
// same working tree. This mirrors, in spirit, the MCP sidecar's advisory
// write lock (packages/obsidian-memory-mcp/src/vault-lock.mjs): an O_EXCL
// lockfile carrying {pid, hostname, acquired_at}, with dead-PID/TTL staleness
// detection so a crashed daemon cannot leave a permanent lock behind.
//
// Unlike the sidecar lock (which blocks briefly with backoff for interactive
// MCP calls), this lock fails fast: a single create attempt, and at most one
// steal-and-retry when the existing lock is stale. A live holder returns
// ErrGitSyncLocked immediately — the next scheduled watch cycle will pick the
// sync back up, so there is nothing to gain by blocking a goroutine here.

// gitSyncLockTTL bounds how long a lock file is honored when its owning PID
// cannot settle the question (see isLockStale). It is generous relative to
// the longest realistic sync cycle (three 30s step timeouts plus a 60s push
// timeout with retries, comfortably under 5 minutes) so a slow-but-alive sync
// is never pre-empted by TTL alone — PID liveness is the primary signal, TTL
// is only a backstop against a same-host PID getting recycled by an unrelated
// process.
const gitSyncLockTTL = 10 * time.Minute

// gitSyncLockDir mirrors the ".obsidian-memory-rag" literal used by skipDir
// in main.go: the derived, git-ignored sidecar directory the RAG index
// already owns, so the lock file never becomes vault content and is never
// itself watched or synced.
const gitSyncLockDir = ".obsidian-memory-rag"

const gitSyncLockName = "git-sync.lock"

// isPIDAlive is overridden in tests to simulate live/dead lock holders
// without depending on real OS process state. Production wiring is
// pidAliveImpl, implemented per-OS in proc_windows.go / proc_other.go.
var isPIDAlive = pidAliveImpl

// ErrGitSyncLocked indicates another process — a second daemon instance, a
// manual `sync once`, or any other obsidian-memoryd invocation — currently
// holds the cross-process git-sync lock for this vault. It wraps ErrSyncBusy
// at the call site so existing `errors.Is(err, ErrSyncBusy)` checks keep
// treating this the same as in-process contention: skip, don't fail hard.
var ErrGitSyncLocked = errors.New("git sync locked by another process")

type gitSyncLockInfo struct {
	PID        int       `json:"pid"`
	Hostname   string    `json:"hostname"`
	AcquiredAt time.Time `json:"acquired_at"`
}

// acquireGitSyncLock takes an exclusive, cross-process lock on dir (the vault
// root). It fails fast: at most two O_EXCL create attempts total — the second
// only happens if the first found a stale lock to steal — never a wait/retry
// loop against a live holder.
func acquireGitSyncLock(dir string) (release func(), err error) {
	lockDir := filepath.Join(dir, gitSyncLockDir)
	lockPath := filepath.Join(lockDir, gitSyncLockName)
	if err := os.MkdirAll(lockDir, 0o755); err != nil {
		return nil, fmt.Errorf("git sync lock: %w", err)
	}

	for attempt := 0; attempt < 2; attempt++ {
		f, createErr := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if createErr == nil {
			hostname, _ := os.Hostname()
			payload, _ := json.Marshal(gitSyncLockInfo{
				PID:        os.Getpid(),
				Hostname:   hostname,
				AcquiredAt: time.Now().UTC(),
			})
			_, writeErr := f.Write(payload)
			closeErr := f.Close()
			if writeErr != nil || closeErr != nil {
				_ = os.Remove(lockPath)
				return nil, fmt.Errorf("git sync lock: %w", errors.Join(writeErr, closeErr))
			}
			return func() { _ = os.Remove(lockPath) }, nil
		}
		if !os.IsExist(createErr) {
			return nil, fmt.Errorf("git sync lock: %w", createErr)
		}

		holder, readErr := readGitSyncLockInfo(lockPath)
		if readErr != nil {
			// Missing (released between our attempts) or corrupt/unparseable:
			// either way it cannot be verified, so it is safe to remove and
			// retry rather than wedge every future sync forever.
			_ = os.Remove(lockPath)
			continue
		}
		if isLockStale(holder) {
			_ = os.Remove(lockPath)
			continue
		}
		return nil, fmt.Errorf("%w: held by pid %d on %s since %s",
			ErrGitSyncLocked, holder.PID, holder.Hostname, holder.AcquiredAt.Format(time.RFC3339))
	}
	return nil, fmt.Errorf("git sync lock: gave up after repeated stale-lock contention")
}

func readGitSyncLockInfo(path string) (gitSyncLockInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return gitSyncLockInfo{}, err
	}
	var info gitSyncLockInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return gitSyncLockInfo{}, err
	}
	return info, nil
}

// isLockStale reports whether a lock holder is safe to steal: a same-host
// lock whose PID is no longer alive, or one older than gitSyncLockTTL. A
// foreign-host lock is NEVER stolen regardless of age — its PID liveness is
// unknowable from here, and (as with vault-lock.mjs) Syncthing (ADR-0013) can
// replicate this file from a daemon that is still very much running on
// another machine; a wrong steal there means two hosts writing the working
// tree at once.
func isLockStale(holder gitSyncLockInfo) bool {
	hostname, _ := os.Hostname()
	if holder.Hostname != hostname {
		return false
	}
	if holder.AcquiredAt.IsZero() || time.Since(holder.AcquiredAt) > gitSyncLockTTL {
		return true
	}
	return !isPIDAlive(holder.PID)
}
