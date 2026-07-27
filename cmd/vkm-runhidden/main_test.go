package main

import (
	"path/filepath"
	"strings"
	"testing"
)

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
