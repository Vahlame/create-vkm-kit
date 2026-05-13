/**
 * CI adherence check without promptfoo DB (parses evals/adherence.yaml).
 * adherence_score = passed / total; exits 1 if score < 0.80
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
