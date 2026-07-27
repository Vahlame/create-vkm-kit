package main

// Reading back what the daemon logged.

import (
	"bufio"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/adrg/xdg"
)

// logFileOverride lets tests redirect the JSONL log file inspectLogs() reads.
// Mirrors stateDirOverride in state.go and for the same reason: xdg.StateFile
// reads XDG_STATE_HOME at package init, so flipping the env var mid-test
// doesn't take effect.
var logFileOverride string

// logFilePath returns the JSONL log file inspectLogs() reads from.

// logFilePath returns the JSONL log file inspectLogs() reads from.
func logFilePath() (string, error) {
	if logFileOverride != "" {
		return logFileOverride, nil
	}
	return xdg.StateFile(filepath.Join("obsidian-memory", "mcp.jsonl"))
}

func inspectLogs(l *slog.Logger, n int) error {
	stateDir, err := logFilePath()
	if err != nil {
		return err
	}
	f, err := os.Open(stateDir)
	if err != nil {
		return err
	}
	defer f.Close()
	lines, err := tailLines(f, n)
	if err != nil {
		return err
	}
	for _, ln := range lines {
		fmt.Println(ln)
	}
	return nil
}

func tailLines(r io.Reader, n int) ([]string, error) {
	if n <= 0 {
		return nil, nil
	}
	var ring []string
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		ring = append(ring, sc.Text())
		if len(ring) > n {
			ring = ring[len(ring)-n:]
		}
	}
	return ring, sc.Err()
}
