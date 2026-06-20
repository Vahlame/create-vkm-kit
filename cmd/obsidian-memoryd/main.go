// Command obsidian-memoryd watches a vault and debounces git sync (v2 daemon).
package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/adrg/xdg"
	"github.com/fsnotify/fsnotify"
	"github.com/go-git/go-git/v5"
	"github.com/kardianos/service"
	"gopkg.in/natefinch/lumberjack.v2"
)

// version is the daemon version. Override at build time with:
//
//	go build -ldflags="-X main.version=3.9.0" ./cmd/obsidian-memoryd
//
// Keep in sync with agent.toml.
var version = "3.9.0"

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
// production implementation wraps exec.CommandContext with hiddenCmd (no
// console window on Windows) and sets GIT_TERMINAL_PROMPT=0 so git fails fast
// instead of blocking on credential prompts in headless / hidden contexts.
type Runner interface {
	Run(ctx context.Context, name string, args ...string) error
	Output(ctx context.Context, name string, args ...string) ([]byte, error)
}

type execRunner struct{}

func (execRunner) Run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0")
	hiddenCmd(cmd)
	return cmd.Run()
}

func (execRunner) Output(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0")
	hiddenCmd(cmd)
	return cmd.CombinedOutput()
}

var defaultRunner Runner = execRunner{}

// exitCoder is satisfied by *exec.ExitError and by test fakes; lets us tell an
// "empty commit" (exit 1) apart from a transport failure.
type exitCoder interface{ ExitCode() int }

const (
	stepTimeout    = 30 * time.Second
	pushTimeout    = 60 * time.Second
	pushMaxRetries = 3
)

var (
	syncMu sync.Mutex
	// ErrSyncBusy is returned by gitSync when another sync is already running.
	// Callers should ignore it (the in-flight sync will pick up the latest state).
	ErrSyncBusy = errors.New("git sync already in progress; skipped")
)

// gitSync runs add → commit → pull --rebase → push against dir, with per-step
// timeouts, rebase-conflict abort, and exponential retry on push. Only one
// sync runs at a time per process; concurrent callers get ErrSyncBusy.
func gitSync(parent context.Context, l *slog.Logger, dir string) error {
	return gitSyncWith(parent, l, dir, defaultRunner)
}

func gitSyncWith(parent context.Context, l *slog.Logger, dir string, r Runner) error {
	if !syncMu.TryLock() {
		l.Info("git sync skipped: another sync in progress")
		return ErrSyncBusy
	}
	defer syncMu.Unlock()

	if _, err := git.PlainOpen(dir); err != nil {
		return fmt.Errorf("not a git repo: %w", err)
	}

	if err := runStep(parent, r, stepTimeout, l, "add", "git", "-C", dir, "add", "-A"); err != nil {
		return err
	}
	if err := commitStep(parent, r, stepTimeout, l, dir); err != nil {
		return err
	}
	if err := pullRebaseStep(parent, r, stepTimeout, l, dir); err != nil {
		return err
	}
	return pushStep(parent, r, pushTimeout, l, dir)
}

func runStep(parent context.Context, r Runner, to time.Duration, l *slog.Logger, label, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(parent, to)
	defer cancel()
	if err := r.Run(ctx, name, args...); err != nil {
		return fmt.Errorf("git %s: %w", label, err)
	}
	l.Info("git step ok", "step", label)
	return nil
}

func commitStep(parent context.Context, r Runner, to time.Duration, l *slog.Logger, dir string) error {
	ctx, cancel := context.WithTimeout(parent, to)
	defer cancel()
	msg := "auto: " + time.Now().UTC().Format(time.RFC3339)
	err := r.Run(ctx, "git", "-C", dir, "commit", "-m", msg)
	if err == nil {
		l.Info("git step ok", "step", "commit")
		return nil
	}
	var ce exitCoder
	if errors.As(err, &ce) && ce.ExitCode() == 1 {
		l.Info("git commit noop (nothing to commit)")
		return nil
	}
	return fmt.Errorf("git commit: %w", err)
}

