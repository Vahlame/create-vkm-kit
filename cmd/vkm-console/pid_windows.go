//go:build windows

package main

import "syscall"

// stillActive is the well-known Win32 STILL_ACTIVE sentinel (259) returned by
// GetExitCodeProcess for a process that has not yet exited. Same rationale as
// cmd/obsidian-memoryd/proc_windows.go, which this mirrors.
const stillActive = 259

// pidAlive reports whether pid is a live process on this host. Used to decide
// whether a pg service.json / service.lock entry is live or stale (the pg
// contract's `process.kill(pid, 0) throws` rule, translated to Windows).
func pidAlive(pid int) bool {
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
