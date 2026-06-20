package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
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
