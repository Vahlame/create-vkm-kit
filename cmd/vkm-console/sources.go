package main

// Data sources for the console. Every collector is fail-soft: a missing or
// broken source returns its struct with OK=false and a human-readable Error —
// the dashboard renders it as "off"; the server never dies because of it.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/adrg/xdg"
)

// paths gathers every filesystem location the console reads. Tests build their
// own instance pointing at temp dirs; main derives one from flags + env.
type paths struct {
	stateFile    string // obsidian-memoryd state.json
	vault        string // vault root; "" when unresolved
	telemetryDir string // vkm-otel-sink NDJSON rollups
	pgRoot       string // per-vault Postgres projection homes (~/.vkm/pg)
	searchLog    string // obscura search log (JSONL)
	downloadsDir string // vkm-downloads target dir (~/Downloads/vkm-kit)
}

func defaultPaths(vault string) paths {
	home, _ := os.UserHomeDir()
	tel := os.Getenv("VKM_TELEMETRY_DIR")
	if tel == "" {
		tel = filepath.Join(home, ".vkm", "telemetry")
	}
	pg := os.Getenv("VKM_PG_DATA_ROOT")
	if pg == "" {
		pg = filepath.Join(home, ".vkm", "pg")
	}
	sl := os.Getenv("OBSCURA_SEARXNG_LOG")
	if sl == "" {
		sl = filepath.Join(home, ".vkm", "searxng", "searches.log")
	}
	return paths{
		stateFile:    daemonStatePath(),
		vault:        vault,
		telemetryDir: tel,
		pgRoot:       pg,
		searchLog:    sl,
		downloadsDir: filepath.Join(home, "Downloads", "vkm-kit"),
	}
}

// daemonStatePath replicates cmd/obsidian-memoryd's state-file resolution
// (state.go stateFilePath): xdg.StateFile("obsidian-memory/state.json"), i.e.
// <xdg.StateHome>/obsidian-memory/state.json — XDG_STATE_HOME when set, else
// %LOCALAPPDATA% on Windows / ~/.local/state on Linux — falling back to
// <os.TempDir()>/obsidian-memory/state.json when the XDG lookup fails. This is
// the read-only variant: it never creates directories and prefers whichever
// file actually exists, defaulting to the canonical XDG location.
func daemonStatePath() string {
	primary := filepath.Join(xdg.StateHome, "obsidian-memory", "state.json")
	if _, err := os.Stat(primary); err == nil {
		return primary
	}
	fallback := filepath.Join(os.TempDir(), "obsidian-memory", "state.json")
	if _, err := os.Stat(fallback); err == nil {
		return fallback
	}
	return primary
}

// ---------------------------------------------------------------------------
// Source 1: obsidian-memoryd health
// ---------------------------------------------------------------------------

// DaemonHealth is the console's view of the memory daemon.
type DaemonHealth struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	// HeartbeatAgeSec is seconds since the daemon's last heartbeat; -1 when the
	// daemon has never written one (expected on a fresh install).
	HeartbeatAgeSec         int64  `json:"heartbeatAgeSec"`
	LastPush                string `json:"lastPush,omitempty"`
	ConsecutivePushFailures int    `json:"consecutivePushFailures"`
	LastRebaseAbort         string `json:"lastRebaseAbort,omitempty"`
	LastSyncError           string `json:"lastSyncError,omitempty"`
}

// daemonState mirrors the subset of cmd/obsidian-memoryd's DaemonState the
// console surfaces. That type lives in package main over there, so it cannot
// be imported — the JSON contract (snake_case field names) is replicated.
type daemonState struct {
	Heartbeat               time.Time `json:"heartbeat"`
	LastPush                time.Time `json:"last_push"`
	LastRebaseAbort         time.Time `json:"last_rebase_abort"`
	ConsecutivePushFailures int       `json:"consecutive_push_failures"`
	LastSyncError           string    `json:"last_sync_error"`
}

func collectDaemon(stateFile string, now time.Time) DaemonHealth {
	data, err := os.ReadFile(stateFile)
	if err != nil {
		return DaemonHealth{HeartbeatAgeSec: -1, Error: "state file not readable: " + stateFile}
	}
	var st daemonState
	if err := json.Unmarshal(data, &st); err != nil {
		return DaemonHealth{HeartbeatAgeSec: -1, Error: "state file corrupt: " + err.Error()}
	}
	d := DaemonHealth{
		OK:                      true,
		HeartbeatAgeSec:         -1,
		ConsecutivePushFailures: st.ConsecutivePushFailures,
		LastSyncError:           st.LastSyncError,
	}
	if !st.Heartbeat.IsZero() {
		age := int64(now.Sub(st.Heartbeat).Seconds())
		if age < 0 {
			age = 0 // clock skew: never report a negative age
		}
		d.HeartbeatAgeSec = age
	}
	if !st.LastPush.IsZero() {
		d.LastPush = st.LastPush.UTC().Format(time.RFC3339)
	}
	if !st.LastRebaseAbort.IsZero() {
		d.LastRebaseAbort = st.LastRebaseAbort.UTC().Format(time.RFC3339)
	}
	return d
}

