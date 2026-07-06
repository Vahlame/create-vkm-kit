package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeExitErr satisfies the exitCoder interface so tests can simulate
// `git commit` exit code 1 (nothing to commit) without spawning a real process.
type fakeExitErr struct{ code int }

func (f *fakeExitErr) Error() string { return fmt.Sprintf("exit status %d", f.code) }
func (f *fakeExitErr) ExitCode() int { return f.code }

// fakeRunner scripts responses indexed by the command shape (joined with spaces).
// Unscripted commands return nil error and empty output.
type fakeRunner struct {
	mu        sync.Mutex
	calls     []string
	responses map[string][]fakeResp // key -> sequence consumed in order
	pos       map[string]int
}

type fakeResp struct {
	out []byte
	err error
}

func newFakeRunner() *fakeRunner {
	return &fakeRunner{responses: map[string][]fakeResp{}, pos: map[string]int{}}
}

func (f *fakeRunner) script(key string, resps ...fakeResp) {
	f.responses[key] = append(f.responses[key], resps...)
}

func (f *fakeRunner) next(key string) (fakeResp, bool) {
	idx := f.pos[key]
	if idx >= len(f.responses[key]) {
		return fakeResp{}, false
	}
	f.pos[key] = idx + 1
	return f.responses[key][idx], true
}

func cmdKey(name string, args []string) string {
	// Reduce `git -C <tmpdir> add -A` to `git add -A` so tests are independent
	// of the temp directory path.
	if name == "git" && len(args) >= 2 && args[0] == "-C" {
		args = args[2:]
	}
	return name + " " + strings.Join(args, " ")
}

func (f *fakeRunner) Run(ctx context.Context, name string, args ...string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := cmdKey(name, args)
	f.calls = append(f.calls, key)
	resp, ok := f.next(key)
	if !ok {
		return nil
	}
	return resp.err
}

func (f *fakeRunner) Output(ctx context.Context, name string, args ...string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := cmdKey(name, args)
	f.calls = append(f.calls, key)
	resp, ok := f.next(key)
	if !ok {
		return nil, nil
	}
	return resp.out, resp.err
}

// tempGitRepo creates a temp dir initialized as a git repo so git.PlainOpen succeeds.
func tempGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	// `git init` ensures `.git` exists; we don't need any commits for these tests.
	cmd := exec.Command("git", "init", dir)
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init failed: %v\n%s", err, out)
	}
	return dir
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestGitSync_HappyPath(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	r := newFakeRunner()
	// All four steps return nil → happy path.

	if err := gitSyncWith(context.Background(), discardLogger(), dir, r); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	// A full successful cycle records sync health: LastSyncOK set, no failures.
	if s := readState(); s.LastSyncOK.IsZero() || s.ConsecutiveSyncFailures != 0 {
		t.Errorf("happy path should set LastSyncOK and zero sync failures, got %+v", s)
	}
	wantPrefix := []string{
		"git add -A",
		"git diff --cached --name-only",
		"git commit -m",
		"git pull --rebase",
		"git push",
	}
	if len(r.calls) != 5 {
		t.Fatalf("expected 5 calls, got %d: %v", len(r.calls), r.calls)
	}
	for i, p := range wantPrefix {
		if !strings.HasPrefix(r.calls[i], p) {
			t.Errorf("call %d: want prefix %q, got %q", i, p, r.calls[i])
		}
	}
}

// TestGitSync_EmptyCommit verifies the noop-on-exit-1 path using verbRunner,
// which keys responses by git verb so we don't have to match the exact commit
// message (which embeds an RFC3339 timestamp).
func TestGitSync_EmptyCommit(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	r := &verbRunner{
		responses: map[string][]fakeResp{
			"commit": {{err: &fakeExitErr{code: 1}}},
		},
	}
	if err := gitSyncWith(context.Background(), discardLogger(), dir, r); err != nil {
		t.Fatalf("empty commit should be a noop, got: %v", err)
	}
	wantVerbs := []string{"add", "diff", "commit", "pull", "push"}
	if len(r.calls) != 5 {
		t.Fatalf("expected 5 calls, got %d: %v", len(r.calls), r.calls)
	}
	for i, v := range wantVerbs {
		if r.calls[i] != v {
			t.Errorf("call %d: want verb %q, got %q", i, v, r.calls[i])
		}
	}
}

