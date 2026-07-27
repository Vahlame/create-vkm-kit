package main

// The filesystem watch loop: recursive fsnotify with a debounce, so burst saves do
// not hammer the remote. Pairs with watch_test.go.

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Vahlame/create-vkm-kit/internal/winconsole"
	"github.com/fsnotify/fsnotify"
)

// newFSWatcher constructs the fsnotify watcher used by runWatchWith.
// Overridable in tests to simulate a constructor failure (e.g. "too many
// open files") without actually exhausting OS file-watch resources.
var newFSWatcher = fsnotify.NewWatcher

// exitCoder is satisfied by *exec.ExitError and by test fakes; lets us tell an
// "empty commit" (exit 1) apart from a transport failure.

func runWatch(ctx context.Context, l *slog.Logger, root string) error {
	// Own a hidden console for the whole watch, once, and let every git child inherit it.
	//
	// This replaces CREATE_NO_WINDOW on each child, which ADR-0078 lists under "Alternatives
	// considered -> Rejected — it is the cause, not the cure": a child with NO console that
	// spawns its own console-subsystem grandchild (git-remote-https, ssh, the credential
	// helper) makes Windows allocate that grandchild a brand new VISIBLE window. A daemon
	// watching a vault syncs on its own schedule, so those windows appear while the user is
	// in another application entirely.
	//
	// ONLY here. The CLI subcommands (sync, doctor, inspect, service) run in the terminal the
	// user typed them into; winconsole.HideOwnConsole leaves an INHERITED console alone by
	// design, but not calling it there at all makes the intent explicit.
	winconsole.HideOwnConsole()
	return runWatchWith(ctx, l, root, watchDebounce(), func(c context.Context) {
		if err := gitSync(c, l, root); err != nil && !errors.Is(err, ErrSyncBusy) {
			l.Error("debounced sync", "err", err)
		}
	})
}

// runWatchWith is the testable core of runWatch: it watches `root` recursively
// and, after `dur` of quiet following the last filesystem event, invokes
// `onSync`. The sync callback is injected so tests can exercise the debounce and
// the new-directory watching without shelling out to real git (production passes
// a closure over gitSync).

// runWatchWith is the testable core of runWatch: it watches `root` recursively
// and, after `dur` of quiet following the last filesystem event, invokes
// `onSync`. The sync callback is injected so tests can exercise the debounce and
// the new-directory watching without shelling out to real git (production passes
// a closure over gitSync).
func runWatchWith(ctx context.Context, l *slog.Logger, root string, dur time.Duration, onSync func(context.Context)) error {
	w, err := newFSWatcher()
	if err != nil {
		// Record this so `doctor` alarms immediately instead of relying on
		// heartbeat staleness, which never arrives — the heartbeat only starts
		// a few lines below, once the watcher exists. Without this, a daemon
		// that dies here (e.g. "too many open files") looks idle-but-fine
		// forever, especially running as an installed service where this
		// error has no console to be logged to.
		recordWatchStartFailure(err)
		return err
	}
	defer w.Close()
	clearWatchStartFailure()

	// Heartbeat tick gives `obsidian-memoryd doctor` a way to detect
	// "daemon silently died" (especially under -H windowsgui where there
	// is no console to flash an error).
	stopBeat := startHeartbeat(60 * time.Second)
	defer stopBeat()

	if err := addRecursive(w, root); err != nil {
		return err
	}
	var debounce *time.Timer
	// Stop any pending debounce when the loop exits (ctx cancel / channel close)
	// so a late timer cannot fire onSync against a cancelled context after we
	// have already returned.
	defer func() {
		if debounce != nil {
			debounce.Stop()
		}
	}()
	for {
		select {
		case ev, ok := <-w.Events:
			if !ok {
				return nil
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
				continue
			}
			// fsnotify is non-recursive: a directory created (or moved in) after
			// startup carries no watch, so edits inside it would be missed until
			// some other event triggered a sync. Add it (recursively) as soon as
			// it appears. Add on an already-watched path is a no-op; a vanished
			// Rename target fails Stat and is skipped.
			if ev.Op&(fsnotify.Create|fsnotify.Rename) != 0 {
				if fi, statErr := os.Stat(ev.Name); statErr == nil && fi.IsDir() && !skipDir(ev.Name) {
					if addErr := addRecursive(w, ev.Name); addErr != nil {
						l.Warn("watch new directory failed", "dir", ev.Name, "err", addErr)
					}
				}
			}
			if strings.Contains(filepath.Base(ev.Name), ".sync-conflict-") {
				l.Warn("syncthing conflict file detected; resolve manually", "file", ev.Name)
				recordConflictFile(ev.Name)
			}
			if debounce != nil {
				debounce.Stop()
			}
			debounce = time.AfterFunc(dur, func() { onSync(ctx) })
		case err, ok := <-w.Errors:
			if !ok {
				return nil
			}
			l.Error("fsnotify", "err", err)
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// scanConflictFiles walks the vault (skipping the same dirs the watcher skips)
// and returns up to max paths containing the Syncthing conflict marker.
// Read-only, best-effort: walk errors are swallowed — this feeds a doctor
// warning line, not a health decision.

// scanConflictFiles walks the vault (skipping the same dirs the watcher skips)
// and returns up to max paths containing the Syncthing conflict marker.
// Read-only, best-effort: walk errors are swallowed — this feeds a doctor
// warning line, not a health decision.
func scanConflictFiles(root string, max int) []string {
	var found []string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if skipDir(path) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.Contains(d.Name(), ".sync-conflict-") {
			found = append(found, path)
			if len(found) >= max {
				return filepath.SkipAll
			}
		}
		return nil
	})
	return found
}

func addRecursive(w *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			return nil
		}
		if skipDir(path) {
			return filepath.SkipDir
		}
		return w.Add(path)
	})
}

func skipDir(path string) bool {
	base := filepath.Base(path)
	switch base {
	// .obsidian-memory-rag is the derived sidecar (SQLite index + write lock):
	// git-ignored, rebuildable, and churning on every search/write — watching it
	// would turn index updates and lock acquire/release into spurious sync cycles.
	case ".git", "node_modules", ".obsidian", ".obsidian-memory-rag":
		return true
	default:
		return false
	}
}
