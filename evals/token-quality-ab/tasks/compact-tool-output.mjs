/**
 * Diag task set for experiment #5 (compact-tool-output on/off): the subject gets a
 * build/test log and must diagnose the failure. Condition A sees the log AS THE HOOK
 * WOULD EMIT IT (real compactText over the fixture); condition B sees the raw log.
 * Grading is deterministic string presence: the error identifier AND the file:line
 * the fix would touch — both required for full credit, either alone scores 50.
 *
 * The fixtures are the same adversarial real-failure logs that gate CI
 * (packages/create-vkm-kit/test/compact-fixtures/) — decisive line buried mid-stream.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactText } from "../../../packages/create-vkm-kit/src/hooks/compact-tool-output.mjs";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "create-vkm-kit",
  "test",
  "compact-fixtures"
);

/** Ground truth (never shown to subjects). */
export const DIAG_TASKS = [
  {
    id: "diag-npm",
    fixture: "npm-build-fail.txt",
    intro: "A CI build failed. Below is the full output of `npm run build`.",
    errorId: "TS2339",
    fileLine: "client.ts:47"
  },
  {
    id: "diag-pytest",
    fixture: "pytest-fail.txt",
    intro: "A test job failed. Below is the full output of `pytest`.",
    errorId: "AssertionError",
    fileLine: "test_sync.py:88"
  },
  {
    id: "diag-go",
    fixture: "go-race-fail.txt",
    intro: "A Go test job failed. Below is the full output of `go test -race ./...`.",
    errorId: "DATA RACE",
    fileLine: "state.go:161"
  },
  {
    id: "diag-etl",
    fixture: "etl-silent-drift.txt",
    intro:
      "A nightly ETL job 'succeeded' but the report total is wrong by one cent. Below is its full log.",
    errorId: "12,50",
    fileLine: "row 4412"
  }
];

/** @param {{id:string,fixture:string,intro:string}} task @param {"compacted"|"raw"} condition */
export function subjectPrompt(task, condition) {
  const raw = readFileSync(path.join(FIXTURES, task.fixture), "utf8");
  const log = condition === "compacted" ? compactText(raw).text : raw;
  return [
    task.intro,
    "",
    "Diagnose the failure from the log alone. Answer in exactly two lines:",
    "ERROR: <the error identifier / message that names the failure>",
    "LOCATION: <file:line the fix would touch>",
    "",
    "--- LOG START ---",
    log,
    "--- LOG END ---"
  ].join("\n");
}

/** Deterministic grade 0–100. @param {{errorId:string,fileLine:string}} task @param {string} answer */
export function grade(task, answer) {
  const a = String(answer);
  const hasError = a.includes(task.errorId);
  // Accept path suffix matches ("src/api/client.ts:47" or "client.ts:47").
  const hasLoc = a.includes(task.fileLine);
  return (hasError ? 50 : 0) + (hasLoc ? 50 : 0);
}
