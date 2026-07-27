// Command vkm-hookw runs a vkm hook without ever putting a window on screen.
//
// # Why this exists
//
// Claude Code hooks are `command` entries, and every vkm hook is a Node script — so every matching
// tool call spawns a fresh `node.exe`. Two of them are on the hottest paths there are:
// compact-tool-output on every Bash call and compact-mcp-output on every MCP call. A single
// research run makes hundreds.
//
// node.exe is a CONSOLE-subsystem binary. When Windows starts one and the spawn did not ask for
// CREATE_NO_WINDOW, the loader allocates a console for it — a real window, which appears, takes the
// foreground, and vanishes a few milliseconds later. Hundreds of those is the reported symptom:
// shells flashing open and shut, pulling the user out of a full-screen game while the agent works
// in the background.
//
// The kit cannot fix that from Node, because it is not the kit that spawns the hook — the agent
// host does, with flags the kit does not control. What the kit CAN control is what gets spawned. So
// this is a GUI-subsystem executable (built with -H windowsgui): the loader never allocates a
// console for it, whatever flags it was started with. It then starts node itself with
// CREATE_NO_WINDOW, so the grandchild has none either.
//
// # It must be transparent
//
// Hooks are not fire-and-forget. They read a JSON event on stdin, may write JSON on stdout, and
// their EXIT CODE is meaningful — a PreToolUse hook returning non-zero blocks the tool call, which
// is exactly how guard-native-memory-write and guard-effort-gate do their job. So this proxies all
// three streams verbatim and returns the child's exit code unchanged. Anything less would silently
// disarm the guards, which is a much worse outcome than a flashing window.
//
// Usage (as the `command` in settings.json, with the script and its arguments as `args`):
//
//	"command": "C:\\...\\vkm-hookw.exe",
//	"args": ["C:\\...\\hooks\\compact-mcp-output.mjs", "es"]
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// nodeExecutable resolves the interpreter. VKM_HOOK_NODE wins when set, so an installation using a
// pinned or portable Node does not have to depend on PATH — a hook that cannot find its interpreter
// fails silently, and a silently-dead guard hook is indistinguishable from a passing one.
func nodeExecutable() string {
	if custom := os.Getenv("VKM_HOOK_NODE"); custom != "" {
		return custom
	}
	if resolved, err := exec.LookPath("node"); err == nil {
		return resolved
	}
	return "node"
}

func main() {
	os.Exit(run())
}

func run() int {
	args := os.Args[1:]
	if len(args) == 0 {
		// No script to run. Report it on stderr (which the host captures) rather than on a
		// message box: this binary must never draw anything.
		fmt.Fprintln(os.Stderr, "vkm-hookw: no hook script given")
		return 2
	}

	script := args[0]
	if abs, err := filepath.Abs(script); err == nil {
		script = abs
	}

	cmd := exec.Command(nodeExecutable(), append([]string{script}, args[1:]...)...)

	// Verbatim pass-through. The hook protocol is stdin JSON in, optional stdout JSON out, exit
	// code as the verdict; buffering or rewriting any of the three would change hook behaviour.
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// The whole point: no console for the child either. Defined per-GOOS so this file stays
	// buildable everywhere — on Unix there is no console to suppress and the hook spawns nothing
	// visible in the first place.
	hideChildWindow(cmd)

	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			// A hook that deliberately blocks a tool call exits non-zero. Forward it unchanged:
			// swallowing it would turn a guard into a no-op.
			return exitErr.ExitCode()
		}

		fmt.Fprintf(os.Stderr, "vkm-hookw: could not run %s: %v\n", script, err)
		return 2
	}

	return 0
}
