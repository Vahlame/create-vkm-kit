package main

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// authedRequest builds a request that passes the console gate: a loopback
// Host plus the per-run token in the x-vkm-console-token header.
func authedRequest(s *server, method, target string) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	req.Host = "127.0.0.1:4930"
	req.Header.Set("x-vkm-console-token", s.token)
	return req
}

func TestIndexAndStaticServedFromEmbed(t *testing.T) {
	s := newServer("test", emptyPaths(t), time.Hour, time.Hour)
	defer s.Close()

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, authedRequest(s, "GET", "/"))
	if rec.Code != 200 {
		t.Fatalf("/: want 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("/: content type %q", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "vkm-console") || !strings.Contains(body, "/static/app.js") {
		t.Fatalf("/ does not look like the embedded dashboard:\n%.200s", body)
	}
	if rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("/ must carry a CSP header")
	}

	for _, asset := range []string{"/static/app.js", "/static/style.css"} {
		rec = httptest.NewRecorder()
		s.ServeHTTP(rec, authedRequest(s, "GET", asset))
		if rec.Code != 200 || rec.Body.Len() == 0 {
			t.Fatalf("%s: want 200 with body, got %d (%d bytes)", asset, rec.Code, rec.Body.Len())
		}
	}

	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, authedRequest(s, "GET", "/definitely-not-here"))
	if rec.Code != 404 {
		t.Fatalf("unknown path: want 404, got %d", rec.Code)
	}
}

// The dashboard HTML must be served ONLY at "/": the static file server must
// not duplicate the entry point at /static/ (directory index) nor
// /static/index.html.
func TestStaticNeverServesIndexHTML(t *testing.T) {
	s := newServer("test", emptyPaths(t), time.Hour, time.Hour)
	defer s.Close()

	for _, target := range []string{"/static/", "/static/index.html"} {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, authedRequest(s, "GET", target))
		if rec.Code != 404 {
			t.Fatalf("%s: want 404, got %d\n%.200s", target, rec.Code, rec.Body.String())
		}
	}
}

// Every response — HTML, static assets, JSON, even 403s — must carry the CSP,
// since it is set by the middleware, not per handler.
func TestCSPOnEveryResponse(t *testing.T) {
	s := newServer("test", emptyPaths(t), time.Hour, time.Hour)
	defer s.Close()

	for _, target := range []string{"/", "/static/app.js", "/static/style.css", "/api/snapshot", "/api/health"} {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, authedRequest(s, "GET", target))
		if rec.Header().Get("Content-Security-Policy") != consolePolicy {
			t.Fatalf("%s: missing/wrong CSP header: %q", target, rec.Header().Get("Content-Security-Policy"))
		}
	}
	// Even the 403 rejection carries it.
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != 403 || rec.Header().Get("Content-Security-Policy") != consolePolicy {
		t.Fatalf("403 response: code %d, CSP %q", rec.Code, rec.Header().Get("Content-Security-Policy"))
	}
}

// The auth gate: loopback Host AND per-run token, on every route except
// /api/health.
func TestAuthGate(t *testing.T) {
	s := newServer("test", emptyPaths(t), time.Hour, time.Hour)
	defer s.Close()

	serve := func(req *http.Request) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		return rec
	}

	// No token → 403 on every gated route, even from a loopback Host.
	for _, target := range []string{"/", "/api/snapshot", "/api/events", "/static/app.js"} {
		req := httptest.NewRequest("GET", target, nil)
		req.Host = "127.0.0.1:4930"
		if rec := serve(req); rec.Code != 403 {
			t.Fatalf("%s without token: want 403, got %d", target, rec.Code)
		}
	}

	// Wrong token → 403.
	req := httptest.NewRequest("GET", "/api/snapshot", nil)
	req.Host = "127.0.0.1:4930"
	req.Header.Set("x-vkm-console-token", strings.Repeat("0", 32))
	if rec := serve(req); rec.Code != 403 {
		t.Fatalf("wrong token: want 403, got %d", rec.Code)
	}

	// Right token but non-loopback Host (DNS rebinding) → 403.
	// httptest.NewRequest defaults Host to "example.com".
	req = httptest.NewRequest("GET", "/api/snapshot", nil)
	req.Header.Set("x-vkm-console-token", s.token)
	if rec := serve(req); rec.Code != 403 {
		t.Fatalf("rebound Host: want 403, got %d", rec.Code)
	}

	// Loopback Host + token → 200, via header and via ?token= query, for every
	// accepted loopback spelling (port stripped, brackets tolerated).
	for _, host := range []string{"127.0.0.1:4930", "localhost:4930", "[::1]:4930", "127.0.0.1", "localhost", "[::1]"} {
		req = httptest.NewRequest("GET", "/api/snapshot", nil)
		req.Host = host
		req.Header.Set("x-vkm-console-token", s.token)
		if rec := serve(req); rec.Code != 200 {
			t.Fatalf("host %q + header token: want 200, got %d", host, rec.Code)
		}
	}
	req = httptest.NewRequest("GET", "/api/snapshot?token="+s.token, nil)
	req.Host = "127.0.0.1:4930"
	if rec := serve(req); rec.Code != 200 {
		t.Fatalf("query token: want 200, got %d", rec.Code)
	}

	// /api/health is the ONE ungated route: no token, foreign Host, still 200.
	req = httptest.NewRequest("GET", "/api/health", nil)
	if rec := serve(req); rec.Code != 200 {
		t.Fatalf("/api/health must not require auth: got %d", rec.Code)
	}
}

func TestHealthEndpoint(t *testing.T) {
	s := newServer("9.9.9", emptyPaths(t), time.Hour, time.Hour)
	defer s.Close()
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"9.9.9"`) {
		t.Fatalf("health: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSSESendsHelloSnapshotAndHeartbeat(t *testing.T) {
	// Long refresh so the periodic tick never fires; short heartbeat so the
	// test sees an `:hb` comment within milliseconds.
	s := newServer("test", emptyPaths(t), time.Hour, 40*time.Millisecond)
	defer s.Close()
	ts := httptest.NewServer(s)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// ts.URL is http://127.0.0.1:<port>, so the Host check passes naturally;
	// the token travels as a query parameter, same as the real EventSource.
	req, err := http.NewRequestWithContext(ctx, "GET", ts.URL+"/api/events?token="+s.token, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("content type: %q", ct)
	}

	var sawHello, sawSnapshot, sawHeartbeat bool
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 1<<20), 1<<20) // snapshot frames can be long
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "event: hello":
			sawHello = true
		case line == "event: snapshot":
			sawSnapshot = true
		case strings.HasPrefix(line, ":hb"):
			sawHeartbeat = true
		}
		if sawHello && sawSnapshot && sawHeartbeat {
			break
		}
	}
	if !sawHello || !sawSnapshot || !sawHeartbeat {
		t.Fatalf("stream incomplete: hello=%v snapshot=%v heartbeat=%v (scan err: %v)",
			sawHello, sawSnapshot, sawHeartbeat, sc.Err())
	}
}
