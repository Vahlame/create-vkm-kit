package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestHelperProcess is not a test: re-executed as the CHILD by TestRunForwardsChildExitCode, it
// exits with whatever code the environment asks for. The standard library's own idiom for needing
// a real process to spawn without shipping a fixture binary.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("VKM_RUNHIDDEN_HELPER") != "1" {
		t.Skip("not the helper invocation")
	}
	code, err := strconv.Atoi(os.Getenv("VKM_RUNHIDDEN_HELPER_EXIT"))
	if err != nil {
		code = 99
	}
	os.Exit(code)
}

// The exit code IS the hook protocol: a non-zero PreToolUse hook is how the memory-write and
// effort guards block a tool call. A launcher that returned 0 for a child that exited non-zero
// would silently disarm every guard on the machine, and nothing would look broken — which is
// strictly worse than the flashing console this binary exists to remove.
func TestRunForwardsChildExitCode(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatalf("cannot locate the test binary: %v", err)
	}

	original := os.Args
	t.Cleanup(func() { os.Args = original })
	os.Args = []string{"vkm-runhidden", self, "-test.run=^TestHelperProcess$"}
	t.Setenv("VKM_RUNHIDDEN_HELPER", "1")
	t.Setenv("VKM_RUNHIDDEN_HELPER_EXIT", "2")

	if got := run(); got != 2 {
		t.Fatalf("child exited 2, launcher returned %d", got)
	}
}

func TestRunReportsUsageWithoutAProgram(t *testing.T) {
	original := os.Args
	t.Cleanup(func() { os.Args = original })
	os.Args = []string{"vkm-runhidden"}

	if got := run(); got != 2 {
		t.Fatalf("expected exit 2 with no program given, got %d", got)
	}
}

func TestRunReportsAMissingExecutable(t *testing.T) {
	original := os.Args
	t.Cleanup(func() { os.Args = original })
	os.Args = []string{"vkm-runhidden", filepath.Join(t.TempDir(), "does-not-exist.exe")}

	if got := run(); got != 2 {
		t.Fatalf("expected exit 2 when the program cannot be started, got %d", got)
	}
}

// resolve is the only branching logic in this command, and getting it wrong is silent: a hook whose
// interpreter is not resolved simply never runs, and a guard hook that never runs is
// indistinguishable from one that approved the call.
func TestResolveRunsScriptsThroughNode(t *testing.T) {
	for _, script := range []string{"hook.mjs", "hook.js", "hook.cjs", "HOOK.MJS"} {
		name, argv := resolve([]string{script, "es"})

		if !strings.Contains(strings.ToLower(name), "node") {
			t.Fatalf("%s: expected node as the executable, got %q", script, name)
		}
		if len(argv) != 2 {
			t.Fatalf("%s: expected script + its argument, got %v", script, argv)
		}
		if !filepath.IsAbs(argv[0]) {
			t.Fatalf("%s: script path should be absolute, got %q", script, argv[0])
		}
		if argv[1] != "es" {
			t.Fatalf("%s: argument not forwarded, got %v", script, argv)
		}
	}
}

func TestResolveRunsExecutablesDirectly(t *testing.T) {
	name, argv := resolve([]string{`C:\tools\ollama.exe`, "serve"})

	if name != `C:\tools\ollama.exe` {
		t.Fatalf("executable should be run as given, got %q", name)
	}
	if len(argv) != 1 || argv[0] != "serve" {
		t.Fatalf("arguments not forwarded verbatim, got %v", argv)
	}
}

func TestNodeExecutableHonoursOverride(t *testing.T) {
	t.Setenv("VKM_HOOK_NODE", `C:\pinned\node.exe`)

	if got := nodeExecutable(); got != `C:\pinned\node.exe` {
		t.Fatalf("VKM_HOOK_NODE ignored, got %q", got)
	}
}
