//go:build !windows

package main

// No consoles to hide off Windows.
func hideOwnConsole() {}
