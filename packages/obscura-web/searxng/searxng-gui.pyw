#!/usr/bin/env python3
# vkm · SearXNG monitor. Stdlib only (Tkinter) — no dependencies.
#
# SearXNG runs ON DEMAND: obscura_search starts it only while searching and stops it after a short
# idle, so nothing runs in the background while you do other things. This window only MONITORS it:
#   • status   — is SearXNG up right now?
#   • live feed — what the agent has searched (read from ~/.vkm/searxng/searches.log)
# Closing the window frees only the window; it never owns or holds the server.
# Launch with pythonw so no console pops up:  pythonw searxng-gui.pyw
import json
import os
import urllib.error
import urllib.request
import tkinter as tk

HOME = os.path.expanduser("~")
URL = "http://127.0.0.1:8888"
LOG = os.environ.get("OBSCURA_SEARXNG_LOG", os.path.join(HOME, ".vkm", "searxng", "searches.log"))


class Monitor:
    def __init__(self, root):
        self.root = root
        self._sig = None  # (mtime, size) of the log at last render — redraw only on change

        root.title("vkm · SearXNG")
        root.geometry("560x460")
        root.minsize(420, 320)

        top = tk.Frame(root, pady=8, padx=10)
        top.pack(fill="x")
        self.status = tk.Label(top, text="● …", font=("Segoe UI", 12, "bold"))
        self.status.pack(side="left")
        tk.Label(top, text=URL, fg="#888").pack(side="right")

        tk.Label(
            root,
            text="On-demand: el agente lo enciende al buscar y se apaga solo al terminar.",
            fg="#888",
            padx=10,
            anchor="w",
        ).pack(fill="x")
        tk.Label(
            root, text="Búsquedas (lo que ha consultado el agente):", padx=10, anchor="w"
        ).pack(fill="x", pady=(8, 0))
        self.feed = tk.Listbox(root, font=("Consolas", 9))
        self.feed.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        self._tick_status()
        self._tick_feed()

    def _ping(self):
        try:
            with urllib.request.urlopen(URL, timeout=1):
                return True
        except urllib.error.HTTPError:
            return True  # answered with an HTTP error → it's up
        except Exception:
            return False

    def _tick_status(self):
        if self._ping():
            self.status.config(text="● encendido", fg="#27ae60")
        else:
            self.status.config(text="● apagado (on-demand)", fg="#c0392b")
        self.root.after(1500, self._tick_status)

    def _tick_feed(self):
        try:
            st = os.stat(LOG)
            sig = (st.st_mtime, st.st_size)
        except OSError:
            sig = None
        if sig != self._sig:
            self._sig = sig
            self._render_feed()
        self.root.after(1000, self._tick_feed)

    def _render_feed(self):
        rows = []
        try:
            with open(LOG, encoding="utf-8") as f:
                lines = [ln for ln in f if ln.strip()][-300:]
        except OSError:
            lines = []
        for ln in lines:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            t = str(e.get("ts", ""))[11:19]
            rows.append(f"{t}  {e.get('query', '')}   ({e.get('source', '?')} · {e.get('count', '?')})")
        self.feed.delete(0, "end")
        for r in reversed(rows):  # newest first
            self.feed.insert("end", r)


def main():
    root = tk.Tk()
    Monitor(root)
    root.mainloop()


if __name__ == "__main__":
    main()
