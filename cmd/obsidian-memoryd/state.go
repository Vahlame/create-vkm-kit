package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/adrg/xdg"
)

// DaemonState is the small JSON record we persist alongside the rotating log
// so the user can ask `obsidian-memoryd doctor` whether the daemon is alive
// and whether it has been able to push lately. This is the only authoritative
// signal of daemon health — the rotating JSONL log is human-readable but easy
// to miss, especially on Windows where the daemon runs without a console.
type DaemonState struct {
	Heartbeat               time.Time `json:"heartbeat"`
	LastPush                time.Time `json:"last_push,omitempty"`
	LastRebaseAbort         time.Time `json:"last_rebase_abort,omitempty"`
	ConsecutivePushFailures int       `json:"consecutive_push_failures"`
}

var (
	stateMu sync.Mutex
	// stateDirOverride lets tests redirect the state file to a tmp dir.
	// xdg.StateFile reads XDG_STATE_HOME at package init only, so flipping
	// the env var inside a test doesn't take effect — this override does.
	stateDirOverride string
)

// stateFilePath returns the JSON file used to persist DaemonState. Falls back
// to a tmp-dir location if XDG lookup fails (matches newLogger's behavior).
func stateFilePath() string {
	if stateDirOverride != "" {
		return filepath.Join(stateDirOverride, "state.json")
	}
	fp, err := xdg.StateFile(filepath.Join("obsidian-memory", "state.json"))
	if err != nil {
		fp = filepath.Join(os.TempDir(), "obsidian-memory", "state.json")
	}
	return fp
}

// readState reads the persisted DaemonState. A missing or corrupt file is
// treated as "empty state" so the caller can populate fields and write back.
func readState() *DaemonState {
	fp := stateFilePath()
	data, err := os.ReadFile(fp)
	if err != nil {
		return &DaemonState{}
	}
	var s DaemonState
	if err := json.Unmarshal(data, &s); err != nil {
		return &DaemonState{}
	}
	return &s
}

// writeState writes the state atomically (tmp + rename) so a crash mid-write
// leaves the previous version in place.
func writeState(s *DaemonState) error {
	fp := stateFilePath()
	if err := os.MkdirAll(filepath.Dir(fp), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := fp + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, fp)
}

// updateState is the locked read-modify-write helper. Callers pass a mutator;
// it serializes concurrent updates so a heartbeat tick and a push completion
// don't race over the state file.
func updateState(mutate func(*DaemonState)) error {
	stateMu.Lock()
	defer stateMu.Unlock()
	s := readState()
	mutate(s)
	return writeState(s)
}

// startHeartbeat spawns a ticker goroutine that touches the heartbeat field
// every `interval`. Returns a stop function the caller should defer.
func startHeartbeat(interval time.Duration) func() {
	tick := time.NewTicker(interval)
	done := make(chan struct{})
	// Initial beat so `doctor` works right after startup without waiting for
	// the first tick.
	_ = updateState(func(s *DaemonState) { s.Heartbeat = time.Now().UTC() })
	go func() {
		for {
			select {
			case <-tick.C:
				_ = updateState(func(s *DaemonState) {
					s.Heartbeat = time.Now().UTC()
				})
			case <-done:
				return
			}
		}
	}()
	return func() {
		tick.Stop()
		close(done)
	}
}

// recordPushSuccess updates state after a successful push: timestamp the push
// and zero the consecutive-failures counter.
func recordPushSuccess() {
	_ = updateState(func(s *DaemonState) {
		s.LastPush = time.Now().UTC()
		s.ConsecutivePushFailures = 0
	})
}

// recordPushFailure increments the consecutive-failures counter so `doctor`
// can surface "pushed has failed N times in a row" as an alarm.
func recordPushFailure() {
	_ = updateState(func(s *DaemonState) {
		s.ConsecutivePushFailures++
	})
}

// recordRebaseAbort timestamps the most recent rebase --abort so users can
// notice that they're stuck in a divergence loop.
func recordRebaseAbort() {
	_ = updateState(func(s *DaemonState) {
		s.LastRebaseAbort = time.Now().UTC()
	})
}

// formatAgo formats a duration since `t` as e.g. "2m30s ago", or "never" when
// t is the zero value. Used by `doctor` for human-readable output.
func formatAgo(now, t time.Time) string {
	if t.IsZero() {
		return "never"
	}
	d := now.Sub(t).Round(time.Second)
	if d < 0 {
		return "in the future (clock skew?)"
	}
	return d.String() + " ago"
}

// staleHeartbeat returns true if the heartbeat is older than `threshold`.
// A zero heartbeat is NOT considered stale (the daemon has not run yet —
// expected on first install).
func staleHeartbeat(s *DaemonState, now time.Time, threshold time.Duration) bool {
	if s.Heartbeat.IsZero() {
		return false
	}
	return now.Sub(s.Heartbeat) > threshold
}

// ErrDoctorAlarm is returned by doctor when any signal looks bad enough that
// the exit code should be non-zero (so this can be wired into shell pipelines
// or cron-based health monitors).
var ErrDoctorAlarm = errors.New("doctor: one or more signals are alarming")

// writeRaw is exposed for tests so they can plant corrupt content; production
// code goes through writeState (which is atomic via tmp+rename).
func writeRaw(fp string, data []byte) error {
	return os.WriteFile(fp, data, 0o644)
}
