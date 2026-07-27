//go:build !windows

package main

// superviseChild is a no-op off Windows.
//
// The launcher itself only exists for Windows consoles, and on Unix a killed parent's
// children are reparented rather than terminated — which is the platform's documented
// behaviour, not something this binary should override. Callers that need a process
// group there manage it themselves.
func superviseChild(int) (close func(), ok bool) { return func() {}, false }
