package main

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

// emptyPaths points every source at a location that does not exist: the
// console must keep serving with every card "off" (fail-soft contract).
func emptyPaths(t *testing.T) paths {
	t.Helper()
	base := t.TempDir()
	return paths{
		stateFile:    filepath.Join(base, "none", "state.json"),
		vault:        "",
		telemetryDir: filepath.Join(base, "none", "telemetry"),
		pgRoot:       filepath.Join(base, "none", "pg"),
		searchLog:    filepath.Join(base, "none", "searches.log"),
		downloadsDir: filepath.Join(base, "none", "downloads"),
	}
}

func TestSnapshotHandlerAllSourcesFailingIsValidJSON(t *testing.T) {
	s := newServer("test", emptyPaths(t), time.Hour, time.Hour)
	defer s.Close()

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, authedRequest(s, "GET", "/api/snapshot"))
	if rec.Code != 200 {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var snap Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("snapshot is not valid JSON: %v\n%s", err, rec.Body.String())
	}
	if snap.Version != "test" {
		t.Fatalf("version: %q", snap.Version)
	}
	// Every source must be present, off, and carry an explanation.
	if snap.Daemon.OK || snap.Daemon.Error == "" || snap.Daemon.HeartbeatAgeSec != -1 {
		t.Fatalf("daemon should be off: %+v", snap.Daemon)
	}
	if snap.VaultStats.OK || snap.VaultStats.Error == "" {
		t.Fatalf("vault stats should be off: %+v", snap.VaultStats)
	}
	if snap.Telemetry.OK || snap.Telemetry.Error == "" || snap.Telemetry.CacheHitRatio != -1 {
		t.Fatalf("telemetry should be off: %+v", snap.Telemetry)
	}
	if snap.Pg.OK || snap.Pg.Error == "" || len(snap.Pg.Services) != 0 {
		t.Fatalf("pg should be off: %+v", snap.Pg)
	}
	if snap.Research.OK || snap.Research.Error == "" {
		t.Fatalf("research should be off: %+v", snap.Research)
	}
}

func TestBroadcasterSubscribeUnsubscribe(t *testing.T) {
	b := newBroadcaster(nil, 10*time.Millisecond)
	defer b.Close()
	ch := b.subscribe()
	b.broadcast()
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("subscriber never received the broadcast")
	}
	// A second broadcast with a full buffer must not block.
	b.broadcast()
	b.broadcast()
	b.unsubscribe(ch)
	b.broadcast() // no subscribers left: must not panic
}
