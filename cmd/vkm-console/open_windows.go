//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// openBrowser opens url in the default browser. Only ever called behind the
// explicit --open flag (focus-steal rule, ADR-0078). HideWindow is the
// SysProcAttr equivalent of windowsHide:true — rundll32 must not flash a
// console while handing the URL to the shell.
func openBrowser(url string) error {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}