// ---------------------------------------------------------------------------
// Source 2: vault statistics
// ---------------------------------------------------------------------------

// FolderCount is one top-level folder and how many .md notes live under it.
// "." collects notes sitting at the vault root.
type FolderCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// NoteInfo is one recently modified note (path relative to the vault, slashes
// normalized to forward).
type NoteInfo struct {
	Path  string `json:"path"`
	Mtime string `json:"mtime"`
}

// VaultStats is the console's view of the vault contents.
type VaultStats struct {
	OK             bool          `json:"ok"`
	Error          string        `json:"error,omitempty"`
	TotalNotes     int           `json:"totalNotes"`
	Folders        []FolderCount `json:"folders"`
	Recent         []NoteInfo    `json:"recent"`
	SessionLogTail []string      `json:"sessionLogTail"`
}

// skipDirs are directory basenames never walked (or watched) inside the vault.
var skipDirs = map[string]bool{
	".git":                 true,
	".obsidian":            true,
	".obsidian-memory-rag": true,
	"node_modules":         true,
	".trash":               true,
}

func collectVaultStats(vault string) VaultStats {
	if vault == "" {
		return VaultStats{Error: "no vault configured (--vault / VKM_VAULT / BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT)"}
	}
	if fi, err := os.Stat(vault); err != nil || !fi.IsDir() {
		return VaultStats{Error: "vault not found: " + vault}
	}
	type note struct {
		rel string
		mt  time.Time
	}
	var notes []note
	folders := map[string]int{}
	_ = filepath.WalkDir(vault, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // fail-soft: skip unreadable entries
		}
		if d.IsDir() {
			if path != vault && skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.EqualFold(filepath.Ext(d.Name()), ".md") {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		rel, rerr := filepath.Rel(vault, path)
		if rerr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		top := "."
		if i := strings.IndexByte(rel, '/'); i >= 0 {
			top = rel[:i]
		}
		folders[top]++
		notes = append(notes, note{rel: rel, mt: info.ModTime()})
		return nil
	})

	out := VaultStats{OK: true, TotalNotes: len(notes)}
	for name, count := range folders {
		out.Folders = append(out.Folders, FolderCount{Name: name, Count: count})
	}
	sort.Slice(out.Folders, func(i, j int) bool {
		if out.Folders[i].Count != out.Folders[j].Count {
			return out.Folders[i].Count > out.Folders[j].Count
		}
		return out.Folders[i].Name < out.Folders[j].Name
	})
	sort.Slice(notes, func(i, j int) bool { return notes[i].mt.After(notes[j].mt) })
	for i, n := range notes {
		if i >= 10 {
			break
		}
		out.Recent = append(out.Recent, NoteInfo{Path: n.rel, Mtime: n.mt.UTC().Format(time.RFC3339)})
	}
	out.SessionLogTail = sessionLogTail(vault)
	return out
}

// sessionLogTail returns the last 3 non-empty lines of SESSION_LOG.md as raw
// text. The dashboard assigns them via textContent (never innerHTML), so the
// browser escapes — do not HTML-escape here or the UI would show entities.
func sessionLogTail(vault string) []string {
	data, err := os.ReadFile(filepath.Join(vault, "SESSION_LOG.md"))
	if err != nil {
		return nil
	}
	var lines []string
	for _, ln := range strings.Split(string(data), "\n") {
		ln = strings.TrimRight(ln, "\r")
		if strings.TrimSpace(ln) != "" {
			lines = append(lines, ln)
		}
	}
	if len(lines) > 3 {
		lines = lines[len(lines)-3:]
	}
	return lines
}

// ---------------------------------------------------------------------------
// Source 3: Claude Code telemetry (vkm-otel-sink NDJSON rollups)
// ---------------------------------------------------------------------------

// DayTokens aggregates one daily NDJSON file: total tokens (all token.usage
// types: input, output, cacheRead, cacheCreation) and total cost in USD.
type DayTokens struct {
	Day    string  `json:"day"`
	Tokens float64 `json:"tokens"`
	Cost   float64 `json:"cost"`
}

