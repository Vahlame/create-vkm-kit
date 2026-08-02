//go:build windows

package main

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// hideChildConsole makes Windows create the child's console ALREADY HIDDEN.
//
// CREATE_NEW_CONSOLE gives the child a console of its own; HideWindow is what Go calls
// STARTF_USESHOWWINDOW with SW_HIDE, the show state that console window is born with. Both are
// applied by the kernel while the process is being created, so unlike AllocConsole followed by
// ShowWindow there is no interval during which the window exists and is visible — which is exactly
// the interval that was stealing the foreground from a full-screen game once per few fetches.
//
// The child's std handles are untouched: cmd.Stdin/Stdout/Stderr are the launcher's own (pipes,
// when the agent host started it), so the new console is a place for descendants to inherit, never
// where this process's output goes.
func hideChildConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_CONSOLE,
	}
}
