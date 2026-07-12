# How to benchmark different models — a rigorous methodology

A working guide to building benchmarks that fairly compare **different models** (e.g. Haiku vs
Sonnet vs Opus, or your system vs stock). Grounded in the primary sources fetched for it (cited
inline); the worked example is this repo's own `discipline-bench`. Where a claim is our own synthesis
or experience it is marked as such — separate what a source _says_ from your inference.

> The one-line thesis: **a benchmark is a measurement instrument. Validate the instrument before you
> trust its numbers, hold everything constant except the one thing you're comparing, grade by real
> outcomes not by claims, and report uncertainty honestly.**

---

## 0. First, decide what you're actually measuring

A number is meaningless until the question is precise. Pin down, in writing, before any task design:

- **The construct.** Capability (can the model do X at all?), task-fit (which model is best for _my_
  workload?), or **reliability** (does it do X _consistently_?). These need different designs — a
  single-shot accuracy number says nothing about reliability, which is often what production needs
  (τ-bench introduces `pass^k` precisely because agents that pass once fail on retry — gpt-4o `pass^8`
  < 25% in retail [τ-bench, arXiv 2406.12045]).
- **The unit of comparison.** Model alone? Model + scaffolding + tools + prompt? A "model benchmark"
  that changes the prompt per model measures the prompt, not the model. Decide and hold it constant
  (see §4).
- **Construct validity.** Does passing the task actually require the capability you claim? A task a
  model aces by pattern-matching the format is not measuring reasoning.

---

## 1. Task design — the hardest and most-neglected part

### 1.1 Discriminate, don't saturate

If every model scores ~100, the benchmark measures nothing. In this repo's `discipline-bench`, an
**explicit** parse task (every rule spelled out) saturated at 100 across Haiku/Sonnet/Opus and both
conditions — no signal. The **under-specified** variant of the _same_ task (rules must be inferred)
separated them sharply (Haiku 31→87.5, Opus 40.5→84.5). The SOP-suite's own program found the same:
model separation only appeared on hard/ambiguous tasks (its RUN10), while easy visible-contract tasks
saturated (RUN9). **Design for the frontier of current capability**, or you get a flat line. SWE-bench
is the canonical example: real GitHub issues so hard the best model at release solved **1.96%**
[SWE-bench, arXiv 2310.06770] — years of headroom, so the benchmark keeps discriminating as models improve.

### 1.2 Ecological validity — test the real job

Synthetic toy tasks over-reward narrow skills. SWE-bench draws from **real** repositories and issues,
requiring coordination across files, long contexts, and execution — "far beyond traditional code
generation" [arXiv 2310.06770]. τ-bench emulates a **real** agent↔user conversation with domain
policy rules [arXiv 2406.12045]. The closer the task is to the deployment, the more the number predicts.

### 1.3 Difficulty is a knob, and it interacts with the model

Effects are not uniform across difficulty. Our own finding (and the SOP bench): interventions that
help on hard/ambiguous tasks can be **overhead on easy ones**, especially for small models. So a
benchmark that is _all_ easy or _all_ hard will mislead. Span a difficulty range, and report per-band.

### 1.4 Coverage and multi-dimensionality

One task, one domain generalizes poorly (a limitation we flag honestly in our own bench). HELM's
answer is a **taxonomy of scenarios × metrics**, densely evaluated so no model is measured on a
different subset than another [HELM, arXiv 2211.09110]. Even a small benchmark should cover a few
distinct task types and not collapse to a single skill.

---

## 2. Grading — measure outcomes, not claims

A hierarchy, most-trustworthy first:

