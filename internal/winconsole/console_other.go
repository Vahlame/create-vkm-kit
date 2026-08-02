//go:build !windows

package winconsole

// No consoles to hide off Windows.
func HideOwnConsole() {}

// ChildNeedsHiddenConsole is always false off Windows: there is no console to create in the first
// place, and no window a child could put on screen by being given one.
func ChildNeedsHiddenConsole() bool { return false }
