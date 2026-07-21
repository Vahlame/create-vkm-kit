#!/usr/bin/env bash
# vkm-discipline evidence gate runner — detects the project's own quality gates and
# runs them, printing one compact pass/fail block. Zero config, zero deps beyond the
# project's own toolchain. Exit 0 = every detected gate passed; 1 = at least one failed;
# 0 with a notice if nothing was detected (absence of gates is a finding, not a failure).
#
# Usage: evidence-gates.sh [project-dir]   (default: current directory)
set -u
DIR="${1:-.}"
cd "$DIR" || { echo "evidence-gates: cannot cd to $DIR"; exit 2; }

PASS=0; FAIL=0; RAN=()
run_gate() { # $1 label, rest: command
  local label="$1"; shift
  local out
  if out=$("$@" 2>&1); then
    echo "PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $label"
    # Show the tail — the decisive lines of a failing gate are at the end.
    echo "$out" | tail -n 15 | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  fi
  RAN+=("$label")
}

has_npm_script() { # $1 script name — true if package.json declares it
  [ -f package.json ] && node -e "process.exit(((require('./package.json').scripts||{})['$1'])?0:1)" 2>/dev/null
}

echo "evidence-gates: $(pwd)"

if [ -f package.json ]; then
  for s in test lint typecheck; do
    if has_npm_script "$s"; then run_gate "npm run $s" npm run --silent "$s"; fi
  done
fi

if [ -f go.mod ]; then
  run_gate "go test ./..." go test ./...
  command -v gofmt >/dev/null && {
    UNFMT=$(gofmt -l . 2>/dev/null | grep -v vendor/ || true)
    if [ -n "$UNFMT" ]; then echo "FAIL  gofmt -l"; echo "$UNFMT" | sed 's/^/      /'; FAIL=$((FAIL+1));
    else echo "PASS  gofmt -l"; PASS=$((PASS+1)); fi
    RAN+=("gofmt")
  }
fi

if [ -f pyproject.toml ] || [ -f setup.py ] || ls tests/*.py >/dev/null 2>&1; then
  if command -v pytest >/dev/null 2>&1 && { [ -d tests ] || ls test_*.py >/dev/null 2>&1; }; then
    run_gate "pytest -q" pytest -q
  fi
fi

if [ -f Cargo.toml ]; then
  run_gate "cargo test" cargo test --quiet
fi

if [ -f Makefile ] && [ ${#RAN[@]} -eq 0 ]; then
  if grep -qE '^test:' Makefile; then run_gate "make test" make test; fi
fi

echo "----"
if [ ${#RAN[@]} -eq 0 ]; then
  echo "evidence-gates: no gates detected (no npm scripts/go.mod/pytest/cargo/make test)."
  echo "That absence IS the finding — verify by exercising the change directly and say so."
  exit 0
fi
echo "evidence-gates: $PASS passed, $FAIL failed (${#RAN[@]} gate(s) run)"
[ "$FAIL" -eq 0 ] || exit 1
