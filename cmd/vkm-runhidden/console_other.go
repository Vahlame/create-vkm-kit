//go:build !windows

package main

import "os/exec"

// hideChildConsole is a no-op off Windows: there are no consoles to create or hide.
func hideChildConsole(*exec.Cmd) {}
