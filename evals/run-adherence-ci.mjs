/**
 * Eval-harness smoke (NOT a real adherence check).
 *
 * Parses evals/adherence.yaml, invokes the provider for each test, and exits 1
 * if pass rate < 0.80. With the default stub provider (adherence-provider.cjs)
 * the score is always 1.0; the CI job exists to catch a broken harness
 * pipeline, not to measure agent behavior. To do real adherence, swap the
 * provider in adherence.yaml for a live LLM + MCP. See evals/README.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parse } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Provider = require("./adherence-provider.cjs");

const yamlPath = path.join(__dirname, "adherence.yaml");
const doc = parse(fs.readFileSync(yamlPath, "utf8"));
const tests = doc.tests ?? [];
const provider = new Provider();

let pass = 0;
for (const t of tests) {
  const token = t.vars?.expected_token ?? "";
  const res = await provider.callApi(`Apply vault fact token ${token}`, { vars: t.vars });
  if (String(res.output).includes(token)) pass++;
}

const score = tests.length ? pass / tests.length : 0;
console.log(`adherence_score=${score.toFixed(3)} (${pass}/${tests.length})`);
process.exit(score >= 0.8 ? 0 : 1);