func pullRebaseStep(parent context.Context, r Runner, to time.Duration, l *slog.Logger, dir string) error {
	ctx, cancel := context.WithTimeout(parent, to)
	defer cancel()
	out, err := r.Output(ctx, "git", "-C", dir, "pull", "--rebase")
	if err == nil {
		l.Info("git step ok", "step", "pull --rebase")
		return nil
	}
	if bytes.Contains(out, []byte("CONFLICT")) || bytes.Contains(out, []byte("needs merge")) {
		abortCtx, abortCancel := context.WithTimeout(parent, 10*time.Second)
		defer abortCancel()
		if abortErr := r.Run(abortCtx, "git", "-C", dir, "rebase", "--abort"); abortErr != nil {
			l.Error("rebase abort failed", "err", abortErr)
		} else {
			l.Warn("rebase aborted due to conflicts; resolve manually then re-sync", "dir", dir)
		}
		recordRebaseAbort()
		return fmt.Errorf("git pull --rebase: conflict, aborted")
	}
	return fmt.Errorf("git pull --rebase: %w; output=%s", err, truncate(out, 400))
}

func pushStep(parent context.Context, r Runner, to time.Duration, l *slog.Logger, dir string) error {
	var lastErr error
	backoff := 500 * time.Millisecond
	for attempt := 1; attempt <= pushMaxRetries; attempt++ {
		ctx, cancel := context.WithTimeout(parent, to)
		err := r.Run(ctx, "git", "-C", dir, "push")
		cancel()
		if err == nil {
			l.Info("git step ok", "step", "push", "attempt", attempt)
			recordPushSuccess()
			return nil
		}
		lastErr = err
		l.Warn("git push failed; will retry", "attempt", attempt, "err", err)
		if attempt < pushMaxRetries {
			select {
			case <-time.After(backoff):
			case <-parent.Done():
				return parent.Err()
			}
			backoff *= 2
		}
	}
	recordPushFailure()
	return fmt.Errorf("git push (%d attempts): %w", pushMaxRetries, lastErr)
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}

// doctor prints a human-readable health report (heartbeat age, last successful
// push, unpushed commit count, recent rebase aborts, consecutive push fails)
// and returns ErrDoctorAlarm if any signal looks bad. Useful when the daemon
// runs hidden (Windows -H windowsgui) and the user wants to know "is it alive
// and is it pushing?" without grepping JSONL logs.
func doctor(out io.Writer, vault string, now time.Time) error {
	s := readState()
	const heartbeatStale = 5 * time.Minute

	fmt.Fprintln(out, "obsidian-memoryd doctor")
	fmt.Fprintln(out, "  state file:               "+stateFilePath())
	if s.Heartbeat.IsZero() {
		fmt.Fprintln(out, "  heartbeat:                never (daemon has not run with this state file)")
	} else {
		marker := ""
		if staleHeartbeat(s, now, heartbeatStale) {
			marker = " ⚠ daemon may be stopped"
		}
		fmt.Fprintf(out, "  heartbeat:                %s%s\n", formatAgo(now, s.Heartbeat), marker)
	}
	fmt.Fprintf(out, "  last successful push:     %s\n", formatAgo(now, s.LastPush))
	if !s.LastRebaseAbort.IsZero() {
		fmt.Fprintf(out, "  last rebase abort:        %s ⚠\n", formatAgo(now, s.LastRebaseAbort))
	}
	if s.ConsecutivePushFailures > 0 {
		marker := ""
		if s.ConsecutivePushFailures >= 3 {
			marker = " ⚠ repeated failure"
		}
		fmt.Fprintf(out, "  consecutive push fails:   %d%s\n", s.ConsecutivePushFailures, marker)
	}

	// Unpushed commit count is best-effort: requires a configured upstream.
	// Failure to compute is silent (no upstream, missing git, etc.).
	if vault != "" {
		if fi, err := os.Stat(filepath.Join(vault, ".git")); err == nil && fi.IsDir() {
			cmd := exec.Command("git", "-C", vault, "rev-list", "@{u}..HEAD", "--count")
			cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0")
			hiddenCmd(cmd)
			if outBytes, err := cmd.Output(); err == nil {
				fmt.Fprintf(out, "  unpushed commits (vault): %s", string(outBytes))
			}
		}
	}

	alarm := staleHeartbeat(s, now, heartbeatStale) || s.ConsecutivePushFailures >= 3
	if alarm {
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "ALARM: one or more signals are unhealthy. See `obsidian-memoryd inspect --last 30` for details.")
		return ErrDoctorAlarm
	}
	return nil
}

