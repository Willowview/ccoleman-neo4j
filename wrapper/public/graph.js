const statusEl = document.getElementById("graphStatus");
const metaEl = document.getElementById("graphMeta");
const searchEl = document.getElementById("graphSearch");
const labelEl = document.getElementById("graphLabel");
const meEl = document.getElementById("graphMeLevel");
const limitEl = document.getElementById("graphLimit");
const validatedOnlyEl = document.getElementById("graphValidatedOnly");
const listEl = document.getElementById("graphNodeList");
const canvasEl = document.getElementById("graphCanvas");
const selectionEl = document.getElementById("graphSelection");
const ctxMenu = document.getElementById("ctxMenu");

let snapshot = { nodes: [], edges: [], labels: [], meLevels: [] };
let positions = new Map();
let selectedId = null;
let neighborIds = new Set();
let highlightEdges = new Set();

let view = { x: 0, y: 0, k: 1 };
let panning = false;
let panLast = null;

const W = 900;
const H = 620;
const NODE_R = 14;
const ZOOM_STEP = 1.2;

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || res.statusText);
  return data;
}

function primaryLabel(node) {
  return (node.labels || []).find((l) => !l.startsWith("_")) || "Node";
}

function shortName(node) {
  const name = node.name || node.id || "?";
  return name.length > 22 ? `${name.slice(0, 20)}…` : name;
}

function fillFilterOptions(data) {
  const curLabel = labelEl.value;
  const curMe = meEl.value;
  labelEl.innerHTML = `<option value="">All labels</option>`;
  for (const lab of data.labels || []) {
    const opt = document.createElement("option");
    opt.value = lab;
    opt.textContent = lab;
    labelEl.appendChild(opt);
  }
  if ([...labelEl.options].some((o) => o.value === curLabel)) labelEl.value = curLabel;

  meEl.innerHTML = `<option value="">All meLevels</option>`;
  for (const m of data.meLevels || []) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    meEl.appendChild(opt);
  }
  if ([...meEl.options].some((o) => o.value === curMe)) meEl.value = curMe;
}

function initPositions(nodes) {
  positions = new Map();
  const n = Math.max(nodes.length, 1);
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const radius = Math.min(W, H) * 0.38;
    positions.set(node.id, {
      x: W / 2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 20,
      y: H / 2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 20,
      vx: 0,
      vy: 0,
    });
  });
}

function tickLayout(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let iter = 0; iter < 40; iter++) {
    for (const a of nodes) {
      const pa = positions.get(a.id);
      for (const b of nodes) {
        if (a.id === b.id) continue;
        const pb = positions.get(b.id);
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = 400 / (dist * dist);
        pa.vx += (dx / dist) * force;
        pa.vy += (dy / dist) * force;
      }
    }
    for (const e of edges) {
      if (!byId.has(e.source) || !byId.has(e.target)) continue;
      const pa = positions.get(e.source);
      const pb = positions.get(e.target);
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist - 110) * 0.02;
      pa.vx += (dx / dist) * force;
      pa.vy += (dy / dist) * force;
      pb.vx -= (dx / dist) * force;
      pb.vy -= (dy / dist) * force;
    }
    for (const node of nodes) {
      const p = positions.get(node.id);
      p.vx += (W / 2 - p.x) * 0.002;
      p.vy += (H / 2 - p.y) * 0.002;
      p.vx *= 0.75;
      p.vy *= 0.75;
      p.x = Math.max(30, Math.min(W - 30, p.x + p.vx));
      p.y = Math.max(30, Math.min(H - 30, p.y + p.vy));
    }
  }
}

function computeNeighbors(id) {
  neighborIds = new Set(id ? [id] : []);
  highlightEdges = new Set();
  if (!id) return;
  for (const e of snapshot.edges || []) {
    if (e.source === id || e.target === id) {
      neighborIds.add(e.source);
      neighborIds.add(e.target);
      highlightEdges.add(`${e.source}|${e.relationship}|${e.target}`);
    }
  }
}

