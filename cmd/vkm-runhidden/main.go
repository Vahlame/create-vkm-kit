// Command vkm-runhidden starts a program so that neither it nor anything it spawns can put a
// console window on screen.
//
// # The bug this fixes
//
// Measured live during a deep-research run: the only processes creating consoles were
// `conhost.exe` whose parent was `ollama.exe`. Not obscura, not the hooks — ollama.
//
// The cause is counter-intuitive, and it is that the obvious protection CAUSES the problem.
// `ensureOllamaServer` starts ollama with Node's `windowsHide: true`, which is CREATE_NO_WINDOW,
// which means the process gets NO console at all. Ollama then spawns its model-runner child, and
// that child is a CONSOLE-subsystem binary. A console-subsystem process whose parent has no console
// does not inherit one — Windows allocates it a brand new console, and a brand new console is a real
// window that appears, TAKES THE FOREGROUND, and disappears milliseconds later. Every model load
// during curation produces one. To someone playing a full-screen game while the agent researches in
// the background, that is the screen tearing them out, repeatedly.
//
// The flag cannot be passed down: we do not control how ollama spawns its runner. So the fix is the
// other direction — give the parent a console that its children can INHERIT, and make sure that
// console is never visible.
//
// # How
//
//  1. This binary is GUI-subsystem (-H windowsgui), so the loader never allocates a console for it.
//  2. It then allocates one deliberately (AllocConsole) and immediately hides the window
//     (ShowWindow SW_HIDE). A hidden console is still a real console handle.
//  3. It starts the target WITHOUT CREATE_NO_WINDOW, so the child inherits that hidden console —
//     and so does the child's child, and so on down the tree. Nothing allocates a new one, so
//     nothing appears.
//
// The result is a whole process tree that can print as much as it likes and never draw a pixel.
//
// Usage:
//
//	vkm-runhidden.exe <program> [args...]
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
)

func main() {
	os.Exit(run())
}

func run() int {
	args := os.Args[1:]
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "vkm-runhidden: no program given")
		return 2
	}

	// Must happen before the child is started: the console has to exist, and be hidden, by the time
	// anything can inherit it. Failure is not fatal — a visible console is worse than no launcher,
	// but it is far better than not running the program at all.
	hideOwnConsole()

	cmd := exec.Command(args[0], args[1:]...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Deliberately NOT setting CREATE_NO_WINDOW here. That flag is what starts the whole problem:
	// it denies the child a console, which forces the child's own children to allocate visible ones.
	// Inheriting the hidden console above is the entire point of this program.

	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return exitErr.ExitCode()
		}

		fmt.Fprintf(os.Stderr, "vkm-runhidden: could not run %s: %v\n", args[0], err)
		return 2
	}

	return 0
}
