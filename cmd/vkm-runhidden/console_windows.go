//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

const swHide = 0

var (
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	user32               = syscall.NewLazyDLL("user32.dll")
	procAllocConsole     = kernel32.NewProc("AllocConsole")
	procGetConsoleWindow = kernel32.NewProc("GetConsoleWindow")
	procShowWindow       = user32.NewProc("ShowWindow")
)

// hideOwnConsole gives this process a console and immediately hides its window.
//
// A GUI-subsystem process starts with none, so AllocConsole creates one — and a console that
// EXISTS is a console children inherit, which is exactly what stops them allocating visible ones of
// their own. Hiding it makes the one we created invisible, so the net effect on screen is nothing
// at all while every descendant still has somewhere to write.
func hideOwnConsole() {
	// Already have one (started from a terminal)? Then there is nothing to allocate; just hide it.
	if hwnd, _, _ := procGetConsoleWindow.Call(); hwnd == 0 {
		procAllocConsole.Call()
	}

	hwnd, _, _ := procGetConsoleWindow.Call()
	if hwnd != 0 {
		procShowWindow.Call(hwnd, uintptr(swHide))
	}
	_ = unsafe.Pointer(nil)
}
