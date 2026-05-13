//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// hiddenCmd wraps cmd so the child process gets CREATE_NO_WINDOW, preventing
// a console flash even when the parent binary is a GUI-subsystem executable.
func hiddenCmd(cmd *exec.Cmd) *exec.Cmd {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags = createNoWindow
	return cmd
}
