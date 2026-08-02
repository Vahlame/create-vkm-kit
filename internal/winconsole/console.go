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

// NeedsOwnConsole reports whether a process that must give its children a console has to create
// one, i.e. whether it has none of its own right now.
//
// # Why this replaced AllocConsole in the launcher
//
// Measured on Windows 11 during a research run, with a full-screen game in front: every
// `vkm-runhidden.exe` started by an MCP server created its OWN conhost — it does not inherit the
// server's hidden one — and two of ~25 of those consoles APPEARED and took the foreground before
// they could be hidden. AllocConsole + ShowWindow(SW_HIDE) is a race, not a sequence: conhost
// creates and activates the window on its own schedule, so the hide can run before there is
// anything to hide, and the window shows up afterwards anyway. Losing that race is rare enough to
// look intermittent and frequent enough to steal the screen several times a minute.
//
// A console the CHILD is given at creation — CREATE_NEW_CONSOLE with STARTF_USESHOWWINDOW/SW_HIDE,
// which is what exec.Cmd's SysProcAttr.HideWindow sets — is hidden by the kernel before any window
// exists. There is no interval in which it could be seen, so there is no race to lose.
//
// The inherited case still wins: a launcher started from the user's terminal has that terminal's
// console, and the child must inherit it rather than be handed a private hidden one, or its output
// would go somewhere the user cannot see.
func NeedsOwnConsole(getConsole func() uintptr) bool {
	return getConsole() == 0
}

// HideOwnConsoleWith hides a console only if this process allocated it.
//
// Kept for `obsidian-memoryd`, which is console-subsystem and starts long-lived: it runs this once
// per daemon start, where the race described on NeedsOwnConsole costs at most one window per boot.
// The launcher runs once per fetch and must not use it.
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