function findKopId(nodeId) {
  const node = snapshot.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  if (node.meLevel === "KOP" || String(node.id).startsWith("KOP-")) return node.id;

  const parentOf = new Map();
  for (const e of snapshot.edges || []) {
    if (e.relationship === "MEASURES") {
      parentOf.set(e.source, e.target);
    } else if (
      [
        "DECOMPOSES_TO",
        "HAS_APPROACH",
        "NEXT",
        "SATISFIED_BY",
        "PERFORMED_BY",
        "PART_OF",
      ].includes(e.relationship)
    ) {
      parentOf.set(e.target, e.source);
    }
  }

  let cur = nodeId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = snapshot.nodes.find((x) => x.id === cur);
    if (n && (n.meLevel === "KOP" || String(n.id).startsWith("KOP-"))) return cur;
    cur = parentOf.get(cur);
  }
  return null;
}

function clearSelection() {
  if (!selectedId) return;
  selectedId = null;
  neighborIds = new Set();
  highlightEdges = new Set();
  hideCtxMenu();
  selectionEl.innerHTML = `<span class="muted">No node selected.</span>`;
  renderNodeList();
  updateHighlightClasses();
}

function setSelection(id) {
  // Clicking the already-selected node toggles off
  if (id && id === selectedId) {
    clearSelection();
    return;
  }

  selectedId = id;
  computeNeighbors(id);
  hideCtxMenu();

  const node = snapshot.nodes.find((n) => n.id === id);
  if (!node) {
    clearSelection();
    return;
  }

  const props = node.properties || {};
  const keys = Object.keys(props).sort((a, b) => {
    if (a === "id") return -1;
    if (b === "id") return 1;
    if (a === "name") return -1;
    if (b === "name") return 1;
    return a.localeCompare(b);
  });

  const rows = keys
    .map((k) => {
      const v = props[k];
      const display =
        v !== null && typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
      return `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(display)}</td></tr>`;
    })
    .join("");

  const kopId = findKopId(node.id);
  const neighborCount = Math.max(0, neighborIds.size - 1);

  selectionEl.innerHTML = `
    <div class="graph-selection-head">
      <strong>${escapeHtml(node.name || node.id)}</strong>
      <span class="muted"> · ${escapeHtml((node.labels || []).join(", ") || "—")}${
        node.meLevel ? ` · ${escapeHtml(node.meLevel)}` : ""
      } · ${neighborCount} neighbor(s)</span>
    </div>
    <div class="row graph-actions">
      <a class="button-link secondary" href="/edit.html?id=${encodeURIComponent(node.id)}">Edit</a>
      <a class="button-link secondary" href="/edit.html?id=${encodeURIComponent(node.id)}#rels">Relink / relationships</a>
      <button type="button" class="secondary" id="selDeleteBtn">Delete</button>
      ${
        kopId
          ? `<a class="button-link secondary" href="/?kopId=${encodeURIComponent(kopId)}">KOP decomp</a>`
          : `<span class="muted">No KOP in current graph filter</span>`
      }
    </div>
    <div class="graph-props-scroll">
      <table class="graph-props-table">
        <tbody>
          <tr><th scope="row">labels</th><td>${escapeHtml((node.labels || []).join(", "))}</td></tr>
          ${rows || `<tr><td colspan="2" class="muted">No properties</td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.getElementById("selDeleteBtn")?.addEventListener("click", () => deleteNode(node.id));

  renderNodeList();
  updateHighlightClasses();
}

function renderNodeList() {
  listEl.innerHTML = "";
  if (!snapshot.nodes.length) {
    listEl.innerHTML = `<p class="muted">No nodes in this filter.</p>`;
    return;
  }
  for (const n of snapshot.nodes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `node-list-item${n.id === selectedId ? " selected" : ""}${
      selectedId && neighborIds.has(n.id) && n.id !== selectedId ? " neighbor" : ""
    }`;
    btn.innerHTML = `<strong>${escapeHtml(n.name || n.id)}</strong>
      <span>${escapeHtml(n.id)} · ${escapeHtml(primaryLabel(n))}${
        n.meLevel ? ` · ${escapeHtml(n.meLevel)}` : ""
      }</span>`;
    btn.addEventListener("click", () => setSelection(n.id));
    btn.addEventListener("dblclick", () => {
      window.location.href = `/edit.html?id=${encodeURIComponent(n.id)}`;
    });
    listEl.appendChild(btn);
  }
}

