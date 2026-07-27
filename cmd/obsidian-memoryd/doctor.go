package main

// The health report: what `doctor` prints and the exit code it chooses. This is the
// only health surface when the daemon runs hidden on Windows (-H windowsgui).

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// flushableWriter is implemented by *os.File (including os.Stdout, doctor's
// production writer) and by test doubles that want to observe the flush.
type flushableWriter interface {
	Sync() error
}

// doctor prints a human-readable health report (heartbeat age, last successful
// push, last successful sync, unpushed commit count, recent rebase aborts, and
// both the consecutive push-fail and consecutive sync-fail counters) and returns
// ErrDoctorAlarm if any signal looks bad — a stale heartbeat, ≥3 push failures,
// or ≥3 sync failures (the last catches a vault stuck on add/commit/pull, which
// the push-only counter missed). Useful when the daemon
// runs hidden (Windows -H windowsgui) and the user wants to know "is it alive
// and is it pushing?" without grepping JSONL logs.

// doctor prints a human-readable health report (heartbeat age, last successful
// push, last successful sync, unpushed commit count, recent rebase aborts, and
// both the consecutive push-fail and consecutive sync-fail counters) and returns
// ErrDoctorAlarm if any signal looks bad — a stale heartbeat, ≥3 push failures,
// or ≥3 sync failures (the last catches a vault stuck on add/commit/pull, which
// the push-only counter missed). Useful when the daemon
// runs hidden (Windows -H windowsgui) and the user wants to know "is it alive
// and is it pushing?" without grepping JSONL logs.
func doctor(out io.Writer, vault string, now time.Time) error {
	// Best-effort flush of everything doctor writes before returning. This is
	// belt-and-suspenders, NOT a fix for the documented Windows -H windowsgui
	// issue (see docs/en/troubleshooting.md "doctor's exit code reads empty in
	// PowerShell"): that root cause is PowerShell not waiting for a
	// GUI-subsystem child process to exit unless its output is redirected, a
	// shell-side behavior no amount of flushing inside this process can
	// change. Sync() only guarantees OUR side has nothing left buffered.
	defer func() {
		if fw, ok := out.(flushableWriter); ok {
			_ = fw.Sync()
		}
	}()

	s := readState()
	const heartbeatStale = 5 * time.Minute

	fmt.Fprintln(out, "obsidian-memoryd doctor")
	fmt.Fprintln(out, "  state file:               "+stateFilePath())
	if s.Heartbeat.IsZero() {
		fmt.Fprintln(out, "  heartbeat:                never (daemon has not run with this state file)")
	} else {
		marker := ""
		if staleHeartbeat(s, now, heartbeatStale) {
			marker = " ⚠ daemon may be stopped"
		}
		fmt.Fprintf(out, "  heartbeat:                %s%s\n", formatAgo(now, s.Heartbeat), marker)
	}
	fmt.Fprintf(out, "  last successful push:     %s\n", formatAgo(now, s.LastPush))
	fmt.Fprintf(out, "  last successful sync:     %s\n", formatAgo(now, s.LastSyncOK))
	if !s.LastRebaseAbort.IsZero() {
		fmt.Fprintf(out, "  last rebase abort:        %s ⚠\n", formatAgo(now, s.LastRebaseAbort))
	}
	if !s.LastRebaseAbortFailedAt.IsZero() {
		fmt.Fprintf(out, "  rebase abort FAILED:      %s ⚠ worktree may still be mid-rebase, resolve manually\n",
			formatAgo(now, s.LastRebaseAbortFailedAt))
	}
	if !s.LastConflictFileAt.IsZero() {
		fmt.Fprintf(out, "  syncthing conflict seen:  %s (%s) ⚠ resolve manually\n",
			formatAgo(now, s.LastConflictFileAt), s.LastConflictFile)
	}
	if s.LastWatchStartError != "" {
		fmt.Fprintf(out, "  watcher start failed:     %s (%s) ⚠\n",
			s.LastWatchStartError, formatAgo(now, s.LastWatchStartErrorAt))
	}
	if s.ConsecutivePushFailures > 0 {
		marker := ""
		if s.ConsecutivePushFailures >= 3 {
			marker = " ⚠ repeated failure"
		}
		fmt.Fprintf(out, "  consecutive push fails:   %d%s\n", s.ConsecutivePushFailures, marker)
	}
	if s.ConsecutiveSyncFailures > 0 {
		marker := ""
		if s.ConsecutiveSyncFailures >= 3 {
			marker = " ⚠ vault not syncing"
		}
		fmt.Fprintf(out, "  consecutive sync fails:   %d%s\n", s.ConsecutiveSyncFailures, marker)
		if s.LastSyncError != "" {
			fmt.Fprintf(out, "  last sync error:          %s (%s)\n", s.LastSyncError, formatAgo(now, s.LastSyncErrorAt))
		}
	}

	// Doctor-time scan for conflict files already sitting in the vault — the
	// watcher only records ones it SEES appear, so files that predate the
	// daemon (or landed while it was down) would otherwise stay invisible.
	if vault != "" {
		if conflicts := scanConflictFiles(vault, 5); len(conflicts) > 0 {
			fmt.Fprintf(out, "  conflict files in vault:  %d (e.g. %s) ⚠ resolve manually\n",
				len(conflicts), filepath.Base(conflicts[0]))
		}
	}

	// Unpushed commit count is best-effort: requires a configured upstream.
	// Failure to compute is silent (no upstream, missing git, etc.).
	if vault != "" {
		if line := unpushedCommitsLine(vault, stepTimeout); line != "" {
			fmt.Fprint(out, line)
		}
	}

	alarm := staleHeartbeat(s, now, heartbeatStale) ||
		s.ConsecutivePushFailures >= 3 ||
		s.ConsecutiveSyncFailures >= 3 ||
		!s.LastRebaseAbort.IsZero() ||
		!s.LastRebaseAbortFailedAt.IsZero() ||
		s.LastWatchStartError != ""
	if alarm {
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "ALARM: one or more signals are unhealthy. See `obsidian-memoryd inspect --last 30` for details.")
		return ErrDoctorAlarm
	}
	return nil
}

// unpushedCommitsLine returns the "unpushed commits" doctor line, or "" if it
// cannot be computed (no `.git`, no upstream, missing git, or the command
// exceeds timeout). Bounded by timeout — unlike every other git call in this
// file, this one used to be a bare exec.Command with no timeout at all, so a
// hung git process could hang `doctor` forever.

// unpushedCommitsLine returns the "unpushed commits" doctor line, or "" if it
// cannot be computed (no `.git`, no upstream, missing git, or the command
// exceeds timeout). Bounded by timeout — unlike every other git call in this
// file, this one used to be a bare exec.Command with no timeout at all, so a
// hung git process could hang `doctor` forever.
func unpushedCommitsLine(vault string, timeout time.Duration) string {
	fi, err := os.Stat(filepath.Join(vault, ".git"))
	if err != nil || !fi.IsDir() {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "-C", vault, "rev-list", "@{u}..HEAD", "--count")
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0")
	outBytes, err := cmd.Output()
	if err != nil {
		return ""
	}
	return fmt.Sprintf("  unpushed commits (vault): %s", string(outBytes))
}