func TestGitSync_RebaseConflictAborts(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	r := &verbRunner{
		responses: map[string][]fakeResp{
			"pull": {{out: []byte("Auto-merging foo\nCONFLICT (content): Merge conflict in foo\n"), err: errors.New("rebase failed")}},
		},
	}
	err := gitSyncWith(context.Background(), discardLogger(), dir, r)
	if err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("expected conflict error, got: %v", err)
	}
	// add, diff, commit, pull, rebase --abort. Push is skipped because pull failed.
	wantVerbs := []string{"add", "diff", "commit", "pull", "rebase"}
	if len(r.calls) != len(wantVerbs) {
		t.Fatalf("expected %d calls, got %d: %v", len(wantVerbs), len(r.calls), r.calls)
	}
	for i, v := range wantVerbs {
		if r.calls[i] != v {
			t.Errorf("call %d: want verb %q, got %q", i, v, r.calls[i])
		}
	}
}

func TestGitSync_PushRetriesThenSucceeds(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	r := &verbRunner{
		responses: map[string][]fakeResp{
			// First two push attempts fail with a generic error; third succeeds (nil).
			"push": {
				{err: errors.New("network unreachable")},
				{err: errors.New("network unreachable")},
				{err: nil},
			},
		},
	}
	start := time.Now()
	if err := gitSyncWith(context.Background(), discardLogger(), dir, r); err != nil {
		t.Fatalf("expected push to succeed on retry, got: %v", err)
	}
	// Two backoffs: 500ms + 1000ms = 1500ms minimum.
	if elapsed := time.Since(start); elapsed < 1400*time.Millisecond {
		t.Errorf("expected at least ~1.5s of backoff, got %v", elapsed)
	}
	pushCount := 0
	for _, c := range r.calls {
		if c == "push" {
			pushCount++
		}
	}
	if pushCount != 3 {
		t.Errorf("expected 3 push attempts, got %d (calls: %v)", pushCount, r.calls)
	}
}

func TestGitSync_PushAllAttemptsFail(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	r := &verbRunner{
		responses: map[string][]fakeResp{
			"push": {
				{err: errors.New("auth required")},
				{err: errors.New("auth required")},
				{err: errors.New("auth required")},
			},
		},
	}
	err := gitSyncWith(context.Background(), discardLogger(), dir, r)
	if err == nil || !strings.Contains(err.Error(), "3 attempts") {
		t.Fatalf("expected exhausted-retries error, got: %v", err)
	}
}

func TestGitSync_NotARepoRejects(t *testing.T) {
	withTempStateDir(t)
	dir := t.TempDir() // no git init
	r := newFakeRunner()
	err := gitSyncWith(context.Background(), discardLogger(), dir, r)
	if err == nil || !strings.Contains(err.Error(), "not a git repo") {
		t.Fatalf("expected not-a-repo error, got: %v", err)
	}
	if len(r.calls) != 0 {
		t.Errorf("no git commands should have run, got: %v", r.calls)
	}
	// Even a "not a git repo" cycle is a sync failure the user should see.
	if s := readState(); s.ConsecutiveSyncFailures != 1 {
		t.Errorf("not-a-repo should record a sync failure, got %d", s.ConsecutiveSyncFailures)
	}
}