function applyViewTransform() {
  const g = canvasEl.querySelector(".viewport");
  if (g) g.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
  // Keep markers roughly constant on screen so zoom-in separates overlaps
  // instead of enlarging a fixed "photo" of the graph.
  syncScreenSizedMarks();
}

/** World-space sizes so that after scale(k) they stay ~constant in pixels. */
function syncScreenSizedMarks() {
  const k = view.k || 1;
  const r = NODE_R / k;
  const labelY = (NODE_R + 12) / k;
  const fontSize = 10 / k;
  const stroke = 1.25 / k;
  const strokeHot = 2.25 / k;
  const circleStroke = 2 / k;

  for (const circle of canvasEl.querySelectorAll(".g-circle")) {
    const selected = circle.closest(".g-node")?.classList.contains("selected");
    const neighbor = circle.closest(".g-node")?.classList.contains("neighbor");
    circle.setAttribute("r", String(r));
    const sw = selected ? 3.5 / k : neighbor ? 2.5 / k : circleStroke;
    circle.style.strokeWidth = String(sw);
  }
  for (const text of canvasEl.querySelectorAll(".g-label")) {
    text.setAttribute("y", String(labelY));
    text.style.fontSize = `${fontSize}px`;
  }
  for (const line of canvasEl.querySelectorAll(".g-edge")) {
    const hot = line.classList.contains("hot");
    line.style.strokeWidth = String(hot ? strokeHot : stroke);
  }
}

function updateHighlightClasses() {
  const hasSel = Boolean(selectedId);
  for (const line of canvasEl.querySelectorAll(".g-edge")) {
    const key = line.dataset.key;
    line.classList.toggle("dim", hasSel && !highlightEdges.has(key));
    line.classList.toggle("hot", hasSel && highlightEdges.has(key));
  }
  for (const g of canvasEl.querySelectorAll(".g-node")) {
    const id = g.dataset.id;
    g.classList.toggle("selected", id === selectedId);
    g.classList.toggle("neighbor", hasSel && neighborIds.has(id) && id !== selectedId);
    g.classList.toggle("dim", hasSel && !neighborIds.has(id));
  }
  syncScreenSizedMarks();
}

function draw() {
  const nodes = snapshot.nodes;
  const edges = snapshot.edges;

  const lines = edges
    .map((e) => {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      if (!a || !b) return "";
      const key = `${e.source}|${e.relationship}|${e.target}`;
      return `<line class="g-edge" data-key="${escapeHtml(key)}" data-source="${escapeHtml(e.source)}" data-target="${escapeHtml(e.target)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"><title>${escapeHtml(e.source)} -[${escapeHtml(e.relationship)}]-> ${escapeHtml(e.target)}</title></line>`;
    })
    .join("");

  const circles = nodes
    .map((n) => {
      const p = positions.get(n.id);
      if (!p) return "";
      return `<g class="g-node" data-id="${escapeHtml(n.id)}" transform="translate(${p.x},${p.y})">
        <circle r="${NODE_R}" class="g-circle l-${escapeHtml(primaryLabel(n))}" />
        <text y="28" text-anchor="middle" class="g-label">${escapeHtml(shortName(n))}</text>
        <title>${escapeHtml(n.name || n.id)} (${escapeHtml(n.id)})</title>
      </g>`;
    })
    .join("");

  canvasEl.innerHTML = `
    <svg class="graph-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
      <rect class="graph-bg" x="-4000" y="-4000" width="8000" height="8000" fill="transparent" />
      <g class="viewport">
        <g class="g-edges">${lines}</g>
        <g class="g-nodes">${circles}</g>
      </g>
    </svg>`;

  applyViewTransform();
  updateHighlightClasses();
}

function hideCtxMenu() {
  ctxMenu.hidden = true;
  ctxMenu.innerHTML = "";
}

