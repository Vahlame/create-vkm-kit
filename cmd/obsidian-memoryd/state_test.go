package main

import (
	"bytes"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// withTempStateDir redirects state file writes to a fresh tmp dir per test.
// Goes through stateDirOverride because xdg.StateFile caches XDG_STATE_HOME
// at package init and doesn't notice test-time env changes.
func withTempStateDir(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	stateDirOverride = dir
	t.Cleanup(func() { stateDirOverride = "" })
}

func TestStateRoundTrip(t *testing.T) {
	withTempStateDir(t)
	s1 := &DaemonState{
		Heartbeat:               time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		LastPush:                time.Date(2026, 1, 2, 3, 0, 0, 0, time.UTC),
		ConsecutivePushFailures: 2,
	}
	if err := writeState(s1); err != nil {
		t.Fatal(err)
	}
	s2 := readState()
	if !s1.Heartbeat.Equal(s2.Heartbeat) {
		t.Errorf("heartbeat: %v vs %v", s1.Heartbeat, s2.Heartbeat)
	}
	if !s1.LastPush.Equal(s2.LastPush) {
		t.Errorf("last push: %v vs %v", s1.LastPush, s2.LastPush)
	}
	if s2.ConsecutivePushFailures != 2 {
		t.Errorf("failures: got %d", s2.ConsecutivePushFailures)
	}
}

func TestUpdateStateConcurrent(t *testing.T) {
	withTempStateDir(t)
	const goroutines = 20
	const incrementsPer = 5
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < incrementsPer; j++ {
				_ = updateState(func(s *DaemonState) {
					s.ConsecutivePushFailures++
				})
			}
		}()
	}
	wg.Wait()
	s := readState()
	want := goroutines * incrementsPer
	if s.ConsecutivePushFailures != want {
		t.Errorf("expected %d, got %d (lost updates → race)", want, s.ConsecutivePushFailures)
	}
}

func TestReadStateMissingFile(t *testing.T) {
	withTempStateDir(t)
	s := readState()
	if !s.Heartbeat.IsZero() {
		t.Error("missing file should yield zero state, got non-zero heartbeat")
	}
}

func TestReadStateCorruptFile(t *testing.T) {
	withTempStateDir(t)
	// Corrupt the state file deliberately.
	if err := writeState(&DaemonState{Heartbeat: time.Now()}); err != nil {
		t.Fatal(err)
	}
	// Overwrite with garbage.
	fp := stateFilePath()
	if err := overwriteFile(fp, []byte("not json {{")); err != nil {
		t.Fatal(err)
	}
	s := readState()
	if !s.Heartbeat.IsZero() {
		t.Errorf("corrupt file should reset to zero state, got %v", s.Heartbeat)
	}
}

func TestStaleHeartbeatBoundaries(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	zero := &DaemonState{}
	if staleHeartbeat(zero, now, time.Minute) {
		t.Error("zero heartbeat should not be considered stale")
	}
	fresh := &DaemonState{Heartbeat: now.Add(-30 * time.Second)}
	if staleHeartbeat(fresh, now, time.Minute) {
		t.Error("30s old should not be stale at 1m threshold")
	}
	old := &DaemonState{Heartbeat: now.Add(-2 * time.Minute)}
	if !staleHeartbeat(old, now, time.Minute) {
		t.Error("2m old should be stale at 1m threshold")
	}
}

func TestDoctorHealthy(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat: now.Add(-30 * time.Second),
		LastPush:  now.Add(-2 * time.Minute),
	})
	var buf bytes.Buffer
	if err := doctor(&buf, "", now); err != nil {
		t.Fatalf("healthy doctor should return nil, got %v", err)
	}
	out := buf.String()
	for _, want := range []string{"obsidian-memoryd doctor", "heartbeat:", "30s ago", "last successful push", "2m0s ago"} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q\n---\n%s", want, out)
		}
	}
}

func TestDoctorStaleHeartbeat(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat: now.Add(-10 * time.Minute), // stale
	})
	var buf bytes.Buffer
	err := doctor(&buf, "", now)
	if !errors.Is(err, ErrDoctorAlarm) {
		t.Fatalf("stale heartbeat should trigger alarm, got %v", err)
	}
	if !strings.Contains(buf.String(), "daemon may be stopped") {
		t.Errorf("output missing stale marker\n---\n%s", buf.String())
	}
}

func TestDoctorPushFailures(t *testing.T) {
	withTempStateDir(t)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_ = writeState(&DaemonState{
		Heartbeat:               now.Add(-30 * time.Second),
		ConsecutivePushFailures: 4,
	})
	var buf bytes.Buffer
	err := doctor(&buf, "", now)
	if !errors.Is(err, ErrDoctorAlarm) {
		t.Fatalf("4 consecutive push failures should trigger alarm, got %v", err)
	}
	if !strings.Contains(buf.String(), "consecutive push fails:   4") {
		t.Errorf("output missing failure count\n---\n%s", buf.String())
	}
}

func TestRecordPushSuccessResetsFailures(t *testing.T) {
	withTempStateDir(t)
	_ = writeState(&DaemonState{ConsecutivePushFailures: 5})
	recordPushSuccess()
	s := readState()
	if s.ConsecutivePushFailures != 0 {
		t.Errorf("expected 0 after success, got %d", s.ConsecutivePushFailures)
	}
	if s.LastPush.IsZero() {
		t.Error("LastPush should be set after success")
	}
}

func TestRecordPushFailureIncrements(t *testing.T) {
	withTempStateDir(t)
	recordPushFailure()
	recordPushFailure()
	s := readState()
	if s.ConsecutivePushFailures != 2 {
		t.Errorf("expected 2, got %d", s.ConsecutivePushFailures)
	}
}

func TestHeartbeatTickerWrites(t *testing.T) {
	withTempStateDir(t)
	stop := startHeartbeat(50 * time.Millisecond)
	time.Sleep(150 * time.Millisecond)
	stop()
	s := readState()
	if s.Heartbeat.IsZero() {
		t.Error("heartbeat should have been written by ticker")
	}
}

// overwriteFile bypasses atomic write to plant invalid content for the corrupt-file test.
func overwriteFile(fp string, data []byte) error {
	return writeRaw(fp, data)
}
