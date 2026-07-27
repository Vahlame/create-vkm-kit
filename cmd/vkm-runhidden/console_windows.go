//go:build windows

package main

import "syscall"

const swHide = 0

var (
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	user32               = syscall.NewLazyDLL("user32.dll")
	procAllocConsole     = kernel32.NewProc("AllocConsole")
	procGetConsoleWindow = kernel32.NewProc("GetConsoleWindow")
	procShowWindow       = user32.NewProc("ShowWindow")
)

// hideOwnConsole gives this process a console of its OWN and hides its window.
//
// A GUI-subsystem process starts with none, so AllocConsole creates one — and a console that EXISTS
// is a console children inherit, which is precisely what stops them allocating visible ones of
// their own. Hiding it means the one we created is never seen, so the net effect on screen is
// nothing while every descendant still has somewhere to write.
//
// It hides only what it allocated; hideOwnConsoleWith documents why an inherited console is left
// alone. The AllocConsole return value is checked rather than assumed — the previous version hid
// whatever GetConsoleWindow reported afterwards, which on a terminal launch was the user's window.
func hideOwnConsole() {
	hideOwnConsoleWith(getConsoleWindow, allocConsole, hideWindow)
}

func getConsoleWindow() uintptr {
	hwnd, _, _ := procGetConsoleWindow.Call()
	return hwnd
}

// allocConsole reports whether a console was created. AllocConsole returns 0 on failure, the
// commonest cause being that the process already has one.
func allocConsole() bool {
	ret, _, _ := procAllocConsole.Call()
	return ret != 0
}

func hideWindow(hwnd uintptr) {
	procShowWindow.Call(hwnd, uintptr(swHide))
}