func runWatch(ctx context.Context, l *slog.Logger, root string) error {
	return runWatchWith(ctx, l, root, watchDebounce(), func(c context.Context) {
		if err := gitSync(c, l, root); err != nil && !errors.Is(err, ErrSyncBusy) {
			l.Error("debounced sync", "err", err)
		}
	})
}

// runWatchWith is the testable core of runWatch: it watches `root` recursively
// and, after `dur` of quiet following the last filesystem event, invokes
// `onSync`. The sync callback is injected so tests can exercise the debounce and
// the new-directory watching without shelling out to real git (production passes
// a closure over gitSync).
func runWatchWith(ctx context.Context, l *slog.Logger, root string, dur time.Duration, onSync func(context.Context)) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer w.Close()

	// Heartbeat tick gives `obsidian-memoryd doctor` a way to detect
	// "daemon silently died" (especially under -H windowsgui where there
	// is no console to flash an error).
	stopBeat := startHeartbeat(60 * time.Second)
	defer stopBeat()

	if err := addRecursive(w, root); err != nil {
		return err
	}
	var debounce *time.Timer
	// Stop any pending debounce when the loop exits (ctx cancel / channel close)
	// so a late timer cannot fire onSync against a cancelled context after we
	// have already returned.
	defer func() {
		if debounce != nil {
			debounce.Stop()
		}
	}()
	for {
		select {
		case ev, ok := <-w.Events:
			if !ok {
				return nil
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
				continue
			}
			// fsnotify is non-recursive: a directory created (or moved in) after
			// startup carries no watch, so edits inside it would be missed until
			// some other event triggered a sync. Add it (recursively) as soon as
			// it appears. Add on an already-watched path is a no-op; a vanished
			// Rename target fails Stat and is skipped.
			if ev.Op&(fsnotify.Create|fsnotify.Rename) != 0 {
				if fi, statErr := os.Stat(ev.Name); statErr == nil && fi.IsDir() && !skipDir(ev.Name) {
					if addErr := addRecursive(w, ev.Name); addErr != nil {
						l.Warn("watch new directory failed", "dir", ev.Name, "err", addErr)
					}
				}
			}
			if strings.Contains(filepath.Base(ev.Name), ".sync-conflict-") {
				l.Warn("syncthing conflict file detected", "file", ev.Name)
			}
			if debounce != nil {
				debounce.Stop()
			}
			debounce = time.AfterFunc(dur, func() { onSync(ctx) })
		case err, ok := <-w.Errors:
			if !ok {
				return nil
			}
			l.Error("fsnotify", "err", err)
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func addRecursive(w *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			return nil
		}
		if skipDir(path) {
			return filepath.SkipDir
		}
		return w.Add(path)
	})
}

func skipDir(path string) bool {
	base := filepath.Base(path)
	switch base {
	case ".git", "node_modules", ".obsidian":
		return true
	default:
		return false
	}
}

type daemonSvc struct {
	log    *slog.Logger
	cancel context.CancelFunc
	// watch is the long-running watch loop, injectable so tests can verify the
	// Start/Stop lifecycle without spawning a real fsnotify watcher on the
	// default vault. nil → the production runWatch over the default vault.
	watch func(ctx context.Context)
}

func (d *daemonSvc) Start(s service.Service) error {
	ctx, cancel := context.WithCancel(context.Background())
	d.cancel = cancel
	run := d.watch
	if run == nil {
		run = func(c context.Context) {
			_ = runWatch(c, d.log, vaultPath(defaultVault()))
		}
	}
	go run(ctx)
	return nil
}

// Stop cancels the watch context so the goroutine (and its fsnotify watcher +
// heartbeat ticker) shuts down cleanly. Previously a no-op, which leaked a
// goroutine and watcher on every service stop/restart.
func (d *daemonSvc) Stop(s service.Service) error {
	if d.cancel != nil {
		d.cancel()
	}
	return nil
}

