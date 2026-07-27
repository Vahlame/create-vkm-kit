//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// superviseChild ties the child's lifetime to this process's.
//
// # Why a launcher must propagate death, not just the exit code
//
// This binary already forwards stdin, stdout and the exit code, which made it look
// transparent. It was not: killing the LAUNCHER left the child running. Every caller that
// bounds a subprocess by killing it — `execa`'s `timeout` on the Python RAG backend, on an
// obscura fetch, on `git` — was silently reduced to killing a middleman while the real
// process kept the pipe open and kept running. Caught by the RAG timeout test, which stopped
// timing out and instead ran for 1,000 seconds.
//
// A Windows job object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is the mechanism for this:
// when the last handle to the job closes — which happens when this process exits, however it
// exits, including being killed — Windows terminates every process in the job. Membership is
// inherited, so the child's own children go too. That matters here specifically: the whole
// point of this launcher is that the child spawns a tree.
//
// Failing to create or assign the job is NOT fatal. A launcher that refuses to run is worse
// than one whose cleanup is best-effort: the caller still gets its program, its output and
// its exit code, and loses only the guarantee that a kill reaches the grandchildren.
//
// The returned closer keeps the handle alive; the caller holds it until the child is done.
func superviseChild(pid int) (close func(), ok bool) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return func() {}, false
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		windows.CloseHandle(job)
		return func() {}, false
	}

	// PROCESS_SET_QUOTA | PROCESS_TERMINATE are what AssignProcessToJobObject needs.
	h, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(pid),
	)
	if err != nil {
		windows.CloseHandle(job)
		return func() {}, false
	}
	defer windows.CloseHandle(h)

	if err := windows.AssignProcessToJobObject(job, h); err != nil {
		windows.CloseHandle(job)
		return func() {}, false
	}
	return func() { windows.CloseHandle(job) }, true
}
