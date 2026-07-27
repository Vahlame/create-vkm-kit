//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// CREATE_NO_WINDOW. Not exported by the syscall package, so it is spelled out here the same way
// cmd/obsidian-memoryd does.
const createNoWindow = 0x08000000

// hideChildWindow makes sure node gets no console of its own. This binary is already GUI-subsystem
// so it has none to pass down, and a console-subsystem child started from a process WITHOUT a
// console gets a brand new (visible) one unless this flag says otherwise — which is precisely the
// flash this command exists to remove.
func hideChildWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