1. **Execution / state-based (gold standard where possible).** Run the output and check reality:
   hidden unit tests (HumanEval's functional-correctness [Codex, arXiv 2107.03374]; SWE-bench runs the
   repo's tests [arXiv 2310.06770]) or compare the **final state** to an annotated goal state
   (τ-bench compares the end database state, _not_ the transcript text [arXiv 2406.12045]). This is
   the honest kind — our `discipline-bench` grades a solution against 16 hidden tests it never sees.
   Crucially it is **reward-hacking-resistant**: grading the end state catches "fabricated compliance"
   (a subject that _claims_ it validated but never did — a failure mode the SOP bench observed and
   only state-grading caught).
2. **Reference / exact-or-fuzzy match.** Cheap, objective, but brittle for open-ended output and
   easily gamed by format-matching.
3. **LLM-as-a-judge.** Scalable for open-ended tasks: a strong judge reaches >80% agreement with
   humans — the same as human-human agreement [Judging LLM-as-a-Judge, arXiv 2306.05685]. But it
   carries **measurable biases you must mitigate**: position bias (favours the first/second answer),
   verbosity bias (favours longer), self-enhancement bias (favours its own family's style), and
   limited reasoning on hard judgments [arXiv 2306.05685]. Mitigations: swap positions and average,
   use a rubric with explicit criteria, use a different family as judge than the ones under test,
   calibrate against a human-labelled subset, and prefer pairwise comparison over absolute scores.
4. **Human.** Highest validity, lowest scale/reproducibility. Reserve for calibrating the cheaper graders.

**Rule:** push grading as far up this list as the task allows. If you _can_ grade by execution, do —
an LLM judge on a task that has a hidden test is strictly worse.

### 2.1 Validate the grader itself

The instrument can be wrong. Before trusting scores, run the grader on a **known-good** and a
**known-bad** reference and confirm it discriminates (our bench: `good.mjs`→100, `naive.mjs`→38). A
grader that can't tell them apart invalidates every number downstream. Also run a **mutation test** on
the grader (the SOP bench's `mutation_test.py`): deliberately break a solution and confirm the grader
catches it — this is the "test of the test."

---

## 3. Isolate the variable — conditions, ablations, attribution

Comparing models is an experiment; treat it like one.

- **A/B the one thing.** To measure an intervention (a skill, a prompt, a scaffold), run **stock vs
  +intervention** on the identical task and model — the delta isolates it (our bench: stock vs
  +discipline). To compare models, hold the intervention constant and vary only the model.
- **Ablate** multi-part systems: turn pieces off one at a time to attribute the effect.
- **Watch for interactions.** The model×difficulty interaction is real (§1.3): report the cells, not
  just a grand mean, or a helpful-on-hard/harmful-on-easy intervention averages to "no effect" and you
  learn nothing.

---

## 4. Fair cross-model comparison — hold everything else constant

The #1 way model benchmarks lie is an uncontrolled confound. Standardize, and record, all of:

- **Prompt & format.** Identical prompt, few-shot examples, and output format for every model. Prompt
  sensitivity is large; a prompt tuned for one family flatters it. HELM's core contribution was
  evaluating 30 models on the **same** scenarios/metrics under **standardized conditions**, because
  before it "models were evaluated on just 17.9% of the core scenarios" — often with nothing in common
  [HELM, arXiv 2211.09110]. (Tradeoff to state explicitly: identical prompts can under-serve a model
  that needs a different format; per-model light prompt-adaptation is defensible _if_ disclosed and
  applied symmetrically.)
- **Scaffolding & tools.** Same agent loop, same tool set, same retry policy, same max steps.
- **Sampling parameters.** Same temperature, top-p, max tokens. Temperature > 0 adds variance (see §5);
  temperature 0 reduces it but isn't fully deterministic.
- **Context & resources.** Same context window usage, same time/compute budget where relevant (HELM
  measures efficiency as a first-class metric).
- **Pin the exact model version.** "gpt-4o" or "claude" is not a version. Model updates silently change
  outputs and break prior comparisons — record the exact dated model id and re-run when it changes
  (the version-drift gotcha, also central to grading LLM-generated artifacts).

---

## 5. Statistical rigor — one run is an anecdote

LLMs are non-deterministic; a single score per cell is noise. In our own bench a disciplined Haiku
scored 94 on one run and 81 on the next (one replica forgot to sort/dedup) — the per-run spread was
~±7-13. Report accordingly:

- **Replicas + central tendency + spread.** Multiple runs per cell; report the mean and the spread
  (or a confidence interval). A delta only means something if it clears the noise band — ours did
  (+44 to +63 vs a ~±10 band).
- **`pass@k` vs `pass^k` — know which you want.**
  - `pass@k` = probability that **at least one** of k samples passes. The Codex paper gives the
    unbiased estimator and shows repeated sampling is powerful (100 samples → 70.2% on their set)
    [arXiv 2107.03374]. Good for "can it, with retries?"
  - `pass^k` = probability that **all k** independent trials pass — a **reliability/consistency**
    metric (τ-bench: gpt-4o `pass^8` < 25%) [arXiv 2406.12045]. Good for "will it, every time?"
  - These can point opposite directions; pick the one that matches your construct (§0).
- **Enough items for power.** A 10-item benchmark can't distinguish 70% from 75%. Size the item count
  to the effect you need to detect; report significance (or at least CIs) for model-vs-model claims,
  not raw point differences.

---

## 6. Contamination — the silent validity killer

If the test data was in the model's pretraining, the score measures memorization, not capability.
Contamination is **widespread**: many public benchmark datasets are demonstrably in pretraining
corpora [Contamination-Resistant Benchmarks, arXiv 2605.19999]. Defenses, in rough order of strength:

- **Fresh / held-out tasks the model can't have seen** — author new items, or use post-cutoff data
  (real issues filed after the model's training cut).
- **Private / hidden test sets** — never publish the answers or the exact items (our hidden grader;
  SWE-bench keeps a held-out split).
- **Canary strings** — embed a unique marker so you can later detect if a benchmark leaked into a corpus.
- **Rotation** — refresh items periodically so a static leak decays.
- **Contamination-resistant design** — construct items that are "unlearnable but support inference"
  [arXiv 2605.19999]; and perturb/paraphrase so surface memorization doesn't transfer.
- **Detect it** — check for memorization (e.g. the model completing a held-out item verbatim, or a
  suspiciously low loss on "unseen" data). Treat a suspiciously high score as a contamination flag
  until ruled out.

---

## 7. Blind it, and kill the biases

- **Anonymize model identity from the judge.** If the subject's output reveals which model wrote it
  (a signature phrase, or — as the SOP bench found — the artifact itself recording its generator), a
  blind judge is no longer blind. Scrub identity with a uniform mechanical pass.
- **Randomize order** to defeat position bias in pairwise judging; swap and average [arXiv 2306.05685].
- **Avoid self-preference** — don't let a model from family X be the sole judge of family X.
- **Pre-register** the rubric, the item set, and the analysis before you look at results, so you can't
  (even unconsciously) tune the grader to a preferred outcome.

---

## 8. Reproducibility & honest reporting

- **Record everything to re-run:** exact model ids/versions, full prompts, sampling params, seeds,
  grader version, dates. HELM releases **all raw prompts and completions** for re-analysis
  [arXiv 2211.09110] — the gold standard.
- **Report limitations plainly.** Item count, replicas, domains covered, known confounds, grader
  assumptions. Our own `RESULTS.md` states its limits (1 task, few replicas, operative-doctrine
  injection) — a benchmark that hides its limitations is advocacy, not measurement.
- **Recompute the headline numbers from the raw results**, never from memory of what you expected.

---

## 9. Pitfalls checklist (pin this above the desk)

- ❌ Saturation — everyone scores ~100 → task too easy; move to the frontier / under-specify.
- ❌ Contamination — public/old test data → memorization, not capability; use fresh/hidden items.
- ❌ Reward hacking — grading claims/text instead of end state → grade by execution/state.
- ❌ Prompt confound — different prompt per model → you measured the prompt; standardize.
- ❌ Single run — one score per cell → noise; add replicas + spread.
- ❌ Wrong metric — `pass@k` when you needed `pass^k` (or vice-versa).
- ❌ Judge bias — position/verbosity/self-preference unmitigated → swap, rubric, cross-family judge.
- ❌ Grader unvalidated — no good/bad reference, no mutation test → the instrument may be broken.
- ❌ Goodhart / teaching-to-the-test — optimizing the benchmark stops it measuring the real thing.
- ❌ Grand-mean blindness — averaging over a model×difficulty interaction hides the real story.

---

## 10. A concrete recipe (what `discipline-bench` does)

1. State the construct and the unit of comparison (§0).
2. Author a **discriminating** task with an objective grader; include an **under-specified** variant so
   the not-visible value shows (§1, §2).
3. **Validate the grader** on good/bad references (+ a mutation test) before trusting any score (§2.1).
4. Define conditions (stock vs +intervention) and hold prompt/tools/params constant across models (§3, §4).
5. Run **N replicas** per cell across the models under test; save every raw output (§5, §8).
6. Grade by execution; compute per-cell mean + spread; keep deltas that clear the noise band (§5).
7. Guard against contamination (fresh/hidden items) and, for judged tasks, blind + de-bias (§6, §7).
8. Report the table, the deltas, and the **limitations**, honestly (§8).

---

## References (fetched and read for this guide, via obscura)

- Contamination-resistant benchmarks — <https://arxiv.org/abs/2605.19999>
- Judging LLM-as-a-Judge (MT-Bench, Chatbot Arena; judge biases) — <https://arxiv.org/abs/2306.05685>
- SWE-bench (real-world, execution-graded agentic coding) — <https://arxiv.org/abs/2310.06770>
- τ-bench (state-based grading; `pass^k` reliability) — <https://arxiv.org/abs/2406.12045>
- HELM (holistic, multi-metric, standardized conditions) — <https://arxiv.org/abs/2211.09110>
- Codex / HumanEval (`pass@k` unbiased estimator; functional correctness) — <https://arxiv.org/abs/2107.03374>

Practical overviews surfaced in the search (not deep-read here): Evidently AI's benchmark catalogue,
BenchLM's "building a custom benchmark", Together AI and Databricks evaluation guides.

> Research note: this was gathered **with obscura** (the kit's stealth browser). Two real findings for
> the kit: (1) obscura's page-fetch of lightweight, content-rich sites (arXiv) is reliable with
> `--wait-until domcontentloaded --timeout 60`; heavy JS marketing pages can exceed the default 30s
> deadline. (2) obscura's SERP search is currently **DuckDuckGo-dependent in practice** — the Bing and
> Brave parsers are fixture-tested but return 0 against live markup, and DuckDuckGo rate-limits rapid
> queries — so multi-query research needs spacing or falls back to native search. Fixing the Bing/Brave
> live parsers (and/or wiring the optional SearXNG layer) is the concrete next hardening for
> `obscura_search`.