func runService(action string, args []string, l *slog.Logger) error {
	user := false
	for _, a := range args {
		if a == "--user" {
			user = true
		}
	}
	cfg := &service.Config{
		Name:        "obsidian-memoryd",
		DisplayName: "Obsidian memory daemon",
		Description: "Debounced git sync for Markdown memory vault",
		Option:      service.KeyValue{"UserService": user},
	}
	prg := &daemonSvc{log: l}
	s, err := service.New(prg, cfg)
	if err != nil {
		return err
	}
	switch action {
	case "install":
		if runtime.GOOS == "linux" && user {
			return installSystemdUser(l)
		}
		return s.Install()
	case "uninstall":
		if runtime.GOOS == "linux" && user {
			return uninstallSystemdUser(l)
		}
		return s.Uninstall()
	case "start":
		if runtime.GOOS == "linux" && user {
			return systemctlUser("start", l)
		}
		return s.Start()
	case "stop":
		if runtime.GOOS == "linux" && user {
			return systemctlUser("stop", l)
		}
		return s.Stop()
	case "status":
		if runtime.GOOS == "linux" && user {
			return systemctlUser("status", l)
		}
		st, err := s.Status()
		if err != nil {
			return err
		}
		fmt.Println(st)
		return nil
	default:
		return errors.New("unknown service action")
	}
}

func installSystemdUser(l *slog.Logger) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	unitDir, err := xdg.ConfigFile(filepath.Join("systemd", "user"))
	if err != nil {
		return err
	}
	_ = os.MkdirAll(unitDir, 0o755)
	unit := filepath.Join(unitDir, "obsidian-memoryd.service")
	home := os.Getenv("BASIC_MEMORY_HOME")
	if home == "" {
		home = "%h/Documents/obsidian-memory-vault"
	}
	content := fmt.Sprintf(`[Unit]
Description=Obsidian memory daemon (user)
After=network-online.target

[Service]
Type=simple
ExecStart=%s watch
Restart=on-failure
Environment="BASIC_MEMORY_HOME=%s"

[Install]
WantedBy=default.target
`, exe, home)
	if err := os.WriteFile(unit, []byte(content), 0o644); err != nil {
		return err
	}
	l.Info("wrote systemd user unit", "path", unit)
	if err := systemctlCmd("daemon-reload").Run(); err != nil {
		return err
	}
	c := exec.Command("systemctl", "--user", "enable", "--now", "obsidian-memoryd.service")
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	return c.Run()
}

func uninstallSystemdUser(l *slog.Logger) error {
	unit, err := xdg.ConfigFile(filepath.Join("systemd", "user", "obsidian-memoryd.service"))
	if err != nil {
		return err
	}
	_ = os.Remove(unit)
	l.Info("removed systemd user unit", "path", unit)
	return systemctlCmd("daemon-reload").Run()
}

func systemctlUser(action string, l *slog.Logger) error {
	cmd := exec.Command("systemctl", "--user", action, "obsidian-memoryd.service")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		l.Info("systemctl", "action", action, "err", err)
	}
	return err
}

func systemctlCmd(args ...string) *exec.Cmd {
	c := append([]string{"systemctl", "--user"}, args...)
	return exec.Command(c[0], c[1:]...)
}

func inspectLogs(l *slog.Logger, n int) error {
	stateDir, err := xdg.StateFile(filepath.Join("obsidian-memory", "mcp.jsonl"))
	if err != nil {
		return err
	}
	f, err := os.Open(stateDir)
	if err != nil {
		return err
	}
	defer f.Close()
	lines, err := tailLines(f, n)
	if err != nil {
		return err
	}
	for _, ln := range lines {
		fmt.Println(ln)
	}
	return nil
}

func tailLines(r io.Reader, n int) ([]string, error) {
	var ring []string
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		ring = append(ring, sc.Text())
		if len(ring) > n {
			ring = ring[len(ring)-n:]
		}
	}
	return ring, sc.Err()
}
