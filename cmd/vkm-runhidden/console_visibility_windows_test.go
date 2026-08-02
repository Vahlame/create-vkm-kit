//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The behavioural test the kit did not have.
//
// Everything else guarding this defect is a source grep that runs on Linux, where a Windows console
// cannot exist — so the entire fix was, until now, verified by reading it. This starts real children
// and counts real windows.
//
// It is written so it cannot pass vacuously: an identical CONTROL batch is started WITHOUT the fix
// first, and if that one fails to put any console window on screen, the environment cannot observe
// this defect at all and the test skips instead of reporting a green it did not earn.

var (
	user32Test           = syscall.NewLazyDLL("user32.dll")
	procEnumWindows      = user32Test.NewProc("EnumWindows")
	procGetClassNameW    = user32Test.NewProc("GetClassNameW")
	procIsWindowVisible  = user32Test.NewProc("IsWindowVisible")
	consoleWindowClasses = []string{"ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS"}
)

// countVisibleConsoleWindows counts top-level VISIBLE windows that host a console. Both classes are
// counted: Windows 11 hosts consoles in CASCADIA_HOSTING_WINDOW_CLASS, and a counter that only knows
// the classic one reports a clean zero on the machines that still flash.
func countVisibleConsoleWindows() int {
	n := 0
	cb := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		if visible, _, _ := procIsWindowVisible.Call(hwnd); visible == 0 {
			return 1 // keep enumerating
		}
		buf := make([]uint16, 256)
		procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		class := syscall.UTF16ToString(buf)
		for _, want := range consoleWindowClasses {
			if class == want {
				n++
				break
			}
		}
		return 1
	})
	procEnumWindows.Call(cb, 0)
	return n
}

// startBatch starts n children that live ~2s, applying `decorate` to each command first.
func startBatch(t *testing.T, n int, decorate func(*exec.Cmd)) func() {
	t.Helper()
	var started []*exec.Cmd
	for i := 0; i < n; i++ {
		// `ping -n 3` is the standard way to sleep in cmd without a busy loop, and cmd.exe is
		// console-subsystem: exactly the kind of child this launcher exists for.
		cmd := exec.Command("cmd", "/c", "ping -n 3 127.0.0.1 > nul")
		decorate(cmd)
		if err := cmd.Start(); err != nil {
			t.Fatalf("could not start child %d: %v", i, err)
		}
		started = append(started, cmd)
	}
	return func() {
		for _, c := range started {
			_ = c.Process.Kill()
			_ = c.Wait()
		}
	}
}

// peakVisibleConsoles samples for a second and returns the highest count seen, because a console
// window appears asynchronously — a single sample after Start() is exactly the race this fixes.
func peakVisibleConsoles(baseline int) int {
	peak := 0
	deadline := time.Now().Add(1200 * time.Millisecond)
	for time.Now().Before(deadline) {
		if delta := countVisibleConsoleWindows() - baseline; delta > peak {
			peak = delta
		}
		time.Sleep(5 * time.Millisecond)
	}
	return peak
}

func TestChildConsolesAreCreatedHidden(t *testing.T) {
	const batch = 12
	baseline := countVisibleConsoleWindows()

	// CONTROL: a new console with no show-state override. This is what the OS does by default and
	// what must be visible for the assertion below to mean anything.
	stopControl := startBatch(t, batch, func(cmd *exec.Cmd) {
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_CONSOLE}
	})
	controlPeak := peakVisibleConsoles(baseline)
	stopControl()

	if controlPeak == 0 {
		t.Skip("no console window became visible even without the fix: this environment (a " +
			"non-interactive window station, typically) cannot observe the defect, so a pass here " +
			"would prove nothing")
	}

	// Wait for the control's windows to go away so the second baseline is honest.
	time.Sleep(500 * time.Millisecond)
	baseline = countVisibleConsoleWindows()

	stopFixed := startBatch(t, batch, hideChildConsole)
	fixedPeak := peakVisibleConsoles(baseline)
	stopFixed()

	if fixedPeak != 0 {
		t.Fatalf("hideChildConsole let %d console window(s) become visible out of %d children "+
			"(control showed %d): the child's console must be created with SW_HIDE, not hidden "+
			"afterwards — hiding afterwards is the race this replaced", fixedPeak, batch, controlPeak)
	}
}
