// Command vkm-runhidden starts a program so that neither it nor anything it spawns can put a
// console window on screen.
//
// # The bug this fixes
//
// Measured live during a deep-research run: the only processes creating consoles were
// `conhost.exe` whose parent was `ollama.exe` — one per model load, each a real window that
// appears, TAKES THE FOREGROUND, and disappears milliseconds later. To someone playing a
// full-screen game while the agent works in the background, that is the screen being taken away
// from them, repeatedly.
//
// The cause is counter-intuitive: the obvious protection is what CAUSES it. Starting a process with
// CREATE_NO_WINDOW (Node's `windowsHide: true`) gives it no console at all. It then spawns its own
// console-subsystem child — ollama's model runner, a hook's helper, Python's workers — and a
// console-subsystem process whose parent has NO console does not inherit one: Windows allocates it
// a brand new, visible console. The flag meant to hide a window forces one to appear a level down.
//
// The flag cannot be pushed down, because we do not control how those programs spawn their own
// children. So this fixes it from the other end:
//
//  1. Built GUI-subsystem (-H windowsgui), so the loader never allocates a console for it.
//  2. It allocates one deliberately and hides the window. A hidden console is still a real console.
//  3. It starts the target WITHOUT CREATE_NO_WINDOW, so the child inherits that hidden console —
//     and so does the child's child, all the way down. Nothing allocates a new one, so nothing
//     appears.
//
// # One binary, one strategy
//
// An earlier version of this fix shipped a second binary (`vkm-hookw`) that used CREATE_NO_WINDOW
// on the child — i.e. the strategy this one exists to replace. It was not merely redundant, it was
// wrong in the same way: `ensure-otel-sink` is a hook that spawns another node process, which is
// exactly the case that allocates a visible console. Two binaries with contradictory strategies is
// how a fix rots, so there is now one.
//
// # It must be transparent
//
// Hooks are not fire-and-forget. They read a JSON event on stdin, may answer on stdout, and their
// EXIT CODE is the verdict — a non-zero PreToolUse hook is how the memory-write and effort guards
// block a call. All three are proxied verbatim. A launcher that swallowed the exit code would
// silently disarm every guard, which is far worse than a flashing window.
//
// Usage:
//
//	vkm-runhidden.exe <program|script.mjs> [args...]
//
// A first argument ending in .mjs/.js/.cjs is run with node (VKM_HOOK_NODE, else node on PATH), so
// hook entries can name the script directly.
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/Vahlame/create-vkm-kit/internal/winconsole"
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

	// Must happen BEFORE the child starts: the hidden console has to exist by the time anything can
	// inherit it. A failure here is not fatal — a visible console beats not running at all.
	winconsole.HideOwnConsole()

	name, argv := resolve(args)

	cmd := exec.Command(name, argv...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Deliberately NOT setting CREATE_NO_WINDOW. That flag is the whole problem: it denies the child
	// a console, which forces the child's OWN children to allocate visible ones. Inheriting the
	// hidden console above is the entire point.

	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			// A hook that deliberately blocks a tool call exits non-zero. Forward it unchanged.
			return exitErr.ExitCode()
		}

		fmt.Fprintf(os.Stderr, "vkm-runhidden: could not run %s: %v\n", name, err)
		return 2
	}

	return 0
}

// resolve decides what actually gets executed.
//
// A JavaScript file cannot be executed directly, so naming one means "run this with node". Keeping
// that here lets a hook entry point at its script without every config repeating the interpreter,
// and without this binary guessing about anything else.
func resolve(args []string) (string, []string) {
	first := args[0]

	switch strings.ToLower(filepath.Ext(first)) {
	case ".mjs", ".js", ".cjs":
		script := first
		if abs, err := filepath.Abs(script); err == nil {
			script = abs
		}
		return nodeExecutable(), append([]string{script}, args[1:]...)
	default:
		return first, args[1:]
	}
}

// nodeExecutable resolves the interpreter. VKM_HOOK_NODE wins when set, so an installation using a
// pinned or portable Node does not depend on PATH — a hook that cannot find its interpreter fails
// silently, and a silently-dead guard hook is indistinguishable from a passing one.
func nodeExecutable() string {
	if custom := os.Getenv("VKM_HOOK_NODE"); custom != "" {
		return custom
	}
	if resolved, err := exec.LookPath("node"); err == nil {
		return resolved
	}
	return "node"
}
