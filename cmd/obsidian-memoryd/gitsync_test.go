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
	mu         sync.Mutex
	calls      []string
	responses  map[string][]fakeResp // key -> sequence consumed in order
	pos        map[string]int
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
	dir := tempGitRepo(t)
	r := newFakeRunner()
	// All four steps return nil → happy path.

	if err := gitSyncWith(context.Background(), discardLogger(), dir, r); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	wantPrefix := []string{
		"git add -A",
		"git commit -m",
		"git pull --rebase",
		"git push",
	}
	if len(r.calls) != 4 {
		t.Fatalf("expected 4 calls, got %d: %v", len(r.calls), r.calls)
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
	dir := tempGitRepo(t)
	r := &verbRunner{
		responses: map[string][]fakeResp{
			"commit": {{err: &fakeExitErr{code: 1}}},
		},
	}
	if err := gitSyncWith(context.Background(), discardLogger(), dir, r); err != nil {
		t.Fatalf("empty commit should be a noop, got: %v", err)
	}
	wantVerbs := []string{"add", "commit", "pull", "push"}
	if len(r.calls) != 4 {
		t.Fatalf("expected 4 calls, got %d: %v", len(r.calls), r.calls)
	}
	for i, v := range wantVerbs {
		if r.calls[i] != v {
			t.Errorf("call %d: want verb %q, got %q", i, v, r.calls[i])
		}
	}
}

func TestGitSync_RebaseConflictAborts(t *testing.T) {
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
	// add, commit, pull, rebase --abort. Push is skipped because pull failed.
	wantVerbs := []string{"add", "commit", "pull", "rebase"}
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
	dir := t.TempDir() // no git init
	r := newFakeRunner()
	err := gitSyncWith(context.Background(), discardLogger(), dir, r)
	if err == nil || !strings.Contains(err.Error(), "not a git repo") {
		t.Fatalf("expected not-a-repo error, got: %v", err)
	}
	if len(r.calls) != 0 {
		t.Errorf("no git commands should have run, got: %v", r.calls)
	}
}

// verbRunner is a simpler fake that keys responses on the git verb (`add`,
// `commit`, `pull`, `push`, `rebase`), ignoring `-C <dir>` and other args.
// This is more ergonomic for tests that care about behavior, not exact argv.
type verbRunner struct {
	mu        sync.Mutex
	calls     []string
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
	return v.next(verb).err
}

func (v *verbRunner) Output(ctx context.Context, name string, args ...string) ([]byte, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	verb := v.verbOf(name, args)
	v.calls = append(v.calls, verb)
	r := v.next(verb)
	return r.out, r.err
}

// Sanity: filepath import used somewhere to avoid `imported and not used` if the
// test source structure changes. The tempGitRepo helper uses t.TempDir; we keep
// filepath available for future tests that exercise nested paths.
var _ = filepath.Separator