// ModelTokens is total token.usage per model across the parsed window.
type ModelTokens struct {
	Model  string  `json:"model"`
	Tokens float64 `json:"tokens"`
}

// Telemetry is the console's view of the last 7 daily rollups.
type Telemetry struct {
	OK     bool          `json:"ok"`
	Error  string        `json:"error,omitempty"`
	Days   []DayTokens   `json:"days"`
	Models []ModelTokens `json:"models"`
	// CacheHitRatio = cacheRead / (input + cacheRead + cacheCreation);
	// -1 when no token datapoints were seen.
	CacheHitRatio float64 `json:"cacheHitRatio"`
	// RawLines counts lines kept raw: malformed JSON, `unknown:true` metrics
	// and metric names the console does not aggregate. Never a crash.
	RawLines int `json:"rawLines"`
}

// telemetryLine mirrors one vkm-otel-sink NDJSON rollup line (otel-sink.mjs):
// {"ts":iso,"metric":str,"type":str?,"model":str?,"unknown":bool?,"value":num}.
type telemetryLine struct {
	Ts      string  `json:"ts"`
	Metric  string  `json:"metric"`
	Type    string  `json:"type"`
	Model   string  `json:"model"`
	Unknown bool    `json:"unknown"`
	Value   float64 `json:"value"`
}

var telemetryFileRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}\.ndjson$`)

func collectTelemetry(dir string, maxDays int) Telemetry {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return Telemetry{CacheHitRatio: -1, Error: "telemetry dir not readable: " + dir}
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && telemetryFileRe.MatchString(e.Name()) {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files) // YYYY-MM-DD names: lexicographic == chronological
	if len(files) > maxDays {
		files = files[len(files)-maxDays:]
	}

	out := Telemetry{OK: true, CacheHitRatio: -1}
	dayAgg := map[string]*DayTokens{}
	modelAgg := map[string]float64{}
	var input, cacheRead, cacheCreate float64
	day := func(name string) *DayTokens {
		key := strings.TrimSuffix(name, ".ndjson")
		if dayAgg[key] == nil {
			dayAgg[key] = &DayTokens{Day: key}
		}
		return dayAgg[key]
	}
	for _, name := range files {
		data, rerr := os.ReadFile(filepath.Join(dir, name))
		if rerr != nil {
			out.RawLines++
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var tl telemetryLine
			if uerr := json.Unmarshal([]byte(line), &tl); uerr != nil {
				out.RawLines++ // malformed line: counted, never crashed on
				continue
			}
			if tl.Unknown {
				out.RawLines++
				continue
			}
			switch tl.Metric {
			case "claude_code.token.usage":
				day(name).Tokens += tl.Value
				if tl.Model != "" {
					modelAgg[tl.Model] += tl.Value
				}
				switch tl.Type {
				case "input":
					input += tl.Value
				case "cacheRead":
					cacheRead += tl.Value
				case "cacheCreation":
					cacheCreate += tl.Value
				}
			case "claude_code.cost.usage":
				day(name).Cost += tl.Value
			default:
				out.RawLines++
			}
		}
	}
	for _, dt := range dayAgg {
		out.Days = append(out.Days, *dt)
	}
	sort.Slice(out.Days, func(i, j int) bool { return out.Days[i].Day < out.Days[j].Day })
	for model, tokens := range modelAgg {
		out.Models = append(out.Models, ModelTokens{Model: model, Tokens: tokens})
	}
	sort.Slice(out.Models, func(i, j int) bool {
		if out.Models[i].Tokens != out.Models[j].Tokens {
			return out.Models[i].Tokens > out.Models[j].Tokens
		}
		return out.Models[i].Model < out.Models[j].Model
	})
	if den := input + cacheRead + cacheCreate; den > 0 {
		out.CacheHitRatio = cacheRead / den
	}
	return out
}

// ---------------------------------------------------------------------------
// Source 4: Postgres projection layer (vkm-memory-pg services)
// ---------------------------------------------------------------------------

// pgServiceInfo mirrors <pgRoot>/<slug>/service.json.
type pgServiceInfo struct {
	Port      int    `json:"port"`
	Pid       int    `json:"pid"`
	Vault     string `json:"vault"`
	Version   string `json:"version"`
	StartedAt string `json:"startedAt"`
}

// PgService is one discovered per-vault projection service.
type PgService struct {
	Slug         string          `json:"slug"`
	Vault        string          `json:"vault"`
	Port         int             `json:"port"`
	Pid          int             `json:"pid"`
	Version      string          `json:"version,omitempty"`
	StartedAt    string          `json:"startedAt,omitempty"`
	Alive        bool            `json:"alive"`
	Status       string          `json:"status"` // "running" | "starting" | "stopped"
	StartCommand string          `json:"startCommand,omitempty"`
	Error        string          `json:"error,omitempty"`
	Health       json.RawMessage `json:"health,omitempty"`
	Timeline     json.RawMessage `json:"timeline,omitempty"`
	Stats        json.RawMessage `json:"stats,omitempty"`
	Graph        json.RawMessage `json:"graph,omitempty"`
}

// PgProjection is the console's view of every projection service under pgRoot
// (filtered to the console's vault when one is configured).
type PgProjection struct {
	OK       bool        `json:"ok"`
	Error    string      `json:"error,omitempty"`
	Services []PgService `json:"services"`
}

func collectPg(ctx context.Context, client *http.Client, pgRoot, vaultFilter string) PgProjection {
	entries, err := os.ReadDir(pgRoot)
	if err != nil {
		return PgProjection{Error: "pg data root not found (projection layer off?): " + pgRoot}
	}
	out := PgProjection{OK: true}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(pgRoot, e.Name())
		data, rerr := os.ReadFile(filepath.Join(dir, "service.json"))
		if rerr != nil {
			continue // not a service home
		}
		var info pgServiceInfo
		if uerr := json.Unmarshal(data, &info); uerr != nil {
			continue
		}
		if vaultFilter != "" && !samePath(info.Vault, vaultFilter) {
			continue
		}
		svc := PgService{
			Slug:      e.Name(),
			Vault:     info.Vault,
			Port:      info.Port,
			Pid:       info.Pid,
			Version:   info.Version,
			StartedAt: info.StartedAt,
			Alive:     pidAlive(info.Pid),
		}
		if !svc.Alive {
			// service.lock semantics (pg contract): stale when its pid is dead
			// (process.kill(pid,0) throws). A live lock without a live service
			// pid means a start is in flight; a stale lock is simply ignored.
			if lockPid, ok := readLockPid(dir); ok && pidAlive(lockPid) {
				svc.Status = "starting"
			} else {
				svc.Status = "stopped"
				svc.StartCommand = startCommand(info.Vault)
			}
			out.Services = append(out.Services, svc)
			continue
		}
		token := readServiceToken(dir)
		base := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
		health, herr := httpGetJSON(ctx, client, base+"/api/health", token)
		if herr != nil {
			svc.Status = "stopped"
			svc.Error = "pid alive but health check failed: " + herr.Error()
			svc.StartCommand = startCommand(info.Vault)
			out.Services = append(out.Services, svc)
			continue
		}
		svc.Status = "running"
		svc.Health = health
		if tl, terr := httpGetJSON(ctx, client, base+"/api/timeline?limit=15", token); terr == nil {
			svc.Timeline = tl
		}
		if st, serr := httpGetJSON(ctx, client, base+"/api/stats", token); serr == nil {
			svc.Stats = st
		}
		// Higher cap for the interactive explorer (still bounded for the SSE payload).
		if g, gerr := httpGetJSON(ctx, client, base+"/api/graph?limit=800", token); gerr == nil {
			svc.Graph = g
		}
		out.Services = append(out.Services, svc)
	}
	if vaultFilter != "" && len(out.Services) == 0 {
		out.Error = "no pg service registered for this vault"
	}
	return out
}

// readServiceToken reads <dir>/service.token (random hex, one line).
func readServiceToken(dir string) string {
	data, err := os.ReadFile(filepath.Join(dir, "service.token"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// readLockPid parses <dir>/service.lock ({"pid":N,"port":N}).
func readLockPid(dir string) (int, bool) {
	data, err := os.ReadFile(filepath.Join(dir, "service.lock"))
	if err != nil {
		return 0, false
	}
	var lock struct {
		Pid int `json:"pid"`
	}
	if err := json.Unmarshal(data, &lock); err != nil || lock.Pid <= 0 {
		return 0, false
	}
	return lock.Pid, true
}

// startCommand is the exact command shown to the user to bring a stopped
// projection service back up, in the shell syntax of the current OS.
func startCommand(vault string) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`$env:VKM_PG="1"; npx vkm-pg-service --vault "%s"`, vault)
	}
	return fmt.Sprintf(`VKM_PG=1 npx vkm-pg-service --vault "%s"`, vault)
}

// samePath compares two paths after Abs+Clean, case-insensitively on Windows.
func samePath(a, b string) bool {
	aa, err := filepath.Abs(a)
	if err != nil {
		aa = filepath.Clean(a)
	}
	bb, err := filepath.Abs(b)
	if err != nil {
		bb = filepath.Clean(b)
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(aa, bb)
	}
	return aa == bb
}

// httpGetJSON performs a token-authenticated GET against a pg service endpoint
// with a hard 2s budget and returns the validated raw JSON body.
func httpGetJSON(ctx context.Context, client *http.Client, url, token string) (json.RawMessage, error) {
	rctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("x-vkm-pg-token", token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	if !json.Valid(body) {
		return nil, fmt.Errorf("%s: invalid JSON body", url)
	}
	return json.RawMessage(body), nil
}

// ---------------------------------------------------------------------------
// Source 5: research / search logs
// ---------------------------------------------------------------------------

// SearchEntry mirrors one obscura search-log line (search-log.mjs):
// {"ts":iso,"query":str,"source":str,"count":N}.
type SearchEntry struct {
	Ts     string `json:"ts"`
	Query  string `json:"query"`
	Source string `json:"source"`
	Count  int    `json:"count"`
}

// DownloadEntry is one file in the vkm-downloads target dir.
type DownloadEntry struct {
	Name  string `json:"name"`
	SizeB int64  `json:"sizeB"`
	Mtime string `json:"mtime"`
}

// ResearchLogs is the console's view of recent research activity.
type ResearchLogs struct {
	OK        bool            `json:"ok"`
	Error     string          `json:"error,omitempty"`
	Searches  []SearchEntry   `json:"searches"`
	Downloads []DownloadEntry `json:"downloads"`
}

func collectResearch(searchLog, downloadsDir string) ResearchLogs {
	out := ResearchLogs{}
	var errs []string

	data, serr := os.ReadFile(searchLog)
	if serr != nil {
		errs = append(errs, "search log not readable: "+searchLog)
	} else {
		var lines []string
		for _, ln := range strings.Split(string(data), "\n") {
			if strings.TrimSpace(ln) != "" {
				lines = append(lines, ln)
			}
		}
		if len(lines) > 10 {
			lines = lines[len(lines)-10:]
		}
		for i := len(lines) - 1; i >= 0; i-- { // newest first
			var s SearchEntry
			if json.Unmarshal([]byte(lines[i]), &s) == nil && s.Query != "" {
				out.Searches = append(out.Searches, s)
			}
		}
	}

	entries, derr := os.ReadDir(downloadsDir)
	if derr != nil {
		errs = append(errs, "downloads dir not found: "+downloadsDir)
	} else {
		type df struct {
			name string
			size int64
			mt   time.Time
		}
		var files []df
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			info, ierr := e.Info()
			if ierr != nil {
				continue
			}
			files = append(files, df{name: e.Name(), size: info.Size(), mt: info.ModTime()})
		}
		sort.Slice(files, func(i, j int) bool { return files[i].mt.After(files[j].mt) })
		for i, f := range files {
			if i >= 5 {
				break
			}
			out.Downloads = append(out.Downloads, DownloadEntry{
				Name:  f.name,
				SizeB: f.size,
				Mtime: f.mt.UTC().Format(time.RFC3339),
			})
		}
	}

	// Both sources must succeed for OK — OR would hide a partial failure (e.g. search
	// log readable but downloads dir missing) behind a green card.
	out.OK = len(errs) == 0
	if !out.OK {
		out.Error = strings.Join(errs, "; ")
	}
	return out
}

// ---------------------------------------------------------------------------
// Snapshot: everything the dashboard renders in one JSON document
// ---------------------------------------------------------------------------

// Snapshot is the full console state at one instant.
type Snapshot struct {
	GeneratedAt string       `json:"generatedAt"`
	Version     string       `json:"version"`
	Vault       string       `json:"vault"`
	Daemon      DaemonHealth `json:"daemon"`
	VaultStats  VaultStats   `json:"vaultStats"`
	Telemetry   Telemetry    `json:"telemetry"`
	Pg          PgProjection `json:"pg"`
	Research    ResearchLogs `json:"research"`
}

func (s *server) collectSnapshot(ctx context.Context) Snapshot {
	now := time.Now().UTC()
	return Snapshot{
		GeneratedAt: now.Format(time.RFC3339),
		Version:     s.version,
		Vault:       s.p.vault,
		Daemon:      collectDaemon(s.p.stateFile, now),
		VaultStats:  collectVaultStats(s.p.vault),
		Telemetry:   collectTelemetry(s.p.telemetryDir, 7),
		Pg:          collectPg(ctx, s.client, s.p.pgRoot, s.p.vault),
		Research:    collectResearch(s.p.searchLog, s.p.downloadsDir),
	}
}
