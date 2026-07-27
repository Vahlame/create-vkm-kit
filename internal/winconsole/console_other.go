//go:build !windows

package winconsole

// No consoles to hide off Windows.
func HideOwnConsole() {}
