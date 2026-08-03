---
type: agent
status: active
agent: <agent-name>
model: <model>
tags: [agent, template]
---

# AGENT — <agent-name>

The agent's own memory: what it can be trusted with, where it stumbles, which rules apply.
Scoped recall: `scope: "AGENTS/<agent-name>"`.

## Verdicts

- [decision] YYYY-MM-DD · <what to delegate to it / what not, and why> #delegation
- [fact] <verified capability or limit of the agent> #agent

## Lessons

- [gotcha] <repeatable failure + the condition that triggers it> #tech
- [fact] <what worked and is worth repeating> #agent

## Related

- part_of [[_meta/agent-profiles]]
- relates_to [[PROJECTS/<project>]]