function showCtxMenu(ev, nodeId) {
  ev.preventDefault();
  setSelection(nodeId);
  const kopId = findKopId(nodeId);

  ctxMenu.innerHTML = `
    <button type="button" data-act="edit">Edit</button>
    <button type="button" data-act="rels">Relationships / relink</button>
    <button type="button" data-act="delete">Delete…</button>
    ${
      kopId
        ? `<button type="button" data-act="kop">Open KOP decomp (${escapeHtml(kopId)})</button>`
        : `<button type="button" disabled>No KOP in filter</button>`
    }`;
  ctxMenu.hidden = false;
  ctxMenu.style.left = `${Math.min(ev.clientX, window.innerWidth - 240)}px`;
  ctxMenu.style.top = `${Math.min(ev.clientY, window.innerHeight - 180)}px`;

  ctxMenu.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
    window.location.href = `/edit.html?id=${encodeURIComponent(nodeId)}`;
  });
  ctxMenu.querySelector('[data-act="rels"]')?.addEventListener("click", () => {
    window.location.href = `/edit.html?id=${encodeURIComponent(nodeId)}#rels`;
  });
  ctxMenu.querySelector('[data-act="delete"]')?.addEventListener("click", () => {
    hideCtxMenu();
    deleteNode(nodeId);
  });
  ctxMenu.querySelector('[data-act="kop"]')?.addEventListener("click", () => {
    if (kopId) window.location.href = `/?kopId=${encodeURIComponent(kopId)}`;
  });
}

async function deleteNode(nodeId) {
  if (
    !confirm(
      `Delete node ${nodeId}?\nRelationships will be detached.\nThis cannot be undone.`,
    )
  ) {
    return;
  }
  try {
    await api(`/nodes/${encodeURIComponent(nodeId)}?detach=true`, {
      method: "DELETE",
    });
    statusEl.textContent = `Deleted ${nodeId}`;
    selectedId = null;
    await loadGraph();
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function zoomBy(factor) {
  const cx = W / 2;
  const cy = H / 2;
  const worldX = (cx - view.x) / view.k;
  const worldY = (cy - view.y) / view.k;
  view.k = Math.min(4, Math.max(0.25, view.k * factor));
  view.x = cx - worldX * view.k;
  view.y = cy - worldY * view.k;
  applyViewTransform();
}

function fitView() {
  const nodes = snapshot.nodes;
  if (!nodes.length) {
    view = { x: 0, y: 0, k: 1 };
    applyViewTransform();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 60;
  const bw = Math.max(maxX - minX, 80);
  const bh = Math.max(maxY - minY, 80);
  view.k = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh, 2.5);
  view.x = W / 2 - view.k * ((minX + maxX) / 2);
  view.y = H / 2 - view.k * ((minY + maxY) / 2);
  applyViewTransform();
}

function hitNodeId(ev) {
  return ev.target?.closest?.(".g-node")?.dataset?.id || null;
}

function onPointerDown(ev) {
  if (ev.button !== 0) return;
  if (!canvasEl.contains(ev.target)) return;
  hideCtxMenu();

  const nodeId = hitNodeId(ev);
  if (nodeId) {
    setSelection(nodeId);
    return;
  }

  // Click empty canvas → clear highlight, then allow pan
  clearSelection();
  panning = true;
  panLast = { x: ev.clientX, y: ev.clientY };
  canvasEl.classList.add("panning");
}

function onPointerMove(ev) {
  if (!panning || !panLast) return;
  const dx = ev.clientX - panLast.x;
  const dy = ev.clientY - panLast.y;
  panLast = { x: ev.clientX, y: ev.clientY };
  const svg = canvasEl.querySelector("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  view.x += (dx / rect.width) * W;
  view.y += (dy / rect.height) * H;
  applyViewTransform();
}

function onPointerUp() {
  canvasEl.classList.remove("panning");
  panning = false;
  panLast = null;
}

function onContextMenu(ev) {
  if (!canvasEl.contains(ev.target)) return;
  const nodeId = hitNodeId(ev);
  if (nodeId) showCtxMenu(ev, nodeId);
  else hideCtxMenu();
}

function onDblClick(ev) {
  if (!canvasEl.contains(ev.target)) return;
  const nodeId = hitNodeId(ev);
  if (nodeId) {
    window.location.href = `/edit.html?id=${encodeURIComponent(nodeId)}`;
  }
}

canvasEl.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
canvasEl.addEventListener("contextmenu", onContextMenu);
canvasEl.addEventListener("dblclick", onDblClick);
// Block wheel zoom — use + / − buttons only
canvasEl.addEventListener(
  "wheel",
  (ev) => {
    if (canvasEl.contains(ev.target)) ev.preventDefault();
  },
  { passive: false },
);

document.addEventListener("click", (ev) => {
  if (!ctxMenu.hidden && !ctxMenu.contains(ev.target)) hideCtxMenu();

  // Click outside the graph canvas (and not on selection/actions/list) clears highlight
  const inCanvas = canvasEl.contains(ev.target);
  const inSelection = selectionEl.contains(ev.target);
  const inList = listEl.contains(ev.target);
  const inToolbar = ev.target.closest?.(".graph-toolbar");
  const inCtx = ctxMenu.contains(ev.target);
  if (!inCanvas && !inSelection && !inList && !inToolbar && !inCtx) {
    clearSelection();
  }
});
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    hideCtxMenu();
    clearSelection();
  }
});

