package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func waitSync(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("expected a debounced sync within 3s")
	}
}

// TestRunWatchWatchesNewSubdirectory verifies the debounce fires onSync after a
// filesystem change AND — the bug fixed here — that a directory created after the
// watch started is itself watched, so a file written inside it still triggers a
// sync. fsnotify is non-recursive, so without the in-loop addRecursive the second
// sync would never arrive.
func TestRunWatchWatchesNewSubdirectory(t *testing.T) {
	withTempStateDir(t) // startHeartbeat writes state; keep it off the real file
	root := t.TempDir()

	synced := make(chan struct{}, 8)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = runWatchWith(ctx, discardLogger(), root, 40*time.Millisecond, func(context.Context) {
			select {
			case synced <- struct{}{}:
			default:
			}
		})
		close(done)
	}()

	// Let the watcher establish before we mutate the tree.
	time.Sleep(150 * time.Millisecond)

	// A directory created AFTER startup, then a file inside it.
	sub := filepath.Join(root, "nested")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	waitSync(t, synced) // sync from the dir-create event; drains so the next is isolated

	if err := os.WriteFile(filepath.Join(sub, "note.md"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitSync(t, synced) // can ONLY fire if the new subdir was added to the watcher

	cancel()
	<-done // wait for clean shutdown (heartbeat stop) before t.Cleanup removes temp dirs
}

// TestRunWatchRecordsConflictFile: a Syncthing conflict file appearing in the
// watched tree must be recorded in daemon state (ADR-0013 amendment: detect and
// surface, never auto-merge).
func TestRunWatchRecordsConflictFile(t *testing.T) {
	withTempStateDir(t)
	root := t.TempDir()

	synced := make(chan struct{}, 8)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = runWatchWith(ctx, discardLogger(), root, 40*time.Millisecond, func(context.Context) {
			select {
			case synced <- struct{}{}:
			default:
			}
		})
		close(done)
	}()
	time.Sleep(150 * time.Millisecond)

	name := "MEMORY.sync-conflict-20260706-101010-AAAAAA.md"
	if err := os.WriteFile(filepath.Join(root, name), []byte("theirs"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitSync(t, synced)

	cancel()
	<-done

	s := readState()
	if s.LastConflictFile != name {
		t.Errorf("expected conflict file %q recorded, got %q", name, s.LastConflictFile)
	}
	if s.LastConflictFileAt.IsZero() {
		t.Error("LastConflictFileAt should be set")
	}
}

// TestRunWatchRecordsStartFailure is the regression test for item 4: a failed
// watcher constructor must both propagate its error AND record it in daemon
// state, since the heartbeat (the usual "daemon died" signal) only starts a
// few lines further down runWatchWith and so never arrives — a "never"
// heartbeat is not treated as stale.
func TestRunWatchRecordsStartFailure(t *testing.T) {
	withTempStateDir(t)
	orig := newFSWatcher
	newFSWatcher = func() (*fsnotify.Watcher, error) {
		return nil, errors.New("too many open files")
	}
	t.Cleanup(func() { newFSWatcher = orig })

	err := runWatchWith(context.Background(), discardLogger(), t.TempDir(), 40*time.Millisecond, func(context.Context) {})
	if err == nil {
		t.Fatal("expected the watcher construction error to propagate")
	}

	s := readState()
	if s.LastWatchStartError == "" {
		t.Error("expected LastWatchStartError to be recorded")
	}
	if s.LastWatchStartErrorAt.IsZero() {
		t.Error("expected LastWatchStartErrorAt to be recorded")
	}
	if !s.Heartbeat.IsZero() {
		t.Error("a failed watcher must never have written a heartbeat")
	}
}

// TestRunWatchClearsStartFailureOnSuccess proves a subsequent successful
// start clears a previously recorded watch-start failure, so a transient
// resource shortage that recovers doesn't keep alarming `doctor` forever.
func TestRunWatchClearsStartFailureOnSuccess(t *testing.T) {
	withTempStateDir(t)
	recordWatchStartFailure(errors.New("boom"))

	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = runWatchWith(ctx, discardLogger(), root, 40*time.Millisecond, func(context.Context) {})
		close(done)
	}()
	time.Sleep(150 * time.Millisecond)
	cancel()
	<-done

	s := readState()
	if s.LastWatchStartError != "" {
		t.Errorf("expected the watch-start failure cleared after a successful start, got %q", s.LastWatchStartError)
	}
}

// TestServiceStartStopLifecycle verifies Start launches the watch goroutine and
// Stop cancels it. The fix replaced a no-op Stop (which leaked the goroutine and
// its watcher on every service stop/restart) with context cancellation.
func TestServiceStartStopLifecycle(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan struct{})
	d := &daemonSvc{
		log: discardLogger(),
		watch: func(ctx context.Context) {
			close(started)
			<-ctx.Done()
			close(stopped)
		},
	}
	if err := d.Start(nil); err != nil {
		t.Fatalf("Start: %v", err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not launch the watch goroutine")
	}
	if err := d.Stop(nil); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not cancel the watch goroutine")
	}
}
