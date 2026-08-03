package main

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// deadPid is a pid that cannot belong to a live process: far beyond Windows'
// DWORD-multiple-of-4 allocations in practice and beyond Linux pid_max, so
// OpenProcess / kill(0) both report "no such process".
const deadPid = 1 << 30

func TestCollectTelemetryParsesFixtureAndCountsRawLines(t *testing.T) {
	dir := t.TempDir()
	day1 := strings.Join([]string{
		`{"ts":"2026-07-30T10:00:00Z","metric":"claude_code.token.usage","type":"input","model":"claude-opus-5","value":100}`,
		`{"ts":"2026-07-30T10:00:00Z","metric":"claude_code.token.usage","type":"output","model":"claude-opus-5","value":50}`,
		`{"ts":"2026-07-30T10:00:00Z","metric":"claude_code.token.usage","type":"cacheRead","model":"claude-opus-5","value":900}`,
		`{"ts":"2026-07-30T10:00:00Z","metric":"claude_code.token.usage","type":"cacheCreation","model":"claude-opus-5","value":0}`,
		`{"ts":"2026-07-30T10:00:00Z","metric":"claude_code.cost.usage","model":"claude-opus-5","value":1.5}`,
		`{"ts":"2026-07-30T10:00:00Z","metric":"claude_code.lines_of_code.count","type":"added","model":"claude-opus-5","unknown":true,"value":66}`,
		`this line is not JSON at all {{{`,
		`{"ts":"2026-07-30T10:00:00Z","metric":"claude_code.some.future_metric","value":3}`,
	}, "\n") + "\n"
	if err := os.WriteFile(filepath.Join(dir, "2026-07-30.ndjson"), []byte(day1), 0o644); err != nil {
		t.Fatal(err)
	}
	day2 := `{"ts":"2026-07-31T10:00:00Z","metric":"claude_code.token.usage","type":"output","model":"claude-sonnet-4-5","value":25}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, "2026-07-31.ndjson"), []byte(day2), 0o644); err != nil {
		t.Fatal(err)
	}
	// A non-matching file name must be ignored entirely.
	if err := os.WriteFile(filepath.Join(dir, "sink.lock"), []byte(`{"pid":1,"port":2}`), 0o644); err != nil {
		t.Fatal(err)
	}

	got := collectTelemetry(dir, 7)
	if !got.OK {
		t.Fatalf("expected OK, got error %q", got.Error)
	}
	if len(got.Days) != 2 {
		t.Fatalf("expected 2 days, got %+v", got.Days)
	}
	if got.Days[0].Day != "2026-07-30" || got.Days[0].Tokens != 1050 {
		t.Fatalf("day1 aggregation wrong: %+v", got.Days[0])
	}
	if got.Days[0].Cost != 1.5 {
		t.Fatalf("day1 cost wrong: %+v", got.Days[0])
	}
	if got.Days[1].Day != "2026-07-31" || got.Days[1].Tokens != 25 {
		t.Fatalf("day2 aggregation wrong: %+v", got.Days[1])
	}
	if len(got.Models) != 2 || got.Models[0].Model != "claude-opus-5" || got.Models[0].Tokens != 1050 {
		t.Fatalf("models aggregation wrong: %+v", got.Models)
	}
	// cacheRead / (input + cacheRead + cacheCreation) = 900 / 1000
	if got.CacheHitRatio != 0.9 {
		t.Fatalf("cache hit ratio: want 0.9, got %v", got.CacheHitRatio)
	}
	// malformed line + unknown:true line + unaggregated future metric = 3
	if got.RawLines != 3 {
		t.Fatalf("raw lines: want 3, got %d", got.RawLines)
	}
}

func TestCollectTelemetryKeepsOnlyLastSevenDays(t *testing.T) {
	dir := t.TempDir()
	for i := 1; i <= 9; i++ {
		name := time.Date(2026, 7, i, 0, 0, 0, 0, time.UTC).Format("2006-01-02") + ".ndjson"
		line := `{"ts":"2026-07-01T00:00:00Z","metric":"claude_code.token.usage","type":"input","value":1}` + "\n"
		if err := os.WriteFile(filepath.Join(dir, name), []byte(line), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got := collectTelemetry(dir, 7)
	if len(got.Days) != 7 {
		t.Fatalf("want 7 days, got %d", len(got.Days))
	}
	if got.Days[0].Day != "2026-07-03" || got.Days[6].Day != "2026-07-09" {
		t.Fatalf("window wrong: %+v", got.Days)
	}
}

func TestCollectTelemetryMissingDirIsOff(t *testing.T) {
	got := collectTelemetry(filepath.Join(t.TempDir(), "does-not-exist"), 7)
	if got.OK || got.Error == "" {
		t.Fatalf("expected fail-soft off state, got %+v", got)
	}
	if got.CacheHitRatio != -1 {
		t.Fatalf("expected ratio -1, got %v", got.CacheHitRatio)
	}
}

func TestCollectVaultStatsWalksAndSkips(t *testing.T) {
	vault := t.TempDir()
	write := func(rel, content string) {
		t.Helper()
		fp := filepath.Join(vault, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(fp), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fp, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("PROJECTS/alpha.md", "# a")
	write("PROJECTS/beta.md", "# b")
	write("STACKS/go.md", "# go")
	write("START_HERE.md", "# hi")
	write("SESSION_LOG.md", "line one\n\nline two\r\nline <three> & last\n\n")
	write("notes.txt", "not a note")
	write(".git/objects/ignored.md", "x")
	write(".obsidian/plugin.md", "x")
	write(".obsidian-memory-rag/idx.md", "x")
	write("node_modules/pkg/readme.md", "x")
	write(".trash/gone.md", "x")

	vs := collectVaultStats(vault)
	if !vs.OK {
		t.Fatalf("expected OK, got %q", vs.Error)
	}
	// PROJECTS/alpha, PROJECTS/beta, STACKS/go, START_HERE, SESSION_LOG = 5
	if vs.TotalNotes != 5 {
		t.Fatalf("total notes: want 5, got %d (%+v)", vs.TotalNotes, vs.Recent)
	}
	byName := map[string]int{}
	for _, f := range vs.Folders {
		byName[f.Name] = f.Count
	}
	if byName["PROJECTS"] != 2 || byName["STACKS"] != 1 || byName["."] != 2 {
		t.Fatalf("folder counts wrong: %+v", vs.Folders)
	}
	if len(vs.Recent) != 5 {
		t.Fatalf("recent: want 5 entries, got %d", len(vs.Recent))
	}
	for _, n := range vs.Recent {
		if strings.Contains(n.Path, "\\") {
			t.Fatalf("recent path not slash-normalized: %q", n.Path)
		}
	}
	// Raw text — the dashboard assigns via textContent (no HTML escape on the wire).
	want := []string{"line one", "line two", "line <three> & last"}
	if len(vs.SessionLogTail) != 3 {
		t.Fatalf("session log tail: want 3 lines, got %+v", vs.SessionLogTail)
	}
	for i, w := range want {
		if vs.SessionLogTail[i] != w {
			t.Fatalf("tail[%d]: want %q, got %q", i, w, vs.SessionLogTail[i])
		}
	}
}

func TestCollectVaultStatsNoVault(t *testing.T) {
	vs := collectVaultStats("")
	if vs.OK || vs.Error == "" {
		t.Fatalf("expected off state for empty vault, got %+v", vs)
	}
	vs = collectVaultStats(filepath.Join(t.TempDir(), "missing"))
	if vs.OK {
		t.Fatalf("expected off state for missing vault, got %+v", vs)
	}
}

func TestCollectPgDiscoveryDeadPidAndStaleLock(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "myvault-abcd1234")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	vaultPath := filepath.Join(root, "the-vault")
	svcJSON := `{"port":65500,"pid":` + itoa(deadPid) + `,"vault":` + jsonString(vaultPath) +
		`,"version":"5.4.0","startedAt":"2026-08-01T00:00:00Z"}`
	if err := os.WriteFile(filepath.Join(dir, "service.json"), []byte(svcJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "service.token"), []byte("deadbeef\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A lock whose pid is dead is STALE: it must not resurrect the service.
	lock := `{"pid":` + itoa(deadPid) + `,"port":65500}`
	if err := os.WriteFile(filepath.Join(dir, "service.lock"), []byte(lock), 0o644); err != nil {
		t.Fatal(err)
	}

	client := &http.Client{Timeout: 100 * time.Millisecond}
	pg := collectPg(context.Background(), client, root, "")
	if !pg.OK {
		t.Fatalf("expected OK scan, got %q", pg.Error)
	}
	if len(pg.Services) != 1 {
		t.Fatalf("want 1 service, got %+v", pg.Services)
	}
	svc := pg.Services[0]
	if svc.Alive {
		t.Fatal("dead pid reported alive")
	}
	if svc.Status != "stopped" {
		t.Fatalf("stale lock must leave status stopped, got %q", svc.Status)
	}
	if svc.StartCommand == "" || !strings.Contains(svc.StartCommand, "vkm-pg-service") {
		t.Fatalf("stopped service must carry the start command, got %q", svc.StartCommand)
	}
	if svc.Slug != "myvault-abcd1234" || svc.Port != 65500 {
		t.Fatalf("service fields wrong: %+v", svc)
	}

	// Vault filter that matches nothing: no services, explanatory error.
	pg = collectPg(context.Background(), client, root, filepath.Join(root, "other-vault"))
	if len(pg.Services) != 0 || pg.Error == "" {
		t.Fatalf("expected empty filtered result with error, got %+v", pg)
	}

	// Vault filter that matches: service is kept.
	pg = collectPg(context.Background(), client, root, vaultPath)
	if len(pg.Services) != 1 {
		t.Fatalf("expected vault-matched service, got %+v", pg)
	}
}

func TestCollectPgMissingRootIsOff(t *testing.T) {
	client := &http.Client{Timeout: 100 * time.Millisecond}
	pg := collectPg(context.Background(), client, filepath.Join(t.TempDir(), "nope"), "")
	if pg.OK || pg.Error == "" {
		t.Fatalf("expected off state, got %+v", pg)
	}
}

func TestCollectResearchTailAndDownloads(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "searches.log")
	var lines []string
	for i := 0; i < 12; i++ {
		lines = append(lines, `{"ts":"2026-08-01T00:00:0`+itoa(i%10)+`Z","query":"q`+itoa(i)+`","source":"searxng","count":5}`)
	}
	lines = append(lines, "not json either")
	if err := os.WriteFile(logPath, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	dl := filepath.Join(dir, "downloads")
	if err := os.MkdirAll(dl, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dl, "a.iso"), []byte("xx"), 0o644); err != nil {
		t.Fatal(err)
	}

	r := collectResearch(logPath, dl)
	if !r.OK {
		t.Fatalf("expected OK, got %q", r.Error)
	}
	// Last 10 raw lines include the malformed one, which is skipped: 9 parsed.
	if len(r.Searches) != 9 {
		t.Fatalf("want 9 searches, got %d", len(r.Searches))
	}
	if r.Searches[0].Query != "q11" { // newest first
		t.Fatalf("searches not newest-first: %+v", r.Searches[0])
	}
	if len(r.Downloads) != 1 || r.Downloads[0].Name != "a.iso" || r.Downloads[0].SizeB != 2 {
		t.Fatalf("downloads wrong: %+v", r.Downloads)
	}

	// Partial failure: one source missing must NOT report OK (regression: used ||).
	partial := collectResearch(logPath, filepath.Join(dir, "missing-downloads"))
	if partial.OK {
		t.Fatalf("expected !OK when downloads dir is missing, got OK with %d searches", len(partial.Searches))
	}
	if partial.Error == "" {
		t.Fatal("expected Error to name the missing source")
	}
}

func TestCollectDaemonReadsStateFile(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "state.json")
	now := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)
	state := `{"heartbeat":"2026-08-02T11:59:30Z","last_push":"2026-08-02T11:00:00Z",` +
		`"consecutive_push_failures":2,"last_rebase_abort":"2026-08-01T09:00:00Z",` +
		`"last_sync_error":"push rejected"}`
	if err := os.WriteFile(fp, []byte(state), 0o644); err != nil {
		t.Fatal(err)
	}
	d := collectDaemon(fp, now)
	if !d.OK {
		t.Fatalf("expected OK, got %q", d.Error)
	}
	if d.HeartbeatAgeSec != 30 {
		t.Fatalf("heartbeat age: want 30, got %d", d.HeartbeatAgeSec)
	}
	if d.LastPush != "2026-08-02T11:00:00Z" || d.ConsecutivePushFailures != 2 {
		t.Fatalf("daemon fields wrong: %+v", d)
	}
	if d.LastRebaseAbort != "2026-08-01T09:00:00Z" || d.LastSyncError != "push rejected" {
		t.Fatalf("daemon fields wrong: %+v", d)
	}

	// Missing and corrupt files are off, never fatal.
	if got := collectDaemon(filepath.Join(dir, "missing.json"), now); got.OK || got.HeartbeatAgeSec != -1 {
		t.Fatalf("missing state: %+v", got)
	}
	if err := os.WriteFile(fp, []byte("{corrupt"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := collectDaemon(fp, now); got.OK {
		t.Fatalf("corrupt state must be off: %+v", got)
	}
}

// itoa avoids pulling strconv into every literal in the fixtures above.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// jsonString JSON-quotes a string (Windows paths need their backslashes escaped).
func jsonString(s string) string {
	out := strings.ReplaceAll(s, `\`, `\\`)
	out = strings.ReplaceAll(out, `"`, `\"`)
	return `"` + out + `"`
}
