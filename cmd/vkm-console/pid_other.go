//go:build !windows

package main

import "syscall"

// pidAlive reports whether pid is a live process on this host. Signal 0
// performs no action but still fails with ESRCH if the process is gone; EPERM
// means it exists but is owned by another user (still alive). Mirrors
// cmd/obsidian-memoryd/proc_other.go and the pg contract's
// `process.kill(pid, 0) throws == stale` rule.
func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, syscall.Signal(0))
	if err == nil {
		return true
	}
	return err == syscall.EPERM
}
