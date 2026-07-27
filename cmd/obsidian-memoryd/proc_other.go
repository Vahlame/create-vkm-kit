//go:build !windows

package main

import "syscall"

// pidAliveImpl reports whether pid is a live process on this host, used to
// detect a stale cross-process git-sync lock left behind by a crashed
// daemon. Signal 0 performs no action but still fails with ESRCH if the
// process is gone; EPERM means it exists but is owned by another user (still
// alive).
func pidAliveImpl(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, syscall.Signal(0))
	if err == nil {
		return true
	}
	return err == syscall.EPERM
}
