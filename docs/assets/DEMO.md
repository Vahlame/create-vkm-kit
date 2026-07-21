# Demo asset (30 s) — recording recipe

The single highest-converting asset for launch is a ~30 s screen capture that
tells the memory story end to end:

1. Run `npx @vkmikc/create-vkm-kit -y` in a fresh terminal.
2. Open an agent chat, tell it a fact ("my deploy target is fly.io").
3. **Close the chat.** Open a brand-new one.
4. Ask "where do I deploy?" → the agent recalls it from the vault.

That "close chat → open another → it remembers" beat is what sells the kit;
the README explains, the clip proves.

## How to record

**Option A — GIF (autoplays inline on GitHub):**

```bash
# terminalizer (npm) or asciinema + agg both work; terminalizer gives a GIF directly
npx terminalizer record demo         # drive the flow above, Ctrl+D to stop
npx terminalizer render demo -o docs/assets/demo.gif
```

Keep it ≤ 6 MB so GitHub inlines it. Trim dead air; 24–30 s is the target.

**Option B — asciinema (crisper text, needs a player link):**

```bash
asciinema rec docs/assets/demo.cast   # drive the flow, Ctrl+D to stop
# then either upload to asciinema.org and link the SVG badge,
# or render a GIF locally:  agg docs/assets/demo.cast docs/assets/demo.gif
```

## Where it goes

Both `README.md` and `README.en.md` carry an HTML anchor comment
`<!-- DEMO: drop docs/assets/demo.gif here once recorded -->` right under the
tagline. Replace that line in **both** files with:

```html
<p align="center">
  <img
    src="docs/assets/demo.gif"
    alt="npx install, then a new chat recalls a fact from the vault"
    width="760"
  />
</p>
```

Do not commit a broken `demo.gif` reference before the file exists — that is
why this is an anchor comment, not a live `<img>`.