// TestGitSync_PullFailureRecordsSyncFailure is the regression test for the health
// blind spot: a NON-push step failing (here a non-conflict `pull --rebase`, e.g.
// expired credentials) must bump the sync-failure counter so `doctor` alarms —
// previously only push failures did, so a stuck pull left doctor falsely green.
func TestGitSync_PullFailureRecordsSyncFailure(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	r := &verbRunner{
		responses: map[string][]fakeResp{
			"pull": {{out: []byte("fatal: Authentication failed for 'https://example/repo'"), err: errors.New("auth failed")}},
		},
	}
	err := gitSyncWith(context.Background(), discardLogger(), dir, r)
	if err == nil || !strings.Contains(err.Error(), "pull --rebase") {
		t.Fatalf("expected a pull failure error, got: %v", err)
	}
	for _, c := range r.calls {
		if c == "push" {
			t.Fatalf("push must not run after a pull failure; calls: %v", r.calls)
		}
	}
	s := readState()
	if s.ConsecutiveSyncFailures != 1 {
		t.Errorf("pull failure should record a sync failure, got ConsecutiveSyncFailures=%d", s.ConsecutiveSyncFailures)
	}
	if s.ConsecutivePushFailures != 0 {
		t.Errorf("a pull failure must NOT be counted as a push failure, got %d", s.ConsecutivePushFailures)
	}
	if s.LastSyncError == "" {
		t.Error("LastSyncError should carry the failure message")
	}
	if !s.LastSyncOK.IsZero() {
		t.Error("LastSyncOK should stay zero when the cycle failed")
	}
}

// TestGitSync_SuccessAfterFailureResetsCounter verifies a good sync clears the
// consecutive sync-failure counter + last error (so a transient outage that
// recovers doesn't keep alarming).
func TestGitSync_SuccessAfterFailureResetsCounter(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	recordSyncFailure(errors.New("boom"))
	recordSyncFailure(errors.New("boom"))
	if s := readState(); s.ConsecutiveSyncFailures != 2 {
		t.Fatalf("setup: expected 2 prior failures, got %d", s.ConsecutiveSyncFailures)
	}
	r := newFakeRunner() // all steps succeed
	if err := gitSyncWith(context.Background(), discardLogger(), dir, r); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	s := readState()
	if s.ConsecutiveSyncFailures != 0 {
		t.Errorf("a successful sync should reset the counter, got %d", s.ConsecutiveSyncFailures)
	}
	if s.LastSyncError != "" {
		t.Errorf("a successful sync should clear the last error, got %q", s.LastSyncError)
	}
	if s.LastSyncOK.IsZero() {
		t.Error("LastSyncOK should be set after success")
	}
}

// verbRunner is a simpler fake that keys responses on the git verb (`add`,
// `commit`, `pull`, `push`, `rebase`), ignoring `-C <dir>` and other args.
// This is more ergonomic for tests that care about behavior, not exact argv.
type verbRunner struct {
	mu        sync.Mutex
	calls     []string
	rawCalls  [][]string // full argv per call, for tests that assert message content
	responses map[string][]fakeResp
	pos       map[string]int
}

func (v *verbRunner) verbOf(name string, args []string) string {
	if name != "git" {
		return name
	}
	// Skip `-C <dir>` prefix.
	if len(args) >= 2 && args[0] == "-C" {
		args = args[2:]
	}
	if len(args) == 0 {
		return ""
	}
	return args[0]
}

func (v *verbRunner) next(verb string) fakeResp {
	if v.pos == nil {
		v.pos = map[string]int{}
	}
	idx := v.pos[verb]
	seq := v.responses[verb]
	if idx >= len(seq) {
		return fakeResp{}
	}
	v.pos[verb] = idx + 1
	return seq[idx]
}

func (v *verbRunner) Run(ctx context.Context, name string, args ...string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	verb := v.verbOf(name, args)
	v.calls = append(v.calls, verb)
	v.rawCalls = append(v.rawCalls, append([]string{name}, args...))
	return v.next(verb).err
}

func (v *verbRunner) Output(ctx context.Context, name string, args ...string) ([]byte, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	verb := v.verbOf(name, args)
	v.calls = append(v.calls, verb)
	v.rawCalls = append(v.rawCalls, append([]string{name}, args...))
	r := v.next(verb)
	return r.out, r.err
}

// Sanity: filepath import used somewhere to avoid `imported and not used` if the
// test source structure changes. The tempGitRepo helper uses t.TempDir; we keep
// filepath available for future tests that exercise nested paths.
var _ = filepath.Separator

