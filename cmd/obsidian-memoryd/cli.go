package main

// Subcommand dispatch, and the small helpers that turn argv and the environment
// into the values every command needs.

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/adrg/xdg"
	"gopkg.in/natefinch/lumberjack.v2"
)

func defaultVault() string {
	if v := os.Getenv("BASIC_MEMORY_HOME"); v != "" {
		return v
	}
	if v := os.Getenv("OBSIDIAN_MEMORY_VAULT"); v != "" {
		return v
	}
	wd, _ := os.Getwd()
	return wd
}

func vaultPath(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}

// watchDebounce returns how long to wait after the last fs event before running git sync.
// Default is conservative so editors that save often do not hammer git remotes.

// watchDebounce returns how long to wait after the last fs event before running git sync.
// Default is conservative so editors that save often do not hammer git remotes.
func watchDebounce() time.Duration {
	const (
		defaultDur = 45 * time.Second
		minDur     = 5 * time.Second
		maxDur     = 15 * time.Minute
	)
	s := strings.TrimSpace(os.Getenv("OBSIDIAN_MEMORY_DEBOUNCE"))
	if s == "" {
		return defaultDur
	}
	d, err := time.ParseDuration(s)
	if err != nil || d < minDur {
		return defaultDur
	}
	if d > maxDur {
		return maxDur
	}
	return d
}

func flagValue(args []string, name, def string) string {
	for i := 0; i < len(args); i++ {
		if args[i] == name && i+1 < len(args) {
			return args[i+1]
		}
	}
	return def
}

func newLogger() *slog.Logger {
	stateDir, err := xdg.StateFile(filepath.Join("obsidian-memory", "mcp.jsonl"))
	if err != nil {
		_ = os.MkdirAll(filepath.Join(os.TempDir(), "obsidian-memory"), 0o755)
		stateDir = filepath.Join(os.TempDir(), "obsidian-memory", "mcp.jsonl")
	}
	_ = os.MkdirAll(filepath.Dir(stateDir), 0o755)
	lj := &lumberjack.Logger{
		Filename:   stateDir,
		MaxSize:    10,
		MaxBackups: 5,
	}
	return slog.New(slog.NewJSONHandler(lj, &slog.HandlerOptions{}))
}

// Runner abstracts running a child process so tests can inject fakes. The
// production implementation sets GIT_TERMINAL_PROMPT=0 so git fails fast instead
// of blocking on a credential prompt in a headless or hidden context.
//
// It deliberately does NOT ask for CREATE_NO_WINDOW. Console visibility is owned
// once, by winconsole.HideOwnConsole in runWatch, and inherited by every child —
// see the note there for why per-child hiding was the cause of the flashing.
