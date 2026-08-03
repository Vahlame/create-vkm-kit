//go:build !windows

package main

import (
	"os/exec"
	"runtime"
)

// openBrowser opens url in the default browser. Only ever called behind the
// explicit --open flag (focus-steal rule, ADR-0078).
func openBrowser(url string) error {
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	return exec.Command(name, url).Start()
}
