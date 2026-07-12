package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// --- truncate (rune-safe) ------------------------------------------------

func TestTruncateIsRuneSafe(t *testing.T) {
	// "código" — cutting at byte 5 would land mid-rune (the 'ó' is 2 bytes in
	// UTF-8); cutting at rune 5 must not.
	s := "código está OK"
	got := truncate([]byte(s), 5)
	if !strings.HasSuffix(got, "...") {
		t.Fatalf("expected an ellipsis suffix, got %q", got)
	}
	if !utf8.ValidString(got) {
		t.Errorf("truncate produced invalid UTF-8: %q", got)
	}
	if r := []rune(strings.TrimSuffix(got, "...")); len(r) != 5 {
		t.Errorf("expected exactly 5 runes before the ellipsis, got %d (%q)", len(r), got)
	}
}

func TestTruncateUnderLimitIsUnchanged(t *testing.T) {
	if got := truncate([]byte("short"), 100); got != "short" {
		t.Errorf("expected unchanged short input, got %q", got)
	}
}

// --- execRunner (real subprocess) ----------------------------------------

// TestExecRunnerRunCapturesStderr verifies Run() no longer discards stderr:
// a failing command's stderr text must be findable in the returned error, not
// just a bare "exit status N".
func TestExecRunnerRunCapturesStderr(t *testing.T) {
	err := defaultRunner.Run(context.Background(), "git", "this-is-not-a-git-command")
	if err == nil {
		t.Fatal("expected an error from an invalid git subcommand")
	}
	if !strings.Contains(err.Error(), "git") {
		t.Errorf("expected stderr text to be included in the error, got: %v", err)
	}
}

func TestExecRunnerRunSucceedsWithNoStderr(t *testing.T) {
	if err := defaultRunner.Run(context.Background(), "git", "--version"); err != nil {
		t.Fatalf("expected git --version to succeed, got %v", err)
	}
}

// TestExecRunnerRunUnwrapsToExitError verifies fmt.Errorf("%w: ...", err) still
// lets callers reach the underlying exitCoder via errors.As (commitStep and
// other exit-code-sensitive callers depend on this).
func TestExecRunnerRunUnwrapsToExitError(t *testing.T) {
	err := defaultRunner.Run(context.Background(), "git", "this-is-not-a-git-command")
	var ce exitCoder
	if !errors.As(err, &ce) {
		t.Fatalf("expected errors.As to find an exitCoder in %v", err)
	}
}

// --- watchDebounce -----------------------------------------------------

func TestWatchDebounce(t *testing.T) {
	cases := []struct {
		name string
		env  string
		set  bool
		want time.Duration
	}{
		{"unset uses default", "", false, 45 * time.Second},
		{"empty string uses default", "", true, 45 * time.Second},
		{"valid mid-range value is honored", "2m", true, 2 * time.Minute},
		{"below minimum falls back to default", "1s", true, 45 * time.Second},
		{"zero falls back to default", "0s", true, 45 * time.Second},
		{"negative falls back to default", "-10s", true, 45 * time.Second},
		{"at minimum boundary is honored", "5s", true, 5 * time.Second},
		{"above maximum clamps to max", "20m", true, 15 * time.Minute},
		{"at maximum boundary is honored", "15m", true, 15 * time.Minute},
		{"malformed string falls back to default", "not-a-duration", true, 45 * time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.set {
				t.Setenv("OBSIDIAN_MEMORY_DEBOUNCE", tc.env)
			}
			if got := watchDebounce(); got != tc.want {
				t.Errorf("want %v, got %v", tc.want, got)
			}
		})
	}
}

// --- flagValue -----------------------------------------------------------

func TestFlagValue(t *testing.T) {
	cases := []struct {
		name string
		args []string
		flag string
		def  string
		want string
	}{
		{"present with value", []string{"--vault", "/tmp/x"}, "--vault", "def", "/tmp/x"},
		{"absent returns default", []string{"--other", "y"}, "--vault", "def", "def"},
		{"flag is last element returns default", []string{"foo", "--vault"}, "--vault", "def", "def"},
		{"empty args returns default", []string{}, "--vault", "def", "def"},
		{"first of repeated flags wins", []string{"--vault", "first", "--vault", "second"}, "--vault", "def", "first"},
		{"partial name match does not match", []string{"--vault2", "x"}, "--vault", "def", "def"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := flagValue(tc.args, tc.flag, tc.def); got != tc.want {
				t.Errorf("want %q, got %q", tc.want, got)
			}
		})
	}
}

// --- tailLines -------------------------------------------------------------

func TestTailLines(t *testing.T) {
	cases := []struct {
		name  string
		lines []string
		n     int
		want  []string
	}{
		{"n greater than available returns all", []string{"a", "b", "c"}, 10, []string{"a", "b", "c"}},
		{"n zero returns none", []string{"a", "b", "c"}, 0, nil},
		{"n negative returns none rather than panicking", []string{"a", "b", "c"}, -5, nil},
		{"empty log returns none", nil, 5, nil},
		{"n less than available returns the tail in order", []string{"a", "b", "c", "d", "e"}, 2, []string{"d", "e"}},
		{"n equal to available returns all", []string{"a", "b"}, 2, []string{"a", "b"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := strings.Join(tc.lines, "\n")
			if len(tc.lines) > 0 {
				input += "\n"
			}
			got, err := tailLines(strings.NewReader(input), tc.n)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("want %v, got %v", tc.want, got)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("index %d: want %q, got %q", i, tc.want[i], got[i])
				}
			}
		})
	}
}

func TestTailLinesEmptyReaderNoTrailingNewline(t *testing.T) {
	got, err := tailLines(strings.NewReader(""), 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected no lines from an empty reader, got %v", got)
	}
}

// --- inspectLogs -----------------------------------------------------------

// withTempLogFile redirects logFilePath() to a fresh file under a tmp dir for
// the duration of the test.
func withTempLogFile(t *testing.T, lines []string) string {
	t.Helper()
	dir := t.TempDir()
	fp := filepath.Join(dir, "mcp.jsonl")
	content := strings.Join(lines, "\n")
	if len(lines) > 0 {
		content += "\n"
	}
	if err := os.WriteFile(fp, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	logFileOverride = fp
	t.Cleanup(func() { logFileOverride = "" })
	return fp
}

func TestInspectLogsMissingFileErrors(t *testing.T) {
	logFileOverride = filepath.Join(t.TempDir(), "does-not-exist.jsonl")
	t.Cleanup(func() { logFileOverride = "" })
	if err := inspectLogs(discardLogger(), 10); err == nil {
		t.Error("expected an error opening a missing log file")
	}
}

func TestInspectLogsPrintsOnlyTheTail(t *testing.T) {
	withTempLogFile(t, []string{"l1", "l2", "l3", "l4", "l5"})

	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w

	inspectErr := inspectLogs(discardLogger(), 2)

	w.Close()
	os.Stdout = old
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)

	if inspectErr != nil {
		t.Fatalf("unexpected error: %v", inspectErr)
	}
	got := buf.String()
	if !strings.Contains(got, "l4") || !strings.Contains(got, "l5") {
		t.Errorf("expected the last 2 lines present, got: %q", got)
	}
	if strings.Contains(got, "l1") || strings.Contains(got, "l2") || strings.Contains(got, "l3") {
		t.Errorf("expected only the last 2 lines, older lines leaked: %q", got)
	}
}

func TestInspectLogsEmptyFile(t *testing.T) {
	withTempLogFile(t, nil)
	if err := inspectLogs(discardLogger(), 10); err != nil {
		t.Fatalf("an empty log file should not error, got %v", err)
	}
}
