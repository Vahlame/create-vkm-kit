// Command obsidian-memoryd watches a vault and debounces git sync (v2 daemon).
package main

import (
	"bufio"
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
	"time"

	"github.com/adrg/xdg"
	"github.com/fsnotify/fsnotify"
	"github.com/go-git/go-git/v5"
	"github.com/kardianos/service"
	"gopkg.in/natefinch/lumberjack.v2"
)

const usage = `obsidian-memoryd — vault git sync helper

Usage:
  obsidian-memoryd version
  obsidian-memoryd watch [--vault PATH]
  obsidian-memoryd sync once [--vault PATH]
  obsidian-memoryd service <install|uninstall|start|stop|status> [--user]
  obsidian-memoryd inspect --last N
  obsidian-memoryd self-update

Environment:
  BASIC_MEMORY_HOME or OBSIDIAN_MEMORY_VAULT — vault root (git repo)
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
		fmt.Println("obsidian-memoryd 2.0.0-dev")
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
		if err := gitSync(ctx, l, v); err != nil {
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
	case "self-update":
		fmt.Fprintln(os.Stderr, "self-update: not implemented in this build (track GitHub Releases + SHA256SUMS).")
		os.Exit(1)
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

func gitSync(ctx context.Context, l *slog.Logger, dir string) error {
	if _, err := git.PlainOpen(dir); err != nil {
		return fmt.Errorf("not a git repo: %w", err)
	}
	steps := [][]string{
		{"git", "-C", dir, "add", "-A"},
		{"git", "-C", dir, "commit", "-m", "auto: " + time.Now().UTC().Format(time.RFC3339)},
		{"git", "-C", dir, "pull", "--rebase"},
		{"git", "-C", dir, "push"},
	}
	for _, s := range steps {
		cmd := exec.CommandContext(ctx, s[0], s[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			if len(s) > 2 && s[2] == "commit" {
				var ee *exec.ExitError
				if errors.As(err, &ee) && ee.ExitCode() == 1 {
					l.Info("git commit noop", "args", s)
					continue
				}
			}
			return fmt.Errorf("%v: %w", s, err)
		}
		l.Info("git step ok", "args", s)
	}
	return nil
}

func runWatch(ctx context.Context, l *slog.Logger, root string) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer w.Close()

	if err := addRecursive(w, root); err != nil {
		return err
	}
	var debounce *time.Timer
	dur := 2 * time.Second
	for {
		select {
		case ev, ok := <-w.Events:
			if !ok {
				return nil
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
				continue
			}
			if strings.Contains(filepath.Base(ev.Name), ".sync-conflict-") {
				l.Warn("syncthing conflict file detected", "file", ev.Name)
			}
			if debounce != nil {
				debounce.Stop()
			}
			debounce = time.AfterFunc(dur, func() {
				if err := gitSync(ctx, l, root); err != nil {
					l.Error("debounced sync", "err", err)
				}
			})
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
	log *slog.Logger
}

func (d *daemonSvc) Start(s service.Service) error {
	go func() {
		v := defaultVault()
		_ = runWatch(context.Background(), d.log, vaultPath(v))
	}()
	return nil
}

func (d *daemonSvc) Stop(s service.Service) error {
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
		home = "%h/Documents/cursor-memory-vault"
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
