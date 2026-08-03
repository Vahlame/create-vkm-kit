package main

// HTTP surface: embedded single-page dashboard + JSON/SSE API. Everything is
// same-origin and self-contained (CSP default-src 'self'; no external assets),
// and every route except /api/health sits behind a per-run token + loopback
// Host gate (see ServeHTTP).

import (
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed web
var webFS embed.FS

// consolePolicy is set on EVERY response (middleware, not per-handler), so the
// dashboard HTML can never be reached — from any route — without it. It is the
// defense-in-depth layer in front of app.js's innerHTML sink.
const consolePolicy = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"

// newConsoleToken returns the per-run auth token: 32 hex chars from
// crypto/rand. A weak token here would nullify the pg service's own token
// boundary (the console republishes its token-gated data), so failure to get
// entropy is fatal rather than degraded.
func newConsoleToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("vkm-console: crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)
}

// server wires the data sources to the HTTP mux. heartbeat (SSE comment
// cadence) and refresh (periodic snapshot cadence) are fields so tests can
// shrink them.
type server struct {
	version   string
	token     string // per-run auth token, embedded in the printed/opened URL
	p         paths
	refresh   time.Duration
	heartbeat time.Duration
	client    *http.Client
	mux       *http.ServeMux
	bc        *broadcaster
	indexHTML []byte
}

func newServer(version string, p paths, refresh, heartbeat time.Duration) *server {
	s := &server{
		version:   version,
		token:     newConsoleToken(),
		p:         p,
		refresh:   refresh,
		heartbeat: heartbeat,
		client:    &http.Client{Timeout: 2 * time.Second},
	}
	s.indexHTML, _ = webFS.ReadFile("web/index.html")
	s.bc = newBroadcaster(watchDirs(p), 2*time.Second)

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	static, err := fs.Sub(webFS, "web")
	if err == nil {
		fileServer := http.FileServerFS(static)
		mux.Handle("/static/", http.StripPrefix("/static/",
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// The dashboard HTML is served ONLY at "/" — never as a static
				// asset. Without this, "/static/" (directory index) and
				// "/static/index.html" would duplicate the entry point on a
				// second route.
				p := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
				if p == "." || p == "index.html" {
					http.NotFound(w, r)
					return
				}
				fileServer.ServeHTTP(w, r)
			})))
	}
	mux.HandleFunc("/api/snapshot", s.handleSnapshot)
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.HandleFunc("/api/health", s.handleHealth)
	s.mux = mux
	return s
}

// ServeHTTP is the console-wide middleware in front of the mux: the CSP on
// every response, then the auth gate on every route except /api/health.
func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", consolePolicy)
	if r.URL.Path != "/api/health" && !s.authorized(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	s.mux.ServeHTTP(w, r)
}

// authorized enforces the two conditions of the local gate:
//
//  1. the Host header (port stripped) must be 127.0.0.1, ::1 or localhost —
//     this defeats DNS rebinding, where a hostile page's hostname resolves to
//     127.0.0.1 but its Host header still names the attacker's domain; and
//  2. the request must carry the per-run token (?token= query or
//     x-vkm-console-token header) — this restores the cross-user boundary on
//     multi-user machines, mirroring the pg service's own token scheme.
func (s *server) authorized(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	if host != "127.0.0.1" && host != "::1" && host != "localhost" {
		return false
	}
	tok := r.URL.Query().Get("token")
	if tok == "" {
		tok = r.Header.Get("x-vkm-console-token")
	}
	return subtle.ConstantTimeCompare([]byte(tok), []byte(s.token)) == 1
}

// Close releases the filesystem watcher. Safe to call more than once.
func (s *server) Close() {
	if s.bc != nil {
		s.bc.Close()
	}
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	// Everything the page needs is served by this same 127.0.0.1 origin; the
	// CSP (set for every response by the ServeHTTP middleware) makes that a
	// hard rule — no inline handlers, no external assets.
	h.Set("Cache-Control", "no-cache")
	_, _ = w.Write(s.indexHTML)
}

func (s *server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	snap := s.collectSnapshot(r.Context())
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(snap)
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "version": s.version})
}
