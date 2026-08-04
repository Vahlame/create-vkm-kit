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
    for (const el of document.querySelectorAll("[data-en-placeholder]")) {
      el.placeholder = el.getAttribute("data-en-placeholder");
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
    graphExplorer.setGraph(svc ? svc.graph : null);
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
      ctx.fillStyle = "#6b7c88";
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
    ctx.strokeStyle = "rgba(14, 116, 144, 0.28)";
    ctx.lineWidth = 1;
    for (const [a, b] of links) {
      ctx.beginPath();
      ctx.moveTo(pos.x[a] * w, pos.y[a] * h);
      ctx.lineTo(pos.x[b] * w, pos.y[b] * h);
      ctx.stroke();
    }
    for (let i = 0; i < nodes.length; i++) {
      ctx.beginPath();
      ctx.fillStyle = deg[i] > 2 ? "#0e7490" : "#7a8f9c";
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

  // --- Fullscreen interactive graph (Obsidian-style pan/zoom/drag) -------

  const GE_MAX_NODES = 500;
  const graphExplorer = (() => {
    const root = $("graph-explorer");
    const canvas = $("ge-canvas");
    const filterEl = $("ge-filter");
    const titleEl = $("ge-note-title");
    const metaEl = $("ge-note-meta");
    const neighEl = $("ge-neighbors");
    const ctx = canvas.getContext("2d");

    let open = false;
    let rawGraph = null;
    let nodes = [];
    let links = [];
    let adj = [];
    let deg = [];
    let labels = [];
    let x = null;
    let y = null;
    let layoutSig = "";
    let cam = { x: 0, y: 0, k: 1 };
    let selected = -1;
    let hover = -1;
    let filter = "";
    let match = null; // Boolean array or null = all
    let drag = null; // { kind:'pan'|'node', i, sx, sy, ox, oy }
    let raf = 0;
    let world = 900;

    function shortLabel(path) {
      if (!path) return "?";
      const base = path.replace(/\\/g, "/").split("/").pop() || path;
      return base.replace(/\.md$/i, "");
    }

    function schedule() {
      if (raf || !open) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    }

    function resize() {
      if (!open) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      schedule();
    }

    function build(graph) {
      const all = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
      // Prefer higher-degree notes when we have to truncate.
      const scored = all
        .map((n, i) => ({ n, i, d: typeof n.degree === "number" ? n.degree : 0 }))
        .sort((a, b) => b.d - a.d || a.i - b.i)
        .slice(0, GE_MAX_NODES)
        .map((r) => r.n);
      nodes = scored;
      const byPath = new Map(nodes.map((n, i) => [n.path, i]));
      links = [];
      adj = Array.from({ length: nodes.length }, () => []);
      const rawEdges = graph && Array.isArray(graph.edges) ? graph.edges : [];
      for (const e of rawEdges) {
        const a = byPath.get(e.source);
        const b = byPath.get(e.target);
        if (a === undefined || b === undefined || a === b) continue;
        links.push([a, b]);
        adj[a].push(b);
        adj[b].push(a);
      }
      deg = adj.map((ns) => ns.length);
      labels = nodes.map((n) => shortLabel(n.path));
      const sig =
        nodes.map((n) => n.path).join("|") + "#" + links.map(([a, b]) => a + ">" + b).join("|");
      if (sig !== layoutSig) {
        layoutSig = sig;
        const pos = layoutGraph(nodes.length, links);
        // Map unit layout → world pixels for freer pan/zoom.
        world = Math.max(720, Math.sqrt(Math.max(nodes.length, 1)) * 48);
        x = new Float64Array(nodes.length);
        y = new Float64Array(nodes.length);
        for (let i = 0; i < nodes.length; i++) {
          x[i] = (pos.x[i] - 0.5) * world;
          y[i] = (pos.y[i] - 0.5) * world;
        }
        cam = { x: 0, y: 0, k: 1 };
        selected = -1;
      }
      applyFilter();
      setText(
        "ge-stats",
        nodes.length
          ? nodes.length +
              " · " +
              links.length +
              (all.length > nodes.length ? " / " + all.length : "")
          : L("sin datos", "no data")
      );
      renderSide();
      schedule();
    }

    function applyFilter() {
      const q = filter.trim().toLowerCase();
      if (!q) {
        match = null;
        return;
      }
      match = nodes.map(
        (n, i) => (n.path || "").toLowerCase().includes(q) || labels[i].toLowerCase().includes(q)
      );
    }

    function toScreen(wx, wy, w, h) {
      return {
        x: w / 2 + (wx - cam.x) * cam.k,
        y: h / 2 + (wy - cam.y) * cam.k
      };
    }

    function toWorld(sx, sy, w, h) {
      return {
        x: cam.x + (sx - w / 2) / cam.k,
        y: cam.y + (sy - h / 2) / cam.k
      };
    }

    function hitTest(sx, sy, w, h) {
      let best = -1;
      let bestD = 14;
      for (let i = 0; i < nodes.length; i++) {
        if (match && !match[i]) continue;
        const p = toScreen(x[i], y[i], w, h);
        const r = Math.max(3, Math.min(10, 3 + deg[i] * 0.55)) * Math.min(1.4, cam.k);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d <= r + 4 && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      return best;
    }

    function neighborSet(i) {
      const set = new Set();
      if (i < 0) return set;
      set.add(i);
      for (const j of adj[i]) set.add(j);
      return set;
    }

    function draw() {
      if (!open) return;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      ctx.clearRect(0, 0, w, h);

      if (!nodes.length) {
        ctx.fillStyle = "#8aa0ae";
        ctx.font = "14px system-ui";
        ctx.fillText(
          L("sin datos de grafo — ¿Postgres corriendo?", "no graph data — is Postgres up?"),
          24,
          40
        );
        return;
      }

      const focus = neighborSet(selected);
      const dim = selected >= 0;

      // Edges
      for (const [a, b] of links) {
        if (match && !match[a] && !match[b]) continue;
        const pa = toScreen(x[a], y[a], w, h);
        const pb = toScreen(x[b], y[b], w, h);
        const hot = !dim || (focus.has(a) && focus.has(b));
        ctx.strokeStyle = hot ? "rgba(94, 234, 212, 0.35)" : "rgba(52, 70, 82, 0.25)";
        ctx.lineWidth = hot && dim ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // Nodes
      for (let i = 0; i < nodes.length; i++) {
        if (match && !match[i]) continue;
        const p = toScreen(x[i], y[i], w, h);
        if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;
        const r = Math.max(3, Math.min(10, 3 + deg[i] * 0.55));
        const hot = !dim || focus.has(i);
        const isSel = i === selected;
        const isHov = i === hover;
        ctx.beginPath();
        if (isSel) {
          ctx.fillStyle = "#5eead4";
          ctx.strokeStyle = "#99f6e4";
          ctx.lineWidth = 2;
        } else if (isHov) {
          ctx.fillStyle = "#2dd4bf";
          ctx.strokeStyle = "#5eead4";
          ctx.lineWidth = 1.5;
        } else if (hot) {
          ctx.fillStyle = deg[i] > 3 ? "#14b8a6" : "#5b7c8a";
          ctx.strokeStyle = "transparent";
        } else {
          ctx.fillStyle = "rgba(58, 78, 90, 0.45)";
          ctx.strokeStyle = "transparent";
        }
        ctx.globalAlpha = match && !match[i] ? 0.15 : hot ? 1 : 0.25;
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (isSel || isHov) ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Labels: selected + hover + high-degree hubs when zoomed in
      const labelBudget = cam.k >= 1.2 ? 40 : cam.k >= 0.85 ? 18 : 8;
      const labeled = new Set();
      const maybeLabel = (i, force) => {
        if (i < 0 || labeled.has(i)) return;
        if (match && !match[i]) return;
        if (!force && labeled.size >= labelBudget) return;
        const p = toScreen(x[i], y[i], w, h);
        if (p.x < 8 || p.y < 8 || p.x > w - 8 || p.y > h - 8) return;
        labeled.add(i);
        ctx.font = (i === selected || i === hover ? "600 " : "") + "11px system-ui";
        ctx.fillStyle = i === selected || i === hover ? "#ecfeff" : "#9db0bc";
        ctx.fillText(labels[i], p.x + 8, p.y + 3);
      };
      maybeLabel(selected, true);
      maybeLabel(hover, true);
      if (selected >= 0) {
        for (const j of adj[selected]) maybeLabel(j, true);
      }
      const hubs = nodes
        .map((_, i) => i)
        .filter((i) => !match || match[i])
        .sort((a, b) => deg[b] - deg[a]);
      for (const i of hubs) maybeLabel(i, false);
    }

    function renderSide() {
      if (selected < 0 || !nodes[selected]) {
        titleEl.textContent = L("ninguna nota seleccionada", "no note selected");
        metaEl.textContent = L("clic en un nodo del grafo", "click a node in the graph");
        neighEl.replaceChildren();
        return;
      }
      const n = nodes[selected];
      titleEl.textContent = labels[selected];
      metaEl.textContent = (n.path || "") + " · deg " + deg[selected];
      const frag = document.createDocumentFragment();
      const seen = new Set();
      for (const j of adj[selected]) {
        if (seen.has(j)) continue;
        seen.add(j);
        const item = li(labels[j], String(deg[j]));
        item.dataset.idx = String(j);
        frag.append(item);
      }
      neighEl.replaceChildren(frag);
    }

    function select(i) {
      selected = i;
      renderSide();
      if (i >= 0) {
        // Soft-center on selection without resetting zoom.
        cam.x += (x[i] - cam.x) * 0.35;
        cam.y += (y[i] - cam.y) * 0.35;
      }
      schedule();
    }

    function openExplorer() {
      if (open) return;
      open = true;
      root.classList.remove("hidden");
      document.body.classList.add("ge-open");
      build(rawGraph);
      resize();
      filterEl.focus();
    }

    function closeExplorer() {
      if (!open) return;
      open = false;
      root.classList.add("hidden");
      document.body.classList.remove("ge-open");
      drag = null;
      canvas.classList.remove("dragging");
    }

    function resetView() {
      cam = { x: 0, y: 0, k: 1 };
      selected = -1;
      renderSide();
      schedule();
    }

    function setGraph(graph) {
      rawGraph = graph;
      if (open) build(graph);
    }

    // Pointer interactions
    canvas.addEventListener("pointerdown", (ev) => {
      if (!open) return;
      canvas.setPointerCapture(ev.pointerId);
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const i = hitTest(sx, sy, w, h);
      if (i >= 0) {
        drag = { kind: "node", i, sx, sy, ox: x[i], oy: y[i] };
        select(i);
      } else {
        drag = { kind: "pan", sx, sy, ox: cam.x, oy: cam.y };
        canvas.classList.add("dragging");
      }
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!open) return;
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      if (drag) {
        if (drag.kind === "pan") {
          cam.x = drag.ox - (sx - drag.sx) / cam.k;
          cam.y = drag.oy - (sy - drag.sy) / cam.k;
        } else {
          const ww = toWorld(sx, sy, w, h);
          x[drag.i] = ww.x;
          y[drag.i] = ww.y;
        }
        schedule();
        return;
      }
      const i = hitTest(sx, sy, w, h);
      if (i !== hover) {
        hover = i;
        canvas.style.cursor = i >= 0 ? "pointer" : "grab";
        schedule();
      }
    });
    const endDrag = () => {
      drag = null;
      canvas.classList.remove("dragging");
      if (hover < 0) canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener(
      "wheel",
      (ev) => {
        if (!open) return;
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = ev.clientX - rect.left;
        const sy = ev.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;
        const before = toWorld(sx, sy, w, h);
        const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
        cam.k = Math.max(0.25, Math.min(4.5, cam.k * factor));
        const after = toWorld(sx, sy, w, h);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        schedule();
      },
      { passive: false }
    );

    filterEl.addEventListener("input", () => {
      filter = filterEl.value || "";
      applyFilter();
      schedule();
    });
    neighEl.addEventListener("click", (ev) => {
      const liEl = ev.target.closest("li[data-idx]");
      if (!liEl) return;
      select(Number(liEl.dataset.idx));
    });
    $("ge-close").addEventListener("click", closeExplorer);
    $("ge-reset").addEventListener("click", resetView);
    $("p-graph-open").addEventListener("click", openExplorer);
    $("p-graph").addEventListener("click", openExplorer);
    $("p-graph").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openExplorer();
      }
    });
    document.addEventListener("keydown", (ev) => {
      if (!open) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeExplorer();
      }
    });
    window.addEventListener("resize", resize);

    return { setGraph, open: openExplorer, close: closeExplorer };
  })();

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
