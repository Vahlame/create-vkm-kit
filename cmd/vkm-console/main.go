// Command vkm-console serves the real-time dashboard for the whole vkm kit:
// memory daemon health, vault stats, Claude Code telemetry, the Postgres
// projection layer and research/search logs. It binds 127.0.0.1 ONLY and never
// opens a browser or creates a window on its own — the browser opens only when
// the user explicitly passes --open (focus-steal rule, ADR-0078).
package main

import (
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// version is the console version. Override at build time with:
//
//	go build -ldflags="-X main.version=5.5.1" ./cmd/vkm-console
//
// Keep in sync with agent.toml.
var version = "5.5.1"

// defaultVault resolves the vault the same way the rest of the kit does
// (pg contract precedence): VKM_VAULT, then BASIC_MEMORY_HOME, then
// OBSIDIAN_MEMORY_VAULT. Empty means "no vault" — the console still runs,
// vault-backed cards just render as off.
func defaultVault() string {
	for _, k := range []string{"VKM_VAULT", "BASIC_MEMORY_HOME", "OBSIDIAN_MEMORY_VAULT"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

// envInt reads an integer env var, falling back to def when unset or invalid.
func envInt(key string, def int) int {
	if s := os.Getenv(key); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func main() {
	fs := flag.NewFlagSet("vkm-console", flag.ExitOnError)
	port := fs.Int("port", envInt("VKM_CONSOLE_PORT", 4930),
		"TCP port to listen on (127.0.0.1 only; env VKM_CONSOLE_PORT)")
	vault := fs.String("vault", defaultVault(),
		"vault root (default: VKM_VAULT, BASIC_MEMORY_HOME or OBSIDIAN_MEMORY_VAULT)")
	open := fs.Bool("open", false,
		"open the dashboard in the default browser (explicit opt-in; NEVER automatic)")
	refresh := fs.Int("refresh", 5, "seconds between periodic snapshot pushes on /api/events")
	_ = fs.Parse(os.Args[1:]) // ExitOnError: Parse never returns a non-nil error

	v := *vault
	if v != "" {
		if abs, err := filepath.Abs(v); err == nil {
			v = abs
		}
	}
	if *refresh < 1 {
		*refresh = 1
	}

	srv := newServer(version, defaultPaths(v), time.Duration(*refresh)*time.Second, 25*time.Second)
	defer srv.Close()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		fmt.Fprintln(os.Stderr, "vkm-console: listen:", err)
		os.Exit(1)
	}
	// The URL embeds the per-run auth token: without it every route except
	// /api/health answers 403, so the printed/opened URL is the credential.
	url := fmt.Sprintf("http://127.0.0.1:%d/?token=%s", ln.Addr().(*net.TCPAddr).Port, srv.token)
	vaultLabel := v
	if vaultLabel == "" {
		vaultLabel = "(none)"
	}
	fmt.Printf("vkm-console %s listening on %s (vault: %s)\n", version, url, vaultLabel)

	if *open {
		if err := openBrowser(url); err != nil {
			fmt.Fprintln(os.Stderr, "vkm-console: --open failed:", err)
		}
	}

	if err := http.Serve(ln, srv); err != nil {
		fmt.Fprintln(os.Stderr, "vkm-console: serve:", err)
		os.Exit(1)
	}
}
