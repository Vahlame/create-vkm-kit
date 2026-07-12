# Local SearXNG for `obscura_search` (structured, fast, relevant search)

`obscura_search` scrapes SERPs by default, and free scraping can't be fast + high-volume + relevant at
once (see `../src/serp.mjs`). A local **SearXNG** instance fixes that: it aggregates many engines and
returns **structured JSON** with no anti-bot wall. Point obscura at it with `OBSCURA_SEARXNG_URL` and
`searchWeb` uses it first (`source: "searxng"`).

## Set it up on Windows (no Docker — the exact steps this kit used)

SearXNG isn't officially Windows-native, but it runs locally with one small shim. With Docker or WSL,
prefer the official image; on bare Windows + Python 3.11+:

```powershell
# 1. Clone + venv  (longpaths: SearXNG has deep / colon-named deploy templates)
git config --global core.longpaths true
git clone --depth 1 https://github.com/searxng/searxng.git $HOME\.vkm\searxng-src
python -m venv $HOME\.vkm\searxng-venv
$py = "$HOME\.vkm\searxng-venv\Scripts\python.exe"

# 2. Deps
& $py -m pip install --upgrade pip wheel setuptools
& $py -m pip install -r $HOME\.vkm\searxng-src\requirements.txt

# 3. Windows shim: `pwd` is POSIX-only but SearXNG imports it. Drop the stub on the import path.
Copy-Item .\pwd_shim.py "$HOME\.vkm\searxng-venv\Lib\site-packages\pwd.py"

# 4. Config: copy the template, set a real secret_key, keep `formats: [html, json]`.
New-Item -ItemType Directory -Force $HOME\.vkm\searxng | Out-Null
Copy-Item .\settings.template.yml $HOME\.vkm\searxng\settings.yml
#   then set secret_key:  python -c "import secrets; print(secrets.token_hex(32))"

# 5. Run  (or use start.ps1)
$env:SEARXNG_SETTINGS_PATH = "$HOME\.vkm\searxng\settings.yml"
Set-Location $HOME\.vkm\searxng-src
& $py -m searx.webapp        # serves http://127.0.0.1:8888
```

The `checkout failed` warning on clone is only 4 deploy-template files whose names contain `:` (illegal
on Windows) — harmless; the app runs without them.

## Wire it into obscura

- One-off: set `OBSCURA_SEARXNG_URL=http://127.0.0.1:8888` in the environment.
- Kit install: `npx @vkmikc/create-vkm-kit --obscura --searxng-url http://127.0.0.1:8888` wires it into
  the obscura-web MCP's env.

Verified: `obscura_search` via SearXNG returns aggregated, relevant results where raw scraping failed —
e.g. "SWE-bench software engineering benchmark" → swebench.com / the SWE-bench GitHub / leaderboards
(bing-rss returned package-tracking for the same query); 4 technical queries in ~7s, no rate-limiting.

## Desktop app: on/off + live search monitor

`searxng-gui.pyw` is a tiny Tkinter app (stdlib only, no deps) to run SearXNG from the desktop:

- **On/off** button that starts/stops the local SearXNG process and shows its status.
- **Live feed** of the queries flowing through SearXNG (parsed from its request log) — see, in real
  time, exactly what the agent is searching.
- A **search box** to try a query yourself and read the top results.

Install (copy it next to the config and drop a Desktop shortcut):

```powershell
Copy-Item .\searxng-gui.pyw $HOME\.vkm\searxng\searxng-gui.pyw
$pyw = (Get-Command pythonw.exe).Source
$sc  = (New-Object -ComObject WScript.Shell).CreateShortcut(
         (Join-Path ([Environment]::GetFolderPath('Desktop')) 'vkm SearXNG.lnk'))
$sc.TargetPath = $pyw
$sc.Arguments  = '"' + "$HOME\.vkm\searxng\searxng-gui.pyw" + '"'
$sc.WorkingDirectory = "$HOME\.vkm\searxng"
$sc.Save()
```

Then double-click **vkm SearXNG** on the Desktop. Needs the system Python with Tkinter (the python.org
installer includes it); it launches the venv Python for the server itself.

## Notes

- `limiter: false` avoids needing valkey/redis for a private localhost instance.
- `formats: [html, json]` is **required** — SearXNG ships with the JSON API off.
- Bind to localhost only; never expose a personal instance.
- The Flask dev server is fine for one local user; for anything heavier use Docker/WSL + a real WSGI server.
