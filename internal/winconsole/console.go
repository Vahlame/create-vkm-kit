// Package winconsole owns the kit's one answer to "may this process hide a console".
//
// It exists as a package rather than a file in one command because BOTH binaries need it and
// they need it to agree: `vkm-runhidden` allocates the hidden console that hook and sidecar
// trees inherit, and `obsidian-memoryd` must do the same for the git children it spawns while
// watching a vault. The daemon previously took the opposite approach (CREATE_NO_WINDOW on each
// child), which ADR-0078 records as the CAUSE of the flashing rather than the cure.
//
// The syscalls exist only on Windows (console_windows.go wires them up; console_other.go makes
// the whole thing a no-op elsewhere), but the DECISION — whose console may be hidden — is
// ordinary logic, kept platform-neutral so it is tested on every GOOS. It is also the part that
// was wrong once already.
package winconsole

//
// The syscalls it drives exist only on Windows (console_windows.go wires them up; console_other.go
// makes the whole thing a no-op elsewhere), but the DECISION — whose console may be hidden — is
// ordinary logic, and it is the part that was wrong.

// HideOwnConsoleWith hides a console only if this process allocated it.
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
func HideOwnConsoleWith(getConsole func() uintptr, alloc func() bool, hide func(uintptr)) {
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