func TestCommitMessage(t *testing.T) {
	now := time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC)
	many := make([]string, 25)
	for i := range many {
		many[i] = fmt.Sprintf("notes/n%02d.md", i)
	}
	cases := []struct {
		name        string
		files       []string
		agent       string
		wantSubject string
		wantInBody  []string
		wantNotBody []string
	}{
		{
			name:        "no files no agent falls back to bare timestamp",
			wantSubject: "auto: 2026-07-06T00:00:00Z",
		},
		{
			name:        "single file",
			files:       []string{"MEMORY.md"},
			wantSubject: "auto: 2026-07-06T00:00:00Z (1 file)",
			wantInBody:  []string{"MEMORY.md"},
		},
		{
			name:        "three files with agent trailer",
			files:       []string{"a.md", "b.md", "c.md"},
			agent:       "laptop-claude",
			wantSubject: "auto: 2026-07-06T00:00:00Z (3 files)",
			wantInBody:  []string{"a.md", "b.md", "c.md", "Agent: laptop-claude"},
		},
		{
			name:        "25 files truncate at 20",
			files:       many,
			wantSubject: "auto: 2026-07-06T00:00:00Z (25 files)",
			wantInBody:  []string{"notes/n19.md", "…and 5 more"},
			wantNotBody: []string{"notes/n20.md"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			subject, body := commitMessage(now, tc.files, tc.agent)
			if subject != tc.wantSubject {
				t.Errorf("subject: want %q, got %q", tc.wantSubject, subject)
			}
			for _, w := range tc.wantInBody {
				if !strings.Contains(body, w) {
					t.Errorf("body should contain %q, got:\n%s", w, body)
				}
			}
			for _, w := range tc.wantNotBody {
				if strings.Contains(body, w) {
					t.Errorf("body should NOT contain %q, got:\n%s", w, body)
				}
			}
		})
	}
}

// TestGitSync_CommitCarriesFileListAndAgent asserts the actual `git commit`
// argv embeds the staged-file list (from `diff --cached --name-only`) and the
// OBSIDIAN_MEMORY_AGENT trailer — the audit-trail contract, end to end.
func TestGitSync_CommitCarriesFileListAndAgent(t *testing.T) {
	withTempStateDir(t)
	t.Setenv("OBSIDIAN_MEMORY_AGENT", "test-daemon")
	dir := tempGitRepo(t)
	r := &verbRunner{
		responses: map[string][]fakeResp{
			"diff": {{out: []byte("MEMORY.md\nPROJECTS/kit.md\n")}},
		},
	}
	if err := gitSyncWith(context.Background(), discardLogger(), dir, r); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	var commitArgv []string
	for _, argv := range r.rawCalls {
		if len(argv) > 3 && argv[3] == "commit" {
			commitArgv = argv
		}
	}
	if commitArgv == nil {
		t.Fatalf("no commit call recorded: %v", r.calls)
	}
	joined := strings.Join(commitArgv, "\x00")
	for _, want := range []string{"(2 files)", "MEMORY.md", "PROJECTS/kit.md", "Agent: test-daemon"} {
		if !strings.Contains(joined, want) {
			t.Errorf("commit argv should contain %q, got: %q", want, commitArgv)
		}
	}
}

// TestGitSync_DiffFailureStillCommits: the staged-file list is best-effort — a
// failing diff must not block the sync cycle, just degrade to the bare subject.
func TestGitSync_DiffFailureStillCommits(t *testing.T) {
	withTempStateDir(t)
	dir := tempGitRepo(t)
	r := &verbRunner{
		responses: map[string][]fakeResp{
			"diff": {{out: nil, err: errors.New("diff exploded")}},
		},
	}
	if err := gitSyncWith(context.Background(), discardLogger(), dir, r); err != nil {
		t.Fatalf("diff failure must not fail the sync, got %v", err)
	}
	wantVerbs := []string{"add", "diff", "commit", "pull", "push"}
	for i, v := range wantVerbs {
		if r.calls[i] != v {
			t.Errorf("call %d: want %q, got %q", i, v, r.calls[i])
		}
	}
}