document.getElementById("zoomIn").addEventListener("click", () => zoomBy(ZOOM_STEP));
document.getElementById("zoomOut").addEventListener("click", () => zoomBy(1 / ZOOM_STEP));
document.getElementById("zoomFit").addEventListener("click", fitView);
document.getElementById("zoomReset").addEventListener("click", () => {
  view = { x: 0, y: 0, k: 1 };
  applyViewTransform();
});

async function loadGraph() {
  const q = searchEl.value.trim();
  const label = labelEl.value;
  const meLevel = meEl.value;
  const limit = limitEl.value;
  const validatedOnly = validatedOnlyEl.checked;
  statusEl.textContent = "Loading graph…";
  const params = new URLSearchParams({ limit });
  if (q) params.set("q", q);
  if (label) params.set("label", label);
  if (meLevel) params.set("meLevel", meLevel);
  if (validatedOnly) params.set("validatedOnly", "1");

  const keepId = selectedId;
  try {
    snapshot = await api(`/graph?${params}`);
    fillFilterOptions(snapshot);
    initPositions(snapshot.nodes);
    tickLayout(snapshot.nodes, snapshot.edges);
    draw();
    fitView();
    const mode = validatedOnly ? " · validated only" : "";
    metaEl.textContent = `${snapshot.nodes.length} nodes · ${snapshot.edges.length} edges${mode}${
      snapshot.truncated ? " · truncated" : ""
    }`;
    statusEl.textContent = snapshot.truncated
      ? `Showing first ${snapshot.nodes.length} matches — tighten filters if needed.`
      : `Loaded ${snapshot.nodes.length} node(s).`;

    if (keepId && snapshot.nodes.some((n) => n.id === keepId)) setSelection(keepId);
    else {
      selectedId = null;
      neighborIds = new Set();
      renderNodeList();
      updateHighlightClasses();
    }

    const url = new URL(window.location.href);
    url.search = params.toString();
    history.replaceState(null, "", url);
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

document.getElementById("graphApply").addEventListener("click", loadGraph);
document.getElementById("graphReset").addEventListener("click", () => {
  searchEl.value = "";
  labelEl.value = "";
  meEl.value = "";
  limitEl.value = "200";
  validatedOnlyEl.checked = false;
  loadGraph();
});

validatedOnlyEl.addEventListener("change", loadGraph);

let searchTimer = null;
searchEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    loadGraph();
  }
});
searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadGraph, 350);
});

const params = new URLSearchParams(window.location.search);
if (params.get("q")) searchEl.value = params.get("q");
if (params.get("label")) labelEl.value = params.get("label");
if (params.get("meLevel")) meEl.value = params.get("meLevel");
if (params.get("limit")) limitEl.value = params.get("limit");
if (params.get("validatedOnly")) {
  const v = String(params.get("validatedOnly")).toLowerCase();
  validatedOnlyEl.checked = !["0", "false", "no", ""].includes(v);
}

loadGraph();
