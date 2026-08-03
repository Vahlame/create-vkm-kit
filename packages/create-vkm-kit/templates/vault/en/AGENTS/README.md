---
type: index
tags: [agents]
---

# AGENTS — per-agent memory

One note per agent (`AGENTS/<agent-name>.md`), carrying the same structures as the rest of
the vault: frontmatter, typed relations and `[category]` observations. It is the mirror of
`PROJECTS/<project>.md` for agents — verdicts, lessons and limits that outlive the
session — without fragmenting the memory into separate vaults (ADR-0086).

- Create an agent's note by copying [[AGENTS/TEMPLATE|TEMPLATE]].
- Scoped recall: pass `scope: "AGENTS/<agent-name>"` to search (`scope: "AGENTS"` covers
  every agent). The filter is a relative path prefix, case-sensitive, matched at segment
  boundary, applied after the `section` filter.
- Link every new note from here or from [[_meta/agent-profiles]] so the graph (and
  recall) can reach it.
