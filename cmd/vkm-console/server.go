package main

// HTTP surface: embedded single-page dashboard + JSON/SSE API. Everything is
// same-origin and self-contained (CSP default-src 'self'; no external assets).
//
// Auth model:
//   - /api/health — ungated liveness probe
//   - /static/*   — loopback Host only (CSS/JS are not secrets; gating them
//                   broke the dashboard: the HTML arrived with ?token= but
//                   subresource requests did not, so the page painted blank)
//   - everything else — loopback Host + per-run token (query, header, or cookie)

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

const (
	consoleCookie = "vkm-console-token"
	// consolePolicy is set on EVERY response. frame-ancestors is NOT covered by
	// default-src (CSP3), so it is listed explicitly.
	consolePolicy = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
)

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
	gateHTML  []byte
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
	var err error
	if s.indexHTML, err = webFS.ReadFile("web/index.html"); err != nil {
		panic("vkm-console: embed missing web/index.html: " + err.Error())
	}
	if s.gateHTML, err = webFS.ReadFile("web/gate.html"); err != nil {
		panic("vkm-console: embed missing web/gate.html: " + err.Error())
	}
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
				// second route. gate.html is also not served as a static file
				// (only via the 403 path).
				p := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
				if p == "." || p == "index.html" || p == "gate.html" {
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

// ServeHTTP is the console-wide middleware in front of the mux: CSP + nosniff
// on every response, then the auth gate.
func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", consolePolicy)
	w.Header().Set("X-Content-Type-Options", "nosniff")

	if r.URL.Path == "/api/health" {
		s.mux.ServeHTTP(w, r)
		return
	}
	if !s.loopbackHost(r) {
		s.reject(w, r)
		return
	}
	// Static assets: loopback is enough. Token-gating them left the dashboard
	// blank — HTML loaded with ?token= but <link>/<script> did not carry it.
	if strings.HasPrefix(r.URL.Path, "/static/") {
		s.mux.ServeHTTP(w, r)
		return
	}
	if !s.tokenOK(r) {
		s.reject(w, r)
		return
	}
	// First successful visit with ?token= plants a cookie so later navigations
	// (and subresource-adjacent flows) keep working without re-pasting the URL.
	if q := r.URL.Query().Get("token"); q != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     consoleCookie,
			Value:    s.token,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteStrictMode,
			// Secure omitted: the console is http://127.0.0.1 by design.
		})
	}
	s.mux.ServeHTTP(w, r)
}

func (s *server) loopbackHost(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	return host == "127.0.0.1" || host == "::1" || host == "localhost"
}

// tokenOK accepts the per-run token from query, header, or session cookie.
func (s *server) tokenOK(r *http.Request) bool {
	tok := r.URL.Query().Get("token")
	if tok == "" {
		tok = r.Header.Get("x-vkm-console-token")
	}
	if tok == "" {
		if c, err := r.Cookie(consoleCookie); err == nil {
			tok = c.Value
		}
	}
	return subtle.ConstantTimeCompare([]byte(tok), []byte(s.token)) == 1
}

// reject answers 403. For the document root it serves the gate page (so the
// browser is never a blank white sheet); APIs get a plain forbidden body.
func (s *server) reject(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write(s.gateHTML)
		return
	}
	http.Error(w, "forbidden", http.StatusForbidden)
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
