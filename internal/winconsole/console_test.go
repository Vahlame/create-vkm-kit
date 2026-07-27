package winconsole

import "testing"

// The rule these pin is the difference between an invisible fix and destroying the user's session.
//
// ShowWindow(SW_HIDE) has no undo here: this program never shows a window again, and it exits
// leaving the terminal process alive with no window. If the console it hid was the user's own
// PowerShell — which is what it is whenever the launcher is started from a terminal — the only way
// back is Task Manager. So "did we allocate it?" is not a detail, it is the guard.

func TestHideOwnConsoleLeavesAnInheritedConsoleVisible(t *testing.T) {
	allocs, hides := 0, 0

	HideOwnConsoleWith(
		func() uintptr { return 0x1234 }, // a console already exists — the user's terminal
		func() bool { allocs++; return true },
		func(uintptr) { hides++ },
	)

	if allocs != 0 {
		t.Fatalf("AllocConsole attempted with a console already present (%d calls)", allocs)
	}
	if hides != 0 {
		t.Fatal("hid a console this process did not allocate: that is the user's own terminal " +
			"window, and nothing here ever shows it again")
	}
}

func TestHideOwnConsoleHidesTheOneItAllocated(t *testing.T) {
	const allocated = 0xBEEF
	probes := 0
	var hidden uintptr

	HideOwnConsoleWith(
		func() uintptr {
			probes++
			if probes == 1 {
				return 0 // GUI-subsystem start: no console yet
			}
			return allocated
		},
		func() bool { return true },
		func(hwnd uintptr) { hidden = hwnd },
	)

	if hidden != allocated {
		t.Fatalf("expected the allocated console %#x to be hidden, got %#x", allocated, hidden)
	}
}

func TestHideOwnConsoleDoesNothingWhenAllocationFails(t *testing.T) {
	hides := 0

	HideOwnConsoleWith(
		func() uintptr { return 0 },
		func() bool { return false }, // AllocConsole failed
		func(uintptr) { hides++ },
	)

	if hides != 0 {
		t.Fatalf("hid a window after AllocConsole failed (%d calls)", hides)
	}
}
