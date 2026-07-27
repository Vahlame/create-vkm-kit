// Command obsidian-memoryd watches a vault and debounces git sync (v2 daemon).
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"
)

// version is the daemon version. Override at build time with:
//
//	go build -ldflags="-X main.version=5.0.0" ./cmd/obsidian-memoryd
//
// Keep in sync with agent.toml.
var version = "5.0.0"

const usage = `obsidian-memoryd — vault git sync helper

Usage:
  obsidian-memoryd version
  obsidian-memoryd watch [--vault PATH]
  obsidian-memoryd sync once [--vault PATH]
  obsidian-memoryd doctor [--vault PATH]
  obsidian-memoryd service <install|uninstall|start|stop|status> [--user]
  obsidian-memoryd inspect --last N

Environment:
  BASIC_MEMORY_HOME or OBSIDIAN_MEMORY_VAULT — vault root (git repo)
  OBSIDIAN_MEMORY_DEBOUNCE — optional debounce before git sync after file changes (Go duration, e.g. 30s, 2m); default 45s; min 5s, max 15m
  OBSIDIAN_MEMORY_AGENT — optional label added as an "Agent:" trailer on auto-commits (attributes this daemon instance/machine in git log)
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	l := newLogger()
	ctx := context.Background()
	switch os.Args[1] {
	case "version":
		fmt.Println("obsidian-memoryd " + version)
	case "watch":
		v := vaultPath(flagValue(os.Args[2:], "--vault", defaultVault()))
		if err := runWatch(ctx, l, v); err != nil {
			l.Error("watch failed", "err", err)
			os.Exit(1)
		}
	case "sync":
		if len(os.Args) < 3 || os.Args[2] != "once" {
			fmt.Fprint(os.Stderr, usage)
			os.Exit(2)
		}
		v := vaultPath(flagValue(os.Args[3:], "--vault", defaultVault()))
		if err := gitSync(ctx, l, v); err != nil && !errors.Is(err, ErrSyncBusy) {
			l.Error("sync failed", "err", err)
			os.Exit(1)
		}
	case "service":
		if len(os.Args) < 3 {
			fmt.Fprint(os.Stderr, usage)
			os.Exit(2)
		}
		if err := runService(os.Args[2], os.Args[3:], l); err != nil {
			l.Error("service", "err", err)
			os.Exit(1)
		}
	case "inspect":
		n := 10
		args := os.Args[2:]
		for i := 0; i < len(args); i++ {
			if args[i] == "--last" && i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%d", &n)
			}
		}
		if err := inspectLogs(l, n); err != nil {
			l.Error("inspect", "err", err)
			os.Exit(1)
		}
	case "doctor":
		v := vaultPath(flagValue(os.Args[2:], "--vault", defaultVault()))
		if err := doctor(os.Stdout, v, time.Now().UTC()); err != nil {
			os.Exit(1)
		}
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
}
