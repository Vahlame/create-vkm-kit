#!/usr/bin/env python3
# vkm · SearXNG control + live search monitor. Stdlib only (Tkinter) — no dependencies.
#
# On/off for the local SearXNG (the structured backend obscura_search uses) plus a live feed of the
# queries flowing through it (parsed from SearXNG's request log) and a box to try a search yourself.
# Launch with pythonw so no console pops up:  pythonw searxng-gui.pyw
import json
import os
import queue
import re
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
import tkinter as tk
from tkinter import ttk, scrolledtext

HOME = os.path.expanduser("~")
VENV_PY = os.path.join(HOME, ".vkm", "searxng-venv", "Scripts", "python.exe")
SRC = os.path.join(HOME, ".vkm", "searxng-src")
SETTINGS = os.path.join(HOME, ".vkm", "searxng", "settings.yml")
URL = "http://127.0.0.1:8888"
# werkzeug logs each request as: 127.0.0.1 - - [..] "GET /search?q=... HTTP/1.1" 200 -
SEARCH_RE = re.compile(r'"(?:GET|POST) /search\??([^ "]*)')


class App:
    def __init__(self, root):
        self.root = root
        self.proc = None
        self.log_q = queue.Queue()

        root.title("vkm · SearXNG")
        root.geometry("580x540")
        root.minsize(460, 420)

        top = tk.Frame(root, pady=8, padx=10)
        top.pack(fill="x")
        self.status = tk.Label(top, text="● detenido", fg="#c0392b", font=("Segoe UI", 12, "bold"))
        self.status.pack(side="left")
        self.btn = tk.Button(top, text="Encender", width=10, command=self.toggle)
        self.btn.pack(side="right")
        tk.Label(top, text=URL, fg="#888").pack(side="right", padx=10)

        srow = tk.Frame(root, padx=10)
        srow.pack(fill="x")
        self.entry = ttk.Entry(srow)
        self.entry.pack(side="left", fill="x", expand=True)
        self.entry.bind("<Return>", lambda e: self.do_search())
        tk.Button(srow, text="Buscar", command=self.do_search).pack(side="left", padx=4)

        tk.Label(root, text="Búsquedas en vivo (lo que consulta el agente):", padx=10, anchor="w").pack(
            fill="x", pady=(8, 0)
        )
        self.feed = tk.Listbox(root, height=9, font=("Consolas", 9))
        self.feed.pack(fill="both", expand=False, padx=10)

        tk.Label(root, text="Resultados de tu búsqueda:", padx=10, anchor="w").pack(fill="x", pady=(8, 0))
        self.results = scrolledtext.ScrolledText(root, height=10, font=("Consolas", 9), wrap="word")
        self.results.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(300, self._drain_log)
        self.root.after(500, self._refresh_status)

    # ── server control ──────────────────────────────────────────────────────
    def toggle(self):
        if self._alive():
            self.stop()
        else:
            self.start()

    def start(self):
        if self._ping():
            self._feed_msg("[i] ya hay un SearXNG escuchando en 8888 (arrancado por fuera)")
            return
        if not os.path.exists(VENV_PY):
            self._feed_msg("[error] falta el venv en ~/.vkm/searxng-venv — ver README de setup")
            return
        env = dict(os.environ, SEARXNG_SETTINGS_PATH=SETTINGS)
        try:
            self.proc = subprocess.Popen(
                [VENV_PY, "-m", "searx.webapp"],
                cwd=SRC,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception as e:  # noqa: BLE001 — surface any launch failure to the user
            self._feed_msg(f"[error] no pude arrancar: {e}")
            return
        threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
        self._feed_msg("[on] SearXNG arrancando…")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
            except Exception:
                pass
        self.proc = None
        self._feed_msg("[off] SearXNG detenido")

    def _reader(self, proc):
        for line in iter(proc.stdout.readline, ""):
            self.log_q.put(line.rstrip())
        self.log_q.put("[exit] el proceso de SearXNG terminó")

    def _alive(self):
        return self.proc is not None and self.proc.poll() is None

    def _ping(self):
        try:
            with urllib.request.urlopen(URL, timeout=1):
                return True
        except urllib.error.HTTPError:
            return True  # answered with an HTTP error → it's up
        except Exception:
            return False

    # ── live feed + status ──────────────────────────────────────────────────
    def _drain_log(self):
        try:
            while True:
                line = self.log_q.get_nowait()
                if line.startswith(("[on]", "[off]", "[error]", "[i]", "[exit]")):
                    self._feed_msg(line)
                    continue
                m = SEARCH_RE.search(line)
                if m:
                    qs = urllib.parse.parse_qs(m.group(1))
                    q = (qs.get("q") or [""])[0].strip()
                    if q:
                        self._feed_msg(f"{datetime.now():%H:%M:%S}  {q}")
        except queue.Empty:
            pass
        self.root.after(300, self._drain_log)

    def _feed_msg(self, text):
        self.feed.insert(0, text)
        if self.feed.size() > 300:
            self.feed.delete(300, "end")

    def _refresh_status(self):
        up = self._alive() or self._ping()
        if up:
            self.status.config(text="● encendido", fg="#27ae60")
            self.btn.config(text="Apagar")
        else:
            self.status.config(text="● detenido", fg="#c0392b")
            self.btn.config(text="Encender")
        self.root.after(1500, self._refresh_status)

    # ── manual search ─────────────────────────────────────────────────────────
    def do_search(self):
        q = self.entry.get().strip()
        if not q:
            return
        self.results.delete("1.0", "end")
        self.results.insert("end", f"Buscando: {q}\n\n")
        threading.Thread(target=self._search_thread, args=(q,), daemon=True).start()

    def _search_thread(self, q):
        url = URL + "/search?" + urllib.parse.urlencode({"q": q, "format": "json"})
        try:
            req = urllib.request.Request(
                url, headers={"X-Forwarded-For": "127.0.0.1", "Accept": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=25) as r:
                data = json.load(r)
        except Exception as e:  # noqa: BLE001
            self.root.after(
                0, lambda: self.results.insert("end", f"[error] {e}\n(¿está encendido SearXNG?)")
            )
            return
        lines = []
        for item in data.get("results", [])[:10]:
            lines.append(
                f"• {item.get('title', '')}\n  {item.get('url', '')}\n  {(item.get('content') or '')[:160]}\n"
            )
        text = "\n".join(lines) or "(sin resultados)"
        self.root.after(0, lambda: self.results.insert("end", text))

    def on_close(self):
        self.stop()
        self.root.destroy()


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
