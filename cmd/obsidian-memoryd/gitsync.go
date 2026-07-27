package main

// The sync pipeline: add -> commit -> pull --rebase -> push, with per-step timeouts,
// rebase-conflict abort and exponential push retry (ADR-0004). Pairs with gitsync_test.go.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-git/v5"
)

const (
	stepTimeout    = 30 * time.Second
	pushTimeout    = 60 * time.Second
	pushMaxRetries = 3
)

var (
	syncMu sync.Mutex
	// ErrSyncBusy is returned by gitSync when another sync is already running.
	// Callers should ignore it (the in-flight sync will pick up the latest state).
	ErrSyncBusy = errors.New("git sync already in progress; skipped")
)

// gitSync runs add → commit → pull --rebase → push against dir, with per-step
// timeouts, rebase-conflict abort, and exponential retry on push. Only one
// sync runs at a time per process; concurrent callers get ErrSyncBusy.
func gitSync(parent context.Context, l *slog.Logger, dir string) error {
	return gitSyncWith(parent, l, dir, defaultRunner)
}

func gitSyncWith(parent context.Context, l *slog.Logger, dir string, r Runner) error {
	if !syncMu.TryLock() {
		l.Info("git sync skipped: another sync in progress")
		return ErrSyncBusy
	}
	defer syncMu.Unlock()

	// syncMu only guards this process. A second daemon instance, or a manual
	// `sync once`/git operation pointed at the same vault, can still race the
	// working tree — take a cross-process lock too. Fails fast (a single
	// attempt, no blocking) so a busy vault never hangs a sync cycle.
	release, lockErr := acquireGitSyncLock(dir)
	if lockErr != nil {
		l.Info("git sync skipped: cross-process lock busy", "err", lockErr)
		return fmt.Errorf("%w: %w", ErrSyncBusy, lockErr)
	}
	defer release()

	// Record the outcome of the WHOLE cycle (not just push). This is the fix for
	// the health-blind spot: an add/commit/pull failure used to return an error
	// that was only logged to JSONL, so `doctor` — keyed on push failures alone —
	// reported healthy while the vault silently stopped syncing.
	err := runSyncSteps(parent, l, dir, r)
	if err != nil {
		if parent.Err() != nil {
			// The whole sync was aborted by shutdown (parent context canceled
			// or expired — Stop()/Ctrl-C during an in-flight sync), not a real
			// git failure. Counting it would trip the "vault not syncing"
			// alarm on a normal restart. A per-step context.WithTimeout
			// expiring on ITS OWN (parent still fine) is unaffected by this
			// check and still records as a genuine failure below.
			l.Info("git sync aborted: shutdown in progress", "err", err)
		} else {
			recordSyncFailure(err)
		}
	} else {
		recordSyncSuccess()
	}
	return err
}

// runSyncSteps runs add → commit → pull --rebase → push in order, stopping at the
// first failure. Split out from gitSyncWith so the latter can record one
// success/failure for the whole cycle regardless of which step failed.

// runSyncSteps runs add → commit → pull --rebase → push in order, stopping at the
// first failure. Split out from gitSyncWith so the latter can record one
// success/failure for the whole cycle regardless of which step failed.
func runSyncSteps(parent context.Context, l *slog.Logger, dir string, r Runner) error {
	if _, err := git.PlainOpen(dir); err != nil {
		return fmt.Errorf("not a git repo: %w", err)
	}
	if err := runStep(parent, r, stepTimeout, l, "add", "git", "-C", dir, "add", "-A"); err != nil {
		return err
	}
	if err := commitStep(parent, r, stepTimeout, l, dir); err != nil {
		return err
	}
	if err := pullRebaseStep(parent, r, stepTimeout, l, dir); err != nil {
		return err
	}
	return pushStep(parent, r, pushTimeout, l, dir)
}

func runStep(parent context.Context, r Runner, to time.Duration, l *slog.Logger, label, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(parent, to)
	defer cancel()
	if err := r.Run(ctx, name, args...); err != nil {
		return fmt.Errorf("git %s: %w", label, err)
	}
	l.Info("git step ok", "step", label)
	return nil
}

