package main

// Running a child process, behind an interface so tests inject a fake instead of
// shelling out. Console visibility is NOT set here — see runWatch in watch.go.

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// Runner abstracts running a child process so tests can inject fakes. The
// production implementation sets GIT_TERMINAL_PROMPT=0 so git fails fast instead
// of blocking on a credential prompt in a headless or hidden context.
//
// It deliberately does NOT ask for CREATE_NO_WINDOW. Console visibility is owned
// once, by winconsole.HideOwnConsole in runWatch, and inherited by every child —
// see the note there for why per-child hiding was the cause of the flashing.
type Runner interface {
	Run(ctx context.Context, name string, args ...string) error
	Output(ctx context.Context, name string, args ...string) ([]byte, error)
}

type execRunner struct{}

func (execRunner) Run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// Previously discarded entirely: a push/add/rebase-abort failure was
		// recorded as a bare exit code with no indication why. %w keeps the
		// original error (incl. *exec.ExitError) unwrappable via errors.As.
		if stderr.Len() > 0 {
			return fmt.Errorf("%w: %s", err, truncate([]byte(strings.TrimSpace(stderr.String())), 400))
		}
		return err
	}
	return nil
}

func (execRunner) Output(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0")
	return cmd.CombinedOutput()
}

var defaultRunner Runner = execRunner{}

// newFSWatcher constructs the fsnotify watcher used by runWatchWith.
// Overridable in tests to simulate a constructor failure (e.g. "too many
// open files") without actually exhausting OS file-watch resources.

// exitCoder is satisfied by *exec.ExitError and by test fakes; lets us tell an
// "empty commit" (exit 1) apart from a transport failure.
type exitCoder interface{ ExitCode() int }
