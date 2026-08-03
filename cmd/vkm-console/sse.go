package main

// Server-sent events: periodic snapshots plus immediate (2s-debounced) change
// pushes driven by one shared fsnotify watcher over the vault, the telemetry
// dir and the pg data root. All fail-soft: no watcher just means no instant
// change events — the periodic refresh still runs.

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// broadcaster fans one debounced "something changed" signal out to every
// connected SSE client. A nil watcher (constructor failure, nothing to watch)
// leaves it inert but safe to use.
type broadcaster struct {
	mu      sync.Mutex
	subs    map[chan struct{}]struct{}
	watcher *fsnotify.Watcher
	once    sync.Once
}

func newBroadcaster(dirs []string, debounce time.Duration) *broadcaster {
	b := &broadcaster{subs: map[chan struct{}]struct{}{}}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return b // fail-soft: periodic refresh still covers the dashboard
	}
	for _, d := range dirs {
		_ = w.Add(d) // missing dirs are fine — they just are not watched
	}
	b.watcher = w
	go b.loop(debounce)
	return b
}

func (b *broadcaster) loop(debounce time.Duration) {
	var timer *time.Timer
	var fire <-chan time.Time
	for {
		select {
		case _, ok := <-b.watcher.Events:
			if !ok {
				return
			}
			if timer == nil {
				timer = time.NewTimer(debounce)
				fire = timer.C
			} else {
				timer.Reset(debounce)
			}
		case _, ok := <-b.watcher.Errors:
			if !ok {
				return
			}
		case <-fire:
			timer = nil
			fire = nil
			b.broadcast()
		}
	}
}

func (b *broadcaster) broadcast() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- struct{}{}:
		default: // subscriber already has a pending signal
		}
	}
}

func (b *broadcaster) subscribe() chan struct{} {
	ch := make(chan struct{}, 1)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *broadcaster) unsubscribe(ch chan struct{}) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
}

// Close stops the watcher (its Events channel closes, ending the loop).
func (b *broadcaster) Close() {
	b.once.Do(func() {
		if b.watcher != nil {
			_ = b.watcher.Close()
		}
	})
}

// watchDirs lists every directory worth watching: the vault tree (bounded,
// skipping the same dirs the stats walker skips), the telemetry dir, and the
// pg data root plus its per-vault homes (fsnotify is non-recursive).
func watchDirs(p paths) []string {
	var dirs []string
	if p.vault != "" {
		dirs = append(dirs, vaultWatchDirs(p.vault, 256)...)
	}
	dirs = append(dirs, p.telemetryDir, p.pgRoot)
	if entries, err := os.ReadDir(p.pgRoot); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				dirs = append(dirs, filepath.Join(p.pgRoot, e.Name()))
			}
		}
	}
	return dirs
}

// vaultWatchDirs walks the vault collecting directories to watch, capped so a
// huge vault cannot exhaust OS watch handles.
func vaultWatchDirs(vault string, limit int) []string {
	var dirs []string
	_ = filepath.WalkDir(vault, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if path != vault && skipDirs[d.Name()] {
			return filepath.SkipDir
		}
		if len(dirs) >= limit {
			return filepath.SkipAll
		}
		dirs = append(dirs, path)
		return nil
	})
	return dirs
}

// handleEvents is the SSE stream: on connect an immediate hello + snapshot,
// then a fresh snapshot every s.refresh, an immediate "change" snapshot when
// the watcher fires (debounced 2s), and a `:hb` comment every s.heartbeat.
func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	fmt.Fprintf(w, "event: hello\ndata: {\"version\":%q,\"refreshSec\":%d}\n\n",
		s.version, int(s.refresh/time.Second))
	fl.Flush()

	sub := s.bc.subscribe()
	defer s.bc.unsubscribe(sub)

	ctx := r.Context()
	// Immediate first snapshot so the page paints without waiting a full tick.
	s.writeSnapshotEvent(w, fl, r, "snapshot")

	tick := time.NewTicker(s.refresh)
	defer tick.Stop()
	hb := time.NewTicker(s.heartbeat)
	defer hb.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			s.writeSnapshotEvent(w, fl, r, "snapshot")
		case <-sub:
			s.writeSnapshotEvent(w, fl, r, "change")
		case <-hb.C:
			_, _ = io.WriteString(w, ":hb\n\n")
			fl.Flush()
		}
	}
}

func (s *server) writeSnapshotEvent(w http.ResponseWriter, fl http.Flusher, r *http.Request, event string) {
	snap := s.collectSnapshot(r.Context())
	data, err := json.Marshal(snap)
	if err != nil {
		return // a snapshot that cannot marshal is dropped, never fatal
	}
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
	fl.Flush()
}
