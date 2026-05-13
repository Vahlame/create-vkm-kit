//go:build !windows

package main

import "os/exec"

// hiddenCmd is a no-op on non-Windows platforms.
func hiddenCmd(cmd *exec.Cmd) *exec.Cmd { return cmd }