// commitMessage builds the auto-commit subject + body: the subject carries the
// staged-file count, the body lists up to commitListMax paths and an optional
// `Agent:` trailer (from OBSIDIAN_MEMORY_AGENT) so `git log` is a usable audit
// trail — WHAT changed and WHICH daemon/machine committed it — instead of a
// bare timestamp. The label attributes the daemon instance, not a tool call.

// commitMessage builds the auto-commit subject + body: the subject carries the
// staged-file count, the body lists up to commitListMax paths and an optional
// `Agent:` trailer (from OBSIDIAN_MEMORY_AGENT) so `git log` is a usable audit
// trail — WHAT changed and WHICH daemon/machine committed it — instead of a
// bare timestamp. The label attributes the daemon instance, not a tool call.
const commitListMax = 20

func commitMessage(now time.Time, files []string, agent string) (subject, body string) {
	ts := now.UTC().Format(time.RFC3339)
	if len(files) == 0 {
		subject = "auto: " + ts
	} else {
		noun := "files"
		if len(files) == 1 {
			noun = "file"
		}
		subject = fmt.Sprintf("auto: %s (%d %s)", ts, len(files), noun)
	}
	var b strings.Builder
	for i, f := range files {
		if i == commitListMax {
			fmt.Fprintf(&b, "…and %d more\n", len(files)-commitListMax)
			break
		}
		b.WriteString(f)
		b.WriteByte('\n')
	}
	if agent != "" {
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString("Agent: " + agent + "\n")
	}
	return subject, strings.TrimRight(b.String(), "\n")
}

func commitStep(parent context.Context, r Runner, to time.Duration, l *slog.Logger, dir string) error {
	ctx, cancel := context.WithTimeout(parent, to)
	defer cancel()
	// Best-effort staged-file list for the commit body; a diff failure must
	// never block the sync cycle (files stays empty, subject falls back to the
	// bare timestamp).
	var files []string
	if out, err := r.Output(ctx, "git", "-C", dir, "diff", "--cached", "--name-only"); err == nil {
		for _, ln := range strings.Split(string(out), "\n") {
			if ln = strings.TrimSpace(ln); ln != "" {
				files = append(files, ln)
			}
		}
	}
	subject, body := commitMessage(time.Now(), files, strings.TrimSpace(os.Getenv("OBSIDIAN_MEMORY_AGENT")))
	args := []string{"-C", dir, "commit", "-m", subject}
	if body != "" {
		args = append(args, "-m", body)
	}
	out, err := r.Output(ctx, "git", args...)
	if err == nil {
		l.Info("git step ok", "step", "commit", "files", len(files))
		return nil
	}
	var ce exitCoder
	if errors.As(err, &ce) && ce.ExitCode() == 1 && isCommitNoop(out) {
		l.Info("git commit noop (nothing to commit)")
		return nil
	}
	return fmt.Errorf("git commit: %w; output=%s", err, truncate(out, 400))
}

// isCommitNoop reports whether `git commit`'s own output is its "nothing to
// commit" message, as opposed to some other reason a commit exits 1 — most
// plausibly a pre-commit/commit-msg hook rejecting staged content. The two
// are indistinguishable by exit code alone; treating every exit-1 as a
// benign noop silently discarded genuinely-rejected work.

// isCommitNoop reports whether `git commit`'s own output is its "nothing to
// commit" message, as opposed to some other reason a commit exits 1 — most
// plausibly a pre-commit/commit-msg hook rejecting staged content. The two
// are indistinguishable by exit code alone; treating every exit-1 as a
// benign noop silently discarded genuinely-rejected work.
func isCommitNoop(out []byte) bool {
	s := string(out)
	return strings.Contains(s, "nothing to commit") || strings.Contains(s, "working tree clean")
}

