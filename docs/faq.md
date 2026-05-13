# FAQ

## Questions

### Why not use Cursor's built-in "memories" feature?

Cursor's built-in memories are tied to Cursor's account and storage, are not portable, and you cannot read or edit them outside Cursor. This pattern gives you a Markdown vault you own, in a private GitHub repo, that you can read or edit in any editor, sync across machines, and grep with normal tools. See `docs/comparison.md` for the full comparison.

### Is this safe to paste into Cursor?

The prompt instructs an agent to execute code on your Windows machine: install npm packages, write files in `%USERPROFILE%`, create scheduled tasks, and push to a Git repo you own. Treat the prompt the same way you would treat any system installer: pin to a release tag, read the diff between tags, and verify the source URL. `SECURITY.md` covers reporting.

### What does it cost?

Nothing. You pay for whatever Cursor plan you already have, plus a private GitHub repository (free on personal accounts).

### Will it work without internet?

Local memory works. Sync to GitHub does not. The watchdog will keep the local MCP server up; the autosync task will simply fail until connectivity is back and will catch up on the next 10-minute cycle.

### Why a private repo?

Your memory may include client names, internal architectures, half-formed ideas, and links you do not want public. A private repo is the default safety setting.

### Can multiple machines write at the same time?

Yes, with caveats. The autosync uses `git pull --rebase`, which handles non-overlapping edits correctly. If two machines edit the same line of `MEMORY.md` within a 10-minute window, you will get a Git conflict on the next sync. The task will fail and the conflict will appear in `git status` for you to resolve manually. This is rare in practice because the agent appends rather than overwrites.

### Does it slow Cursor down?

No measurable slowdown. The MCP server runs out of process. The agent's calls to it are LAN-fast (loopback).

### Can I rename `MEMORY.md` or `SESSION_LOG.md`?

You can, but you would have to change the User Rules in section 9 of the prompt accordingly. The names are convention, not protocol.

### How do I uninstall?

`docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md` section 8 includes `Uninstall-Cursor-Memory.ps1`. It removes the scheduled tasks, restores `mcp.json.bak`, and leaves your vault untouched. To also delete the vault, do that manually so the deletion is intentional.

### Why Windows-first?

The maintainer's machine. See ADR-0007 for the full reasoning and the plan for macOS / Linux variants.

### Will this work on Cursor Web / cursor.com?

No. The pattern relies on a local MCP server bound to `127.0.0.1:3001`. Cursor's web interface cannot reach localhost on your machine.

### Will this work with Claude Desktop, Continue, or other MCP-capable clients?

In principle yes. They consume the same MCP server. You would have to translate the User Rules (section 9) and the `mcp.json` block (section 6.4) to that client's equivalent config. The vault and scripts are unchanged.

### How big can the vault get before it's a problem?

In practice multiple hundreds of MB are fine. The autosync only pushes the diff. Reading `MEMORY.md` is bounded by the model's context, not by the vault size, because the agent reads only the files it needs.

### Can I share `MEMORY.md` with a teammate?

Yes. Invite them to the private repo. They run the same prompt once on their machine and now both of you read and write the same memory. Conflicts behave as in the multi-machine question above.

### How do I update to a new version of the prompt?

Pull the latest tag in this repo, re-paste the prompt into a new Cursor chat with the same `<REPO_URL_PRIVADO>`. The setup is idempotent; only the scripts and `mcp.json` entry get refreshed. Your vault is untouched.
