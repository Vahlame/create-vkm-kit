/* vkm-console dashboard. Renders /api/snapshot and live-updates via SSE.
   Self-contained: no external assets, CSP default-src 'self'. Bilingual:
   Spanish by default, English via ?lang=en (labels carry data-en). */
/* global document, window, EventSource */
(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const lang = params.get("lang") === "en" ? "en" : "es";
  const L = (es, en) => (lang === "en" ? en : es);

  // Per-run auth token from the URL the server printed/opened: every route
  // except /api/health rejects requests without it, so it must ride along on
  // fetch and EventSource URLs (and survive the language toggle).
  const token = params.get("token") || "";
  const withToken = (url) =>
    token ? url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) : url;

  if (lang === "en") {
    for (const el of document.querySelectorAll("[data-en]")) {
      el.textContent = el.getAttribute("data-en");
    }
    document.documentElement.lang = "en";
  }
  const toggle = document.getElementById("lang-toggle");
  const toggleParams = new URLSearchParams(window.location.search);
  toggleParams.set("lang", lang === "en" ? "es" : "en");
  toggle.href = "?" + toggleParams.toString();
  toggle.textContent = lang === "en" ? "ES" : "EN";

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat(lang === "en" ? "en" : "es", {
    notation: "compact",
    maximumFractionDigits: 1
  });

  // Text updates go through setText so unchanged values cause zero DOM churn
  // (no layout jumps).
  function setText(id, text) {
    const el = $(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setDot(id, state) {
    const dot = $(id).querySelector(".dot");
    const cls = "dot " + state;
    if (dot.className !== cls) dot.className = cls;
  }

  function setError(id, src) {
    const el = $(id);
    if (src && !src.ok && src.error) {
      if (el.textContent !== src.error) el.textContent = src.error;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  function ago(iso) {
    if (!iso) return L("nunca", "never");
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }

  function fmtSize(b) {
    if (b >= 1 << 30) return (b / (1 << 30)).toFixed(1) + " GB";
    if (b >= 1 << 20) return (b / (1 << 20)).toFixed(1) + " MB";
    if (b >= 1024) return Math.round(b / 1024) + " KB";
    return b + " B";
  }

  function li(left, right) {
    const item = document.createElement("li");
    const l = document.createElement("span");
    l.className = "l";
    l.textContent = left;
    l.title = left;
    const r = document.createElement("span");
    r.className = "r";
    r.textContent = right;
    item.append(l, r);
    return item;
  }

  function renderBars(containerId, rows) {
    const max = rows.reduce((m, row) => Math.max(m, row.value), 0) || 1;
    const frag = document.createDocumentFragment();
    for (const row of rows) {
      const el = document.createElement("div");
      el.className = "bar-row";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = row.name;
      name.title = row.name;
      const track = document.createElement("div");
      track.className = "track";
      const fill = document.createElement("div");
      fill.className = "fill";
      fill.style.width = Math.max(2, (row.value / max) * 100) + "%";
      track.append(fill);
      const val = document.createElement("span");
      val.className = "val";
      val.textContent = row.label;
      el.append(name, track, val);
      frag.append(el);
    }
    $(containerId).replaceChildren(frag);
  }

  // --- Daemon card -------------------------------------------------------

  function renderDaemon(d) {
    const age = typeof d.heartbeatAgeSec === "number" ? d.heartbeatAgeSec : -1;
    const fill = $("d-gauge");
    let cls = "gauge-fill";
    let pct = 100;
    if (!d.ok || age < 0) {
      cls += " off";
    } else {
      pct = Math.max(6, 100 - Math.min(age, 600) / 6);
      if (age > 600) cls += " bad";
      else if (age > 120) cls += " warn";
    }
    if (fill.className !== cls) fill.className = cls;
    fill.style.width = pct + "%";
    setText("d-age", !d.ok ? "off" : age < 0 ? L("nunca", "never") : age + "s");
    setText("d-lastpush", d.lastPush ? ago(d.lastPush) : L("nunca", "never"));
    setText("d-failures", String(d.consecutivePushFailures || 0));
    setText("d-rebase", d.lastRebaseAbort ? ago(d.lastRebaseAbort) : "–");
    setText("d-syncerr", d.lastSyncError || "–");
    setError("d-error", d);
  }

  // --- Memory card -------------------------------------------------------

  function renderMemory(v) {
    setText("m-total", v.ok ? nf.format(v.totalNotes || 0) : "–");
    const folders = (v.folders || []).slice(0, 8);
    renderBars(
      "m-folders",
      folders.map((f) => ({
        name: f.name === "." ? L("(raíz)", "(root)") : f.name,
        value: f.count,
        label: String(f.count)
      }))
    );
    const recent = document.createDocumentFragment();
    for (const n of v.recent || []) recent.append(li(n.path, ago(n.mtime)));
    $("m-recent").replaceChildren(recent);
    // textContent — never innerHTML: SESSION_LOG is untrusted vault data.
    const tail = $("m-tail");
    const frag = document.createDocumentFragment();
    for (const line of v.sessionLogTail || []) {
      const d = document.createElement("div");
      d.textContent = line;
      frag.append(d);
    }
    tail.replaceChildren(frag);
    setError("m-error", v);
  }

  // --- Postgres card -----------------------------------------------------

  // Activity dedupe: timeline ids are per-database bigserial sequences that
  // restart at 1 after a projection rebuild and collide across services, so
  // keys are namespaced by service slug and the set resets whenever the
  // displayed service changes. FIFO-capped so a long-lived page cannot grow
  // the set without bound (Sets iterate in insertion order).
  const seenActivity = new Set();
  const SEEN_ACTIVITY_MAX = 2000;
  let activitySlug = null;
  let lastGraphSig = "";

  function renderPg(pg) {
    const services = pg && Array.isArray(pg.services) ? pg.services : [];
    const svc = services.find((s) => s.status === "running") || services[0] || null;
    const badge = $("p-badge");
    let health = null;
    if (svc && svc.status === "running" && svc.health) {
      health = svc.health;
      badge.textContent = health.backend || "running";
      badge.className = "badge on";
    } else if (svc) {
      badge.textContent =
        svc.status === "starting" ? L("arrancando", "starting") : L("detenido", "stopped");
      badge.className = "badge warn";
    } else {
      badge.textContent = "off";
      badge.className = "badge off";
    }
    setText("p-notes", health ? nf.format(health.notes || 0) : "–");
    setText("p-chunks", health ? nf.format(health.chunks || 0) : "–");
    setText("p-relations", health ? nf.format(health.relations || 0) : "–");
    setText("p-observations", health ? nf.format(health.observations || 0) : "–");
    setText("p-lastsync", health && health.lastSyncAt ? ago(health.lastSyncAt) : "–");
    const start = $("p-start");
    if (svc && svc.startCommand) {
      setText("p-startcmd", svc.startCommand);
      start.classList.remove("hidden");
    } else {
      start.classList.add("hidden");
    }
    const list = $("p-activity");
    const slug = svc && svc.slug ? svc.slug : "";
    if (slug !== activitySlug) {
      activitySlug = slug;
      seenActivity.clear();
      list.replaceChildren();
    }
    const events =
      svc && svc.timeline && Array.isArray(svc.timeline.events) ? svc.timeline.events : [];
    const sorted = events.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
    for (const ev of sorted) {
      if (ev.id === undefined) continue;
      const key = slug + ":" + ev.id;
      if (seenActivity.has(key)) continue;
      seenActivity.add(key);
      while (seenActivity.size > SEEN_ACTIVITY_MAX) {
        seenActivity.delete(seenActivity.values().next().value);
      }
      list.prepend(li((ev.kind || "?") + " " + (ev.path || ""), ago(ev.at)));
    }
    while (list.children.length > 15) list.removeChild(list.lastChild);
    renderGraph(svc ? svc.graph : null);
    setError("p-error", pg);
  }

  function renderGraph(graph) {
    const canvas = $("p-graph");
    const nodes = (graph && Array.isArray(graph.nodes) ? graph.nodes : []).slice(0, 150);
    const byPath = new Set(nodes.map((n) => n.path));
    const edges = (graph && Array.isArray(graph.edges) ? graph.edges : []).filter(
      (e) => byPath.has(e.source) && byPath.has(e.target)
    );
    // Content-based signature: counts alone would miss a rename or rewired
    // edges that happen to preserve the node and edge totals.
    const sig =
      nodes.map((n) => n.path).join("|") +
      "#" +
      edges.map((e) => e.source + ">" + e.target).join("|");
    if (sig === lastGraphSig) return; // unchanged graph: no redraw, no flicker
    lastGraphSig = sig;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = 200;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!nodes.length) {
      ctx.fillStyle = "#4a5262";
      ctx.font = "12px system-ui";
      ctx.fillText(L("sin datos de grafo", "no graph data"), 12, 20);
      return;
    }
    const idx = new Map(nodes.map((n, i) => [n.path, i]));
    const links = [];
    for (const e of edges) {
      const a = idx.get(e.source);
      const b = idx.get(e.target);
      if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
    }
    const pos = layoutGraph(nodes.length, links);
    const deg = new Array(nodes.length).fill(0);
    for (const [a, b] of links) {
      deg[a] += 1;
      deg[b] += 1;
    }
    ctx.strokeStyle = "rgba(90, 200, 250, 0.25)";
    ctx.lineWidth = 1;
    for (const [a, b] of links) {
      ctx.beginPath();
      ctx.moveTo(pos.x[a] * w, pos.y[a] * h);
      ctx.lineTo(pos.x[b] * w, pos.y[b] * h);
      ctx.stroke();
    }
    for (let i = 0; i < nodes.length; i++) {
      ctx.beginPath();
      ctx.fillStyle = deg[i] > 2 ? "#5ac8fa" : "#7a86a0";
      ctx.arc(pos.x[i] * w, pos.y[i] * h, Math.min(5, 2 + deg[i] * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Tiny deterministic force layout (no d3): golden-angle spiral init, O(n²)
  // repulsion, springs along links, centering gravity. Coordinates in [0,1].
  function layoutGraph(n, links) {
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const vx = new Float64Array(n);
    const vy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963;
      const r = 0.08 + 0.4 * Math.sqrt((i + 0.5) / n);
      x[i] = 0.5 + r * Math.cos(a);
      y[i] = 0.5 + r * Math.sin(a);
    }
    for (let iter = 0; iter < 150; iter++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = x[i] - x[j];
          let dy = y[i] - y[j];
          const d2 = dx * dx + dy * dy + 1e-4;
          const f = 0.0006 / d2;
          dx *= f;
          dy *= f;
          vx[i] += dx;
          vy[i] += dy;
          vx[j] -= dx;
          vy[j] -= dy;
        }
      }
      for (const [a, b] of links) {
        const dx = x[b] - x[a];
        const dy = y[b] - y[a];
        const d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
        const f = (0.02 * (d - 0.12)) / d;
        vx[a] += dx * f;
        vy[a] += dy * f;
        vx[b] -= dx * f;
        vy[b] -= dy * f;
      }
      for (let i = 0; i < n; i++) {
        vx[i] += (0.5 - x[i]) * 0.02;
        vy[i] += (0.5 - y[i]) * 0.02;
        x[i] += Math.max(-0.04, Math.min(0.04, vx[i]));
        y[i] += Math.max(-0.04, Math.min(0.04, vy[i]));
        vx[i] *= 0.5;
        vy[i] *= 0.5;
        x[i] = Math.max(0.03, Math.min(0.97, x[i]));
        y[i] = Math.max(0.05, Math.min(0.95, y[i]));
      }
    }
    return { x, y };
  }

  // --- Tokens card -------------------------------------------------------

  function renderTokens(t) {
    const days = (t.days || []).slice(-7);
    renderBars(
      "t-bars",
      days.map((d) => ({ name: d.day.slice(5), value: d.tokens, label: nf.format(d.tokens) }))
    );
    const ratio = typeof t.cacheHitRatio === "number" ? t.cacheHitRatio : -1;
    setText("t-cache", ratio >= 0 ? (ratio * 100).toFixed(1) + "%" : "–");
    $("t-cache-fill").style.width = (ratio >= 0 ? ratio * 100 : 0) + "%";
    const models = document.createDocumentFragment();
    for (const m of t.models || []) models.append(li(m.model, nf.format(m.tokens)));
    $("t-models").replaceChildren(models);
    setError("t-error", t);
  }

  // --- Research card -----------------------------------------------------

  function renderResearch(r) {
    const searches = document.createDocumentFragment();
    for (const s of r.searches || []) {
      searches.append(li(s.query, ago(s.ts) + " · " + (s.source || "?")));
    }
    $("r-searches").replaceChildren(searches);
    const dls = document.createDocumentFragment();
    for (const d of r.downloads || []) dls.append(li(d.name, fmtSize(d.sizeB || 0)));
    $("r-downloads").replaceChildren(dls);
    setError("r-error", r);
  }

  // --- Top-level render + status strip -----------------------------------

  function render(snap) {
    setText("hdr-version", "v" + (snap.version || "?"));
    setText("hdr-vault", snap.vault || L("(sin vault)", "(no vault)"));
    renderDaemon(snap.daemon || {});
    renderMemory(snap.vaultStats || {});
    renderPg(snap.pg || {});
    renderTokens(snap.telemetry || {});
    renderResearch(snap.research || {});
    setDot("st-daemon", snap.daemon && snap.daemon.ok ? "on" : "off");
    setDot("st-vault", snap.vaultStats && snap.vaultStats.ok ? "on" : "off");
    const services = snap.pg && snap.pg.services ? snap.pg.services : [];
    const pgState = services.some((s) => s.status === "running")
      ? "on"
      : services.length
        ? "warn"
        : "off";
    setDot("st-pg", pgState);
    setDot("st-tel", snap.telemetry && snap.telemetry.ok ? "on" : "off");
    setDot("st-research", snap.research && snap.research.ok ? "on" : "off");
    setText("st-updated", new Date().toLocaleTimeString(lang === "en" ? "en" : "es"));
  }

  // --- SSE with reconnect backoff ----------------------------------------

  let retryDelay = 1000;

  function setConn(state) {
    const dot = $("conn-dot");
    const cls = "dot " + (state === "live" ? "on" : "warn");
    if (dot.className !== cls) dot.className = cls;
    setText(
      "conn-label",
      state === "live" ? L("en vivo", "live") : L("reconectando", "reconnecting")
    );
  }

  function connect() {
    const es = new EventSource(withToken("/api/events"));
    const onSnap = (ev) => {
      try {
        render(JSON.parse(ev.data));
      } catch (_e) {
        // a malformed frame is dropped, never fatal
      }
    };
    es.addEventListener("open", () => {
      retryDelay = 1000;
      setConn("live");
    });
    es.addEventListener("snapshot", onSnap);
    es.addEventListener("change", onSnap);
    es.addEventListener("error", () => {
      es.close();
      setConn("down");
      window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    });
  }

  fetch(withToken("/api/snapshot"))
    .then((res) => res.json())
    .then(render)
    .catch(() => {
      // initial paint comes from the first SSE snapshot instead
    });
  connect();
})();
