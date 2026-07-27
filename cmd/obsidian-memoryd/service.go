package main

// Installing and controlling the daemon as a user service — kardianos/service on
// Windows/macOS, systemd --user on Linux.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/adrg/xdg"
	"github.com/kardianos/service"
)

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

// Stop cancels the watch context so the goroutine (and its fsnotify watcher +
// heartbeat ticker) shuts down cleanly. Previously a no-op, which leaked a
// goroutine and watcher on every service stop/restart.
func (d *daemonSvc) Stop(s service.Service) error {
	if d.cancel != nil {
		d.cancel()
	}
	return nil
}

// systemdUserAction runs a `service` subcommand through systemd --user.
//
// Linux user services are installed as a unit file we write ourselves rather than through
// the service library, so install/uninstall have their own implementations and everything
// else is a `systemctl --user` passthrough.
func systemdUserAction(action string, l *slog.Logger) error {
	switch action {
	case "install":
		return installSystemdUser(l)
	case "uninstall":
		return uninstallSystemdUser(l)
	default:
		return systemctlUser(action, l)
	}
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
	// systemd --user is handled by us, not by the service library, on every action.
	// Hoisted out of the switch: the same three-line predicate appeared before each of
	// the five cases, so adding a sixth meant remembering to repeat it.
	if runtime.GOOS == "linux" && user {
		return systemdUserAction(action, l)
	}

	prg := &daemonSvc{log: l}
	s, err := service.New(prg, cfg)
	if err != nil {
		return err
	}
	switch action {
	case "install":
		return s.Install()
	case "uninstall":
		return s.Uninstall()
	case "start":
		return s.Start()
	case "stop":
		return s.Stop()
	case "status":
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

// logFileOverride lets tests redirect the JSONL log file inspectLogs() reads.
// Mirrors stateDirOverride in state.go and for the same reason: xdg.StateFile
// reads XDG_STATE_HOME at package init, so flipping the env var mid-test
// doesn't take effect.
