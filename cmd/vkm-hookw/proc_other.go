//go:build !windows

package main

import "os/exec"

// No consoles to suppress off Windows; the hook runs exactly as before.
func hideChildWindow(_ *exec.Cmd) {}
