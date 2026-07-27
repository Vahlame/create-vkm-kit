package main

// Console policy, kept platform-neutral so it is tested on every GOOS.
//
// The syscalls it drives exist only on Windows (console_windows.go wires them up; console_other.go
// makes the whole thing a no-op elsewhere), but the DECISION — whose console may be hidden — is
// ordinary logic, and it is the part that was wrong.

// hideOwnConsoleWith hides a console only if this process allocated it.
//
// The distinction is the whole rule. A GUI-subsystem process started by the agent host has NO
// console: GetConsoleWindow returns 0, AllocConsole creates one nobody else can see, and hiding it
// is invisible and correct. But started from a terminal — `vkm-runhidden.exe node hook.mjs` typed
// into PowerShell, or any `npm run` wrapper — the process INHERITS that terminal's console, and
// GetConsoleWindow returns the user's own window.
//
// Hiding that window is not a cosmetic mistake. ShowWindow(SW_HIDE) is permanent: nothing in this
// program ever shows it again, and when the launcher exits the terminal is still running, still
// holding the user's session, with no window. The only recovery is Task Manager. So an inherited
// console is left exactly as found, and the caller accepts the flash it was trying to avoid —
// a visible console beats a vanished terminal.
//
// alloc reports whether a console was actually created; when it fails there is nothing to hide and
// nothing to do (AllocConsole fails precisely when a console already exists, which the check above
// has already excluded, so this is belt-and-braces rather than an expected path).
func hideOwnConsoleWith(getConsole func() uintptr, alloc func() bool, hide func(uintptr)) {
	if getConsole() != 0 {
		return // inherited: someone else's window, not ours to touch
	}
	if !alloc() {
		return
	}
	if hwnd := getConsole(); hwnd != 0 {
		hide(hwnd)
	}
}
