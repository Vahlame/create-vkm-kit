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

// stillActive is the well-known Win32 STILL_ACTIVE sentinel (259, the same
// value as WAIT_TIMEOUT) returned by GetExitCodeProcess for a process that
// has not yet exited. Not exposed as a named constant by the stdlib syscall
// package, hence the literal.
const stillActive = 259

// pidAliveImpl reports whether pid is a live process on this host, used to
// detect a stale cross-process git-sync lock left behind by a crashed
// daemon.
func pidAliveImpl(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := syscall.OpenProcess(syscall.PROCESS_QUERY_INFORMATION, false, uint32(pid))
	if err != nil {
		// ERROR_ACCESS_DENIED still means the process exists (e.g. owned by
		// another user); any other error (e.g. "invalid parameter") means no
		// such process.
		return err == syscall.ERROR_ACCESS_DENIED
	}
	defer syscall.CloseHandle(h)
	var code uint32
	if err := syscall.GetExitCodeProcess(h, &code); err != nil {
		return false
	}
	return code == stillActive
}
