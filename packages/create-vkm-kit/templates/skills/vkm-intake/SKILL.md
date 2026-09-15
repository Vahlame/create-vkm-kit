---
name: vkm-intake
description: 'Optional scope checklist for ambiguous multi-step tasks — 3-line restatement, one closed question max, image inventory. Skip trivial or already-scoped work. Invoke when needed; never a session-start ritual.'
user-invocable: true
---

# vkm-intake — read the task right, then do only that

Installed by create-vkm-kit (vkm-kit). One job: **kill the three cheapest ways a session wastes
tokens and quality — misreading the prompt, misreading the attachments, and over-assembling
context** — by spending ~10 lines before the first tool call instead of thousands after it.

## Guía, no mandato

**Opcional.** En tareas triviales o ya acotadas, salta esta skill entera. En tareas ambiguas, el
restate de 3 líneas suele pagarse solo. Ver [`_GUIDANCE.md`](../_GUIDANCE.md).

## Checklist sugerido (antes del primer tool call, si aplica)

1. **Restate in ≤3 lines**: Objective / Deliverable / Not doing — shown to the user. A trivial task restates in one line and skips the rest.
2. **Ambiguity gate**: two readings that change the deliverable → ONE closed question, stop until answered; readings differ only in detail → name the default in one line, proceed.
3. **Images**: inventory what is actually visible before interpreting — verbatim only the text the task turns on, mark illegible as illegible, never guess.
4. **Minimal context**: one `assemble_context` call, or `vault_hybrid_search` (limit 3–5); stop assembling the moment you can act. Read the files the restatement names, not the neighborhood.
5. **Execute exactly the restated scope**; if the restatement was wrong, fix it in one line and continue — silently drifting is the failure.

DeepSeek Flash: one pass, no narrated reasoning; the 3-line restatement is the fence — stay inside it.

---

## The move — before the first tool call

**1. Restate the task in ≤3 lines** (this is the contract for the rest of the session):

```text
Objective:    <what changes in the world when this is done — not the steps>
Deliverable:  <the artifact the user receives: file, diff, answer, decision>
Not doing:    <the adjacent things this task does NOT include>
```

Write it to the user verbatim. If the task is genuinely trivial (one obvious edit), the
restatement IS one line and you skip the rest of this skill.

**2. Ambiguity gate — one closed question, or a stated default.** If two readings of the
prompt produce _different deliverables_, ask ONE closed question (options, not an essay) and
stop until answered. If the readings differ only in detail, pick the most reasonable default,
**name it in one line** ("Assuming X; say so if not"), and proceed. Never ask about things the
codebase or the vault can answer — look them up.

**3. Images and screenshots: inventory before interpreting.** When the prompt includes an
image, list what is _actually visible_ before drawing any conclusion: the elements, verbatim
only the text the task turns on (error messages, labels the user points at — mark illegible
text as illegible, never guess it; summarize the rest by element), the state shown (error?
empty? hover?), and what the user is pointing at. The inventory stays inside the ~10-line
intake budget. Interpretation comes only from that inventory. A
screenshot of a UI bug names the _symptom_; the inventory keeps you from fixing a different
one.

**4. Contexto mínimo (solo si hace falta).** Lee los archivos que el restatement nombra — no el
vecindario. Si la tarea nombra proyecto/historial previo y el vault está cableado, **puede**
ayudar un `vault_hybrid_search` (limit 3–5) o `assemble_context` — no es ritual de arranque.
Verifica paths/flags antes de construir sobre ellos. Para en cuanto puedas actuar.

**5. Ejecuta el scope restated.** Si el restatement estaba mal, corrígelo en una línea y sigue.
Código no trivial: **puedes** usar `vkm-discipline` como checklist de cierre — no es obligatorio
pasar por ahí si ya tienes evidencia clara.

## Anti-patterns this skill exists to stop

- Restating the task as a plan of 12 steps. The restatement is 3 lines; plans come later if
  the task is genuinely large.
- "While I'm here" edits outside the fence — improvements the user didn't ask for cost tokens
  and review time, and are where regressions hide.
- Leer `SESSION_LOG`/PROJECTS enteros "por fondo" cuando el restatement no los nombra.
- Asking an open question ("what do you want me to do?") when a closed one ("A or B?") — or a
  stated default — would unblock immediately.
- Trusting a remembered file path, flag, or API without checking it still exists.

## Cheap by construction

The whole intake costs ~10 output lines and 0–1 extra turns. Its value is the multiplier on
everything after it: a wrong deliverable caught at line 3 costs 3 lines; caught after the
implementation, it costs the implementation.
