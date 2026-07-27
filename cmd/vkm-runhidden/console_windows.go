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

// hideOwnConsole gives this process a console and hides its window.
//
// A GUI-subsystem process starts with none, so AllocConsole creates one — and a console that EXISTS
// is a console children inherit, which is precisely what stops them allocating visible ones of
// their own. Hiding it means the one we created is never seen, so the net effect on screen is
// nothing while every descendant still has somewhere to write.
func hideOwnConsole() {
	// Started from a terminal? Then a console already exists and allocating a second one fails;
	// just hide whatever we have.
	if hwnd, _, _ := procGetConsoleWindow.Call(); hwnd == 0 {
		procAllocConsole.Call()
	}

	if hwnd, _, _ := procGetConsoleWindow.Call(); hwnd != 0 {
		procShowWindow.Call(hwnd, uintptr(swHide))
	}
}