func pullRebaseStep(parent context.Context, r Runner, to time.Duration, l *slog.Logger, dir string) error {
	ctx, cancel := context.WithTimeout(parent, to)
	defer cancel()
	out, err := r.Output(ctx, "git", "-C", dir, "pull", "--rebase")
	if err == nil {
		l.Info("git step ok", "step", "pull --rebase")
		return nil
	}
	// Abort trigger is the actual on-disk rebase state, not a substring match on
	// the failure output — a context-timeout kill or a network drop mid-apply can
	// leave a rebase in progress with output that never mentions CONFLICT/needs
	// merge, and would otherwise skip cleanup and wedge `.git` forever.
	if rebaseInProgress(dir) {
		abortCtx, abortCancel := context.WithTimeout(parent, 10*time.Second)
		defer abortCancel()
		if abortErr := r.Run(abortCtx, "git", "-C", dir, "rebase", "--abort"); abortErr != nil {
			l.Error("rebase abort failed", "err", abortErr)
			recordRebaseAbortFailure()
			return fmt.Errorf("git pull --rebase: conflict, abort FAILED (worktree may still be mid-rebase): %w", abortErr)
		}
		l.Warn("rebase aborted due to conflicts; resolve manually then re-sync", "dir", dir)
		recordRebaseAbort()
		return fmt.Errorf("git pull --rebase: conflict, aborted")
	}
	return fmt.Errorf("git pull --rebase: %w; output=%s", err, truncate(out, 400))
}

// rebaseInProgress reports whether dir's repo is currently mid-rebase, by
// checking git's own on-disk state directories directly — independent of
// whatever text a failed `pull --rebase` did or didn't produce.

// rebaseInProgress reports whether dir's repo is currently mid-rebase, by
// checking git's own on-disk state directories directly — independent of
// whatever text a failed `pull --rebase` did or didn't produce.
func rebaseInProgress(dir string) bool {
	for _, name := range []string{"rebase-merge", "rebase-apply"} {
		if fi, err := os.Stat(filepath.Join(dir, ".git", name)); err == nil && fi.IsDir() {
			return true
		}
	}
	return false
}

func pushStep(parent context.Context, r Runner, to time.Duration, l *slog.Logger, dir string) error {
	var lastErr error
	backoff := 500 * time.Millisecond
	for attempt := 1; attempt <= pushMaxRetries; attempt++ {
		if attempt > 1 {
			// A prior push attempt failed — most likely the remote advanced
			// underneath us (rejected / non-fast-forward), in which case
			// retrying the bare push again fails identically forever. Re-pull
			// first so the retry actually has a chance to succeed. Best
			// effort: if the re-pull itself fails (conflict or transport), log
			// it and still attempt the push — that push will simply fail and
			// feed the normal retry/backoff/exhaustion path below.
			if pullErr := pullRebaseStep(parent, r, stepTimeout, l, dir); pullErr != nil {
				l.Warn("pull before push retry failed", "attempt", attempt, "err", pullErr)
			}
		}
		ctx, cancel := context.WithTimeout(parent, to)
		err := r.Run(ctx, "git", "-C", dir, "push")
		cancel()
		if err == nil {
			l.Info("git step ok", "step", "push", "attempt", attempt)
			recordPushSuccess()
			return nil
		}
		lastErr = err
		l.Warn("git push failed; will retry", "attempt", attempt, "err", err)
		if attempt < pushMaxRetries {
			select {
			case <-time.After(backoff):
			case <-parent.Done():
				return parent.Err()
			}
			backoff *= 2
		}
	}
	recordPushFailure()
	return fmt.Errorf("git push (%d attempts): %w", pushMaxRetries, lastErr)
}

// truncate caps git output at n RUNES (not bytes) with an ellipsis.
//
// The byte-slice overload of truncateString (state.go), which carries the reasoning: a
// raw byte cut can slice mid-rune, and encoding/json then mangles the tail into U+FFFD
// once it is persisted to state.json. Git output and vault paths are routinely
// non-ASCII — this vault's own content is Spanish.
func truncate(b []byte, n int) string { return truncateString(string(b), n) }

// flushableWriter is implemented by *os.File (including os.Stdout, doctor's
// production writer) and by test doubles that want to observe the flush.
