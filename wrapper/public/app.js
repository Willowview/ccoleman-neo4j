import { withBase } from "./base-path.js";
const statusEl = document.getElementById("status");
const rootKindEl = document.getElementById("rootKind");
const selectEl = document.getElementById("rootSelect");
const rootIdEl = document.getElementById("rootId");
const focusRowEl = document.getElementById("focusRow");
const focusSelectEl = document.getElementById("focusSelect");
const focusClearEl = document.getElementById("focusClear");
const decompEl = document.getElementById("decomp");

/** @type {"tree" | "table"} */
let decompView = "tree";
/** Full payload from last Load (unfocused). */
let lastTreeData = null;
let lastTableData = null;
let lastRootId = null;
/** @type {string | null} */
let focusId = null;
let tableLoading = false;

/** Decomp tree pan/zoom (SVG viewBox size stays fixed; display size scales). */
let treeZoom = 1;
const TREE_ZOOM_STEP = 1.2;
const TREE_ZOOM_MIN = 0.15;
const TREE_ZOOM_MAX = 2.5;
/** @type {{ w: number, h: number }} */
let lastTreeSize = { w: 0, h: 0 };

const LEVEL_TITLES = {
  1: "1 — KOP",
  2: "2 — KTP",
  3: "3 — Mission thread / approach",
  4: "4 — Sequenced functional capability",
  5: "5 — Capability solution",
  6: "6 — Actors",
  7: "7 — Measures",
  0: "Other",
};

/** Spine of the ME tree — drawn solid. */
const TREE_SPINE_RELS = new Set([
  "DECOMPOSES_TO",
  "HAS_APPROACH",
  "NEXT",
]);

/** Cross-links to solutions / actors / measures — drawn dashed. */
const TREE_ASSOC_RELS = new Set([
  "SATISFIED_BY",
  "PERFORMED_BY",
  "MEASURES",
  "HAS_MEASURE",
  "EVALUATED_BY",
]);

/** All edges used for parent/child navigation (focus, clustering). */
const HIERARCHY_RELS = new Set([
  ...TREE_SPINE_RELS,
  ...TREE_ASSOC_RELS,
  "REQUIRES",
  "PERFORMS",
  "SELECTS_MVC",
  "SUPPORTS",
  "DESCRIBES",
  "PART_OF",
  "MEMBER_OF",
]);

const DASHED_RELS = TREE_ASSOC_RELS;

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

async function api(path, opts) {
  const res = await fetch(withBase(path), opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || res.statusText);
  return data;
}

async function loadRootList() {
  const kind = rootKindEl.value || "KOP";
  const data = await api(`/decomp-roots?kind=${encodeURIComponent(kind)}`);
  selectEl.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  const label =
    kind === "KTP" ? "KTP" : kind === "FC" ? "functional capability" : "KOP";
  blank.textContent = data.roots?.length
    ? `Select a ${label}…`
    : `No ${label}s found`;
  selectEl.appendChild(blank);
  for (const k of data.roots || []) {
    const opt = document.createElement("option");
    opt.value = k.id;
    const extra =
      kind === "FC" && k.missionThread
        ? ` [${k.missionThread}${k.sequence != null ? ` #${k.sequence}` : ""}]`
        : "";
    opt.textContent = `${k.id} — ${k.name || "(unnamed)"}${extra}`;
    selectEl.appendChild(opt);
  }
}

function shortLabel(node) {
  if (!node) return "?";
  return node.name || node.id || "?";
}

/** Children of id in the ME tree (MEASURES: measure is child of measured thing). */
function childrenOf(nodeId, edges) {
  const out = [];
  for (const e of edges || []) {
    if (e.relationship === "MEASURES") {
      if (e.target === nodeId) out.push(e.source);
    } else if (HIERARCHY_RELS.has(e.relationship) && e.source === nodeId) {
      out.push(e.target);
    }
  }
  return out;
}

/**
 * Keep focus node + ancestors (context) + descendants (zoom target).
 */
function filterSubtree(data, focus) {
  if (!focus || !data?.nodes?.length) return data;
  const edges = data.edges || [];
  const idSet = new Set(data.nodes.map((n) => n.id));
  if (!idSet.has(focus)) return data;

  const keep = new Set([focus]);
  let cur = focus;
  for (let i = 0; i < 24; i++) {
    const p = primaryParentId(cur, edges);
    if (!p || !idSet.has(p) || keep.has(p)) break;
    keep.add(p);
    cur = p;
  }
  const queue = [focus];
  while (queue.length) {
    const id = queue.shift();
    for (const c of childrenOf(id, edges)) {
      if (idSet.has(c) && !keep.has(c)) {
        keep.add(c);
        queue.push(c);
      }
    }
  }

  const nodes = data.nodes.filter((n) => keep.has(n.id));
  const filteredEdges = edges.filter(
    (e) => keep.has(e.source) && keep.has(e.target),
  );
  const byLevel = {};
  for (const n of nodes) {
    const key = String(n.levelHint || 0);
    if (!byLevel[key]) byLevel[key] = [];
    byLevel[key].push(n);
  }
  return {
    ...data,
    nodes,
    edges: filteredEdges,
    byLevel,
    focusId: focus,
    focused: true,
  };
}

function fillFocusSelect(data) {
  if (!focusRowEl || !focusSelectEl) return;
  if (!data?.nodes?.length) {
    focusRowEl.hidden = true;
    return;
  }
  focusRowEl.hidden = false;
  const prev = focusId || "";
  focusSelectEl.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Full loaded tree";
  focusSelectEl.appendChild(all);

  const sorted = [...data.nodes].sort(
    (a, b) =>
      (a.levelHint || 0) - (b.levelHint || 0) ||
      String(a.id).localeCompare(String(b.id)),
  );
  for (const n of sorted) {
    const opt = document.createElement("option");
    opt.value = n.id;
    const lvl = LEVEL_TITLES[n.levelHint] || `L${n.levelHint || "?"}`;
    opt.textContent = `${lvl} · ${n.id} — ${n.name || "(unnamed)"}`;
    focusSelectEl.appendChild(opt);
  }
  focusSelectEl.value = [...focusSelectEl.options].some((o) => o.value === prev)
    ? prev
    : "";
}

function displayedTreeData() {
  return filterSubtree(lastTreeData, focusId);
}

function clampTreeZoom(z) {
  return Math.min(TREE_ZOOM_MAX, Math.max(TREE_ZOOM_MIN, z));
}

function applyTreeZoom() {
  const svg = document.querySelector("#decompTreePanel .decomp-svg");
  const label = document.getElementById("treeZoomLabel");
  if (!svg || !lastTreeSize.w) return;
  svg.setAttribute("width", String(Math.round(lastTreeSize.w * treeZoom)));
  svg.setAttribute("height", String(Math.round(lastTreeSize.h * treeZoom)));
  if (label) label.textContent = `${Math.round(treeZoom * 100)}%`;
}

function setTreeZoom(z) {
  treeZoom = clampTreeZoom(z);
  applyTreeZoom();
}

function fitTreeZoom() {
  const scroll = document.getElementById("treeScroll");
  if (!scroll || !lastTreeSize.w) return;
  const pad = 24;
  const kx = (scroll.clientWidth - pad) / lastTreeSize.w;
  const ky = (scroll.clientHeight - pad) / lastTreeSize.h;
  setTreeZoom(Math.min(kx, ky));
  scroll.scrollLeft = 0;
  scroll.scrollTop = 0;
}

function wireTreeViewport() {
  const scroll = document.getElementById("treeScroll");
  if (!scroll) return;

  document.getElementById("treeZoomIn")?.addEventListener("click", () => {
    setTreeZoom(treeZoom * TREE_ZOOM_STEP);
  });
  document.getElementById("treeZoomOut")?.addEventListener("click", () => {
    setTreeZoom(treeZoom / TREE_ZOOM_STEP);
  });
  document.getElementById("treeZoomFit")?.addEventListener("click", fitTreeZoom);
  document.getElementById("treeZoomReset")?.addEventListener("click", () => {
    setTreeZoom(1);
    scroll.scrollLeft = 0;
    scroll.scrollTop = 0;
  });

  scroll.addEventListener(
    "wheel",
    (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      // Trackpads fire many small wheel events — use gentle exponential zoom,
      // clamped per tick so Mac pinch/scroll doesn't leap 20–50% at once.
      let factor = Math.exp(-ev.deltaY * 0.001);
      factor = Math.min(1.06, Math.max(1 / 1.06, factor));
      setTreeZoom(treeZoom * factor);
    },
    { passive: false },
  );

  let panning = false;
  let panX = 0;
  let panY = 0;
  scroll.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (ev.target.closest?.(".tree-node")) return;
    panning = true;
    panX = ev.clientX;
    panY = ev.clientY;
    scroll.classList.add("panning");
    scroll.setPointerCapture?.(ev.pointerId);
  });
  scroll.addEventListener("pointermove", (ev) => {
    if (!panning) return;
    scroll.scrollLeft -= ev.clientX - panX;
    scroll.scrollTop -= ev.clientY - panY;
    panX = ev.clientX;
    panY = ev.clientY;
  });
  const endPan = (ev) => {
    if (!panning) return;
    panning = false;
    scroll.classList.remove("panning");
    try {
      scroll.releasePointerCapture?.(ev.pointerId);
    } catch {
      /* ignore */
    }
  };
  scroll.addEventListener("pointerup", endPan);
  scroll.addEventListener("pointercancel", endPan);

  applyTreeZoom();
}

/** Split text into wrapped lines that fit the node box. */
function wrapLines(text, maxChars, maxLines) {
  const raw = String(text || "").trim() || "?";
  const words = raw.split(/\s+/);
  const lines = [];
  let cur = "";
  let truncated = false;

  const flushHard = (token) => {
    let t = token;
    while (t.length > maxChars) {
      if (lines.length >= maxLines) {
        truncated = true;
        return "";
      }
      lines.push(t.slice(0, maxChars));
      t = t.slice(maxChars);
    }
    return t;
  };

  for (let word of words) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    if (word.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = "";
        if (lines.length >= maxLines) {
          truncated = true;
          break;
        }
      }
      word = flushHard(word);
      if (!word) continue;
    }
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length >= maxLines) {
        truncated = true;
        cur = "";
        break;
      }
    } else {
      cur = next;
    }
  }
  if (cur) {
    if (lines.length < maxLines) lines.push(cur);
    else truncated = true;
  }

  if (truncated && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] =
      last.length >= maxChars
        ? `${last.slice(0, Math.max(1, maxChars - 1))}…`
        : `${last}…`;
  }
  return lines.length ? lines : ["?"];
}

function svgTextBlock(className, lines, x, startY, lineH) {
  return `<text class="${className}" x="${x}" y="${startY}" text-anchor="middle">${lines
    .map(
      (ln, i) =>
        `<tspan x="${x}" dy="${i === 0 ? 0 : lineH}">${escapeHtml(ln)}</tspan>`,
    )
    .join("")}</text>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function primaryParentId(nodeId, edges) {
  const hits = (edges || []).filter(
    (e) =>
      (e.target === nodeId && e.relationship !== "MEASURES") ||
      (e.relationship === "MEASURES" && e.source === nodeId),
  );
  if (!hits.length) return "";
  const h = hits[0];
  return h.relationship === "MEASURES" ? h.target : h.source;
}

/**
 * Visual ME tree: leveled rows + straight diagonal links (reference ME board style).
 */
function renderDecomp(rawData) {
  const data = rawData?.focused ? rawData : filterSubtree(rawData, focusId);
  if (!data?.nodes?.length) {
    decompEl.innerHTML = `<p class="muted">No decomp paths for <code>${escapeHtml(data?.objectiveId || "")}</code>. Need hierarchy relationships under this root.</p>`;
    return;
  }

  fillFocusSelect(lastTreeData);

  const edges = data.edges || [];

  const levels = [1, 2, 3, 4, 5, 6, 7]
    .map((lvl) => ({
      lvl,
      nodes: (data.byLevel?.[String(lvl)] || []).slice(),
    }))
    .filter((row) => row.nodes.length);

  // Cluster children under the same parent left→right
  for (const row of levels) {
    row.nodes.sort((a, b) => {
      const pa = primaryParentId(a.id, edges);
      const pb = primaryParentId(b.id, edges);
      return pa.localeCompare(pb) || String(a.id).localeCompare(String(b.id));
    });
  }

  const boxW = 108;
  const boxH = 64;
  const rowGap = 72;
  const maxNameChars = 12;
  const maxSubChars = 13;
  const labelH = 22;
  const padX = 16;
  const padTop = 8;
  const gapX = 8;
  const maxPerRow = Math.max(...levels.map((r) => r.nodes.length), 1);
  // Pack to content width (skinnier boxes) so wide decomps scroll less
  const width = Math.max(520, padX * 2 + maxPerRow * (boxW + gapX));
  const height =
    padTop + levels.length * (labelH + boxH + rowGap) - rowGap + 28;

  /** @type {Map<string, { x: number, y: number, cx: number, cyTop: number, cyBot: number, lvl: number }>} */
  const pos = new Map();

  levels.forEach((row, rowIndex) => {
    const y = padTop + rowIndex * (labelH + boxH + rowGap) + labelH;
    const n = row.nodes.length;
    const span = width - padX * 2;
    row.nodes.forEach((node, i) => {
      const x =
        n === 1
          ? width / 2 - boxW / 2
          : padX + (i + 0.5) * (span / n) - boxW / 2;
      pos.set(node.id, {
        x,
        y,
        cx: x + boxW / 2,
        cyTop: y,
        cyBot: y + boxH,
        lvl: row.lvl,
      });
    });
  });

  const levelById = new Map(
    (data.nodes || []).map((n) => [n.id, n.levelHint || 0]),
  );

  /**
   * Reference board: each level only links to the next (1→2→…→7).
   * Seed data often has FC→Actor and Measure→CS instead of CS→Actor→Measure;
   * synthesize those adjacent display edges so 5→6→7 still appear.
   */
  function buildTreeDrawEdges(rawEdges) {
    const draw = [];
    const csByFc = new Map();
    const actorsByFc = new Map();
    const measuresByCs = new Map();

    for (const e of rawEdges || []) {
      if (e.relationship === "SATISFIED_BY") {
        if (!csByFc.has(e.source)) csByFc.set(e.source, []);
        csByFc.get(e.source).push(e.target);
      } else if (e.relationship === "PERFORMED_BY") {
        if (!actorsByFc.has(e.source)) actorsByFc.set(e.source, []);
        actorsByFc.get(e.source).push(e.target);
      } else if (e.relationship === "MEASURES" && levelById.get(e.target) === 5) {
        if (!measuresByCs.has(e.target)) measuresByCs.set(e.target, []);
        measuresByCs.get(e.target).push(e.source);
      }
    }

    for (const e of rawEdges || []) {
      const isSpine = TREE_SPINE_RELS.has(e.relationship);
      // Real SATISFIED_BY drawn as FC → solution (levels 3/4 → 5)
      if (e.relationship === "SATISFIED_BY") {
        draw.push({
          source: e.source,
          target: e.target,
          relationship: e.relationship,
          dashed: true,
        });
        continue;
      }
      if (isSpine) {
        draw.push({
          source: e.source,
          target: e.target,
          relationship: e.relationship,
          dashed: false,
        });
      }
    }

    const seen56 = new Set();
    const seen67 = new Set();
    for (const [fc, css] of csByFc) {
      const actors = actorsByFc.get(fc) || [];
      for (const cs of css) {
        for (const actor of actors) {
          const k56 = `${cs}>${actor}`;
          if (!seen56.has(k56) && levelById.get(cs) === 5 && levelById.get(actor) === 6) {
            seen56.add(k56);
            draw.push({
              source: cs,
              target: actor,
              relationship: "PERFORMED_BY",
              dashed: true,
              synthetic: true,
            });
          }
          for (const measure of measuresByCs.get(cs) || []) {
            const k67 = `${actor}>${measure}`;
            if (
              !seen67.has(k67) &&
              levelById.get(actor) === 6 &&
              levelById.get(measure) === 7
            ) {
              seen67.add(k67);
              draw.push({
                source: actor,
                target: measure,
                relationship: "MEASURES",
                dashed: true,
                synthetic: true,
              });
            }
          }
        }
      }
    }

    // CS with measures but no co-FC actor: still show 5→7? No — board is actors→measures only.
    // Actors with no CS on same FC: no 5→6 from that path.
    return draw;
  }

  function shouldDrawTreeEdge(rel, parentId, childId, dashed) {
    const pLvl = levelById.get(parentId);
    const cLvl = levelById.get(childId);
    if (pLvl == null || cLvl == null) return false;
    if (rel === "NEXT" && pLvl === cLvl) return true;
    // FC (approach head L3 or sequenced L4) → solution L5
    if (rel === "SATISFIED_BY" && cLvl === 5 && (pLvl === 3 || pLvl === 4)) {
      return true;
    }
    return cLvl === pLvl + 1;
  }

  function assocBandClass(parentLvl, childLvl) {
    if (parentLvl === 4 || (parentLvl === 3 && childLvl === 5)) return "band-45";
    if (parentLvl === 5) return "band-56";
    if (parentLvl === 6) return "band-67";
    return "";
  }

  const lines = [];
  for (const e of buildTreeDrawEdges(edges)) {
    const parentId = e.source;
    const childId = e.target;
    if (!shouldDrawTreeEdge(e.relationship, parentId, childId, e.dashed)) continue;

    const a = pos.get(parentId);
    const b = pos.get(childId);
    if (!a || !b) continue;

    const dashed = Boolean(e.dashed);
    let d;
    if (e.relationship === "NEXT" && a.lvl === b.lvl) {
      const yMid = a.y + boxH / 2;
      const leftToRight = a.cx < b.cx;
      const x1 = leftToRight ? a.x + boxW : a.x;
      const x2 = leftToRight ? b.x : b.x + boxW;
      d = `M ${x1} ${yMid} L ${x2} ${yMid}`;
    } else {
      d = `M ${a.cx} ${a.cyBot} L ${b.cx} ${b.cyTop}`;
    }
    const band = dashed ? assocBandClass(a.lvl, b.lvl) : "";
    lines.push({
      d,
      dashed,
      band,
      rel: e.relationship,
      title: `${parentId} -[${e.relationship}${e.synthetic ? ", via FC" : ""}]-> ${childId}`,
      z: dashed ? 0 : 1,
    });
  }
  lines.sort((a, b) => a.z - b.z);

  const svgLines = lines
    .map((ln) => {
      const cls = `tree-edge${ln.dashed ? " dashed" : " spine"}${ln.band ? ` ${ln.band}` : ""}`;
      const marker = ln.dashed ? "arrowMuted" : "arrow";
      return `<path class="${cls}" d="${ln.d}" marker-end="url(#${marker})"><title>${escapeHtml(ln.title)}</title></path>`;
    })
    .join("");

  let rowLabels = "";
  let boxes = "";
  levels.forEach((row, rowIndex) => {
    const labelY = padTop + rowIndex * (labelH + boxH + rowGap) + 16;
    rowLabels += `<text class="tree-level-label" x="${padX}" y="${labelY}">${escapeHtml(LEVEL_TITLES[row.lvl])}</text>`;
    for (const n of row.nodes) {
      const p = pos.get(n.id);
      const nameLines = wrapLines(shortLabel(n), maxNameChars, 2);
      const subLines = wrapLines(String(n.id), maxSubChars, 1);
      const nameStartY = nameLines.length === 1 ? 20 : 15;
      const subStartY = nameLines.length === 1 ? 38 : 40;
      const focused = focusId && n.id === focusId ? " focused" : "";
      boxes += `
        <g class="tree-node${focused}" data-id="${escapeHtml(n.id)}" transform="translate(${p.x},${p.y})" role="button" tabindex="0">
          <rect width="${boxW}" height="${boxH}" rx="6" class="tree-box l${row.lvl}" />
          ${svgTextBlock("tree-name", nameLines, boxW / 2, nameStartY, 11)}
          ${svgTextBlock("tree-sub", subLines, boxW / 2, subStartY, 10)}
          <title>${escapeHtml(n.name || n.id)} (${escapeHtml(n.id)}) — click to focus subtree</title>
        </g>`;
    }
  });

  const rootLabel =
    data.root?.name ||
    data.kop?.name ||
    data.rootId ||
    data.objectiveId;
  const focusNote = focusId
    ? ` · focused on <code>${escapeHtml(focusId)}</code> (${data.nodes.length} nodes)`
    : ` · ${data.nodes.length} nodes`;
  const kindNote = data.rootKind
    ? ` · root <code>${escapeHtml(data.rootKind)}</code>`
    : "";
  const spineCount = lines.filter((l) => !l.dashed).length;
  const assocCount = lines.filter((l) => l.dashed).length;

  decompEl.innerHTML = `
    <div class="decomp-panels">
      <div id="decompTreePanel" class="decomp-panel" ${decompView === "tree" ? "" : "hidden"}>
        <p class="decomp-meta"><strong>${escapeHtml(rootLabel)}</strong>
          <span class="muted">${kindNote}${focusNote} · ${spineCount} hierarchy · ${assocCount} next-level links</span></p>
        <p class="legend muted">
          <span class="legend-swatch spine"></span> Solid = levels 1–4 hierarchy&nbsp;&nbsp;
          <span class="legend-swatch band-45"></span> 4→5 solutions&nbsp;&nbsp;
          <span class="legend-swatch band-56"></span> 5→6 actors&nbsp;&nbsp;
          <span class="legend-swatch band-67"></span> 6→7 measures&nbsp;&nbsp;
          · next-level only · click a node to focus
        </p>
        <div class="tree-viewport">
          <div class="tree-toolbar row">
            <button type="button" id="treeZoomOut" class="secondary" aria-label="Zoom out">−</button>
            <button type="button" id="treeZoomIn" class="secondary" aria-label="Zoom in">+</button>
            <button type="button" id="treeZoomFit" class="secondary">Fit</button>
            <button type="button" id="treeZoomReset" class="secondary">100%</button>
            <span id="treeZoomLabel" class="muted tree-zoom-label">100%</span>
            <span class="muted tiny">Drag background to pan · Ctrl/⌘ + scroll to zoom</span>
          </div>
          <div class="tree-scroll" id="treeScroll">
            <svg class="decomp-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="ME decomposition tree">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" class="tree-arrow" />
                </marker>
                <marker id="arrowMuted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" class="tree-arrow muted" />
                </marker>
              </defs>
              <g class="tree-edges">${svgLines}</g>
              ${rowLabels}
              <g class="tree-nodes">${boxes}</g>
            </svg>
          </div>
        </div>
        <details class="edges"><summary>Relationship list (${edges.length})</summary><ul>
          ${edges
            .slice(0, 120)
            .map(
              (e) =>
                `<li><code>${escapeHtml(e.source)}</code> -[${escapeHtml(e.relationship)}]-> <code>${escapeHtml(e.target)}</code></li>`,
            )
            .join("")}
          ${edges.length > 120 ? `<li>…and ${edges.length - 120} more</li>` : ""}
        </ul></details>
      </div>
      <div id="decompTablePanel" class="decomp-panel" ${decompView === "table" ? "" : "hidden"}>
        <p class="muted">Switching to table…</p>
      </div>
    </div>`;

  for (const g of decompEl.querySelectorAll(".tree-node[data-id]")) {
    g.addEventListener("click", () => {
      setFocus(g.getAttribute("data-id"));
    });
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        setFocus(g.getAttribute("data-id"));
      }
    });
  }

  lastTreeSize = { w: width, h: height };
  const keepZoom = Boolean(focusId);
  wireTreeViewport();
  requestAnimationFrame(() => {
    const scroll = document.getElementById("treeScroll");
    if (!keepZoom && scroll && lastTreeSize.w > scroll.clientWidth - 24) {
      fitTreeZoom();
    } else {
      applyTreeZoom();
    }
  });

  if (decompView === "table") {
    ensureTableLoaded();
  } else if (
    lastTableData &&
    lastTableData.objectiveId === (focusId || data.objectiveId)
  ) {
    renderTableIntoPanel(lastTableData);
  }
}

const TABLE_COLUMNS = [
  { key: "kopId", label: "KOP id" },
  { key: "kopName", label: "KOP name" },
  { key: "ktpId", label: "KTP id" },
  { key: "ktpName", label: "KTP name" },
  { key: "threadHeadId", label: "Thread head" },
  { key: "missionThread", label: "Mission thread" },
  { key: "taskId", label: "Task id" },
  { key: "taskName", label: "Task name" },
  { key: "taskSequence", label: "Seq" },
  { key: "taskPhase", label: "Phase" },
  { key: "capabilitySolutionId", label: "CS id" },
  { key: "capabilitySolutionName", label: "CS name" },
  { key: "materielVariant", label: "Variant" },
  { key: "actorId", label: "Actor id" },
  { key: "actorName", label: "Actor name" },
  { key: "mopMeasureId", label: "MOP id" },
  { key: "mopMeasureName", label: "MOP name" },
  { key: "ktpMeasureId", label: "KTP measure id" },
  { key: "ktpMeasureName", label: "KTP measure" },
  { key: "kopMeasureId", label: "KOP measure id" },
  { key: "kopMeasureName", label: "KOP measure" },
];

const ID_LINK_KEYS = new Set([
  "kopId",
  "ktpId",
  "threadHeadId",
  "taskId",
  "capabilitySolutionId",
  "actorId",
  "mopMeasureId",
  "ktpMeasureId",
  "kopMeasureId",
]);

function cellHtml(key, value) {
  if (value === null || value === undefined || value === "") {
    return `<span class="muted">—</span>`;
  }
  const text = escapeHtml(String(value));
  if (ID_LINK_KEYS.has(key)) {
    return `<a href="${withBase(`/edit.html?id=${encodeURIComponent(String(value))}`)}">${text}</a>`;
  }
  return text;
}

function renderTableIntoPanel(data) {
  const panel = document.getElementById("decompTablePanel");
  if (!panel) return;

  if (!data.rows?.length) {
    panel.innerHTML = `<p class="muted">No tabular rows for <code>${escapeHtml(data.objectiveId)}</code>. Need KTP children via DECOMPOSES_TO.</p>`;
    return;
  }

  const head = TABLE_COLUMNS.map(
    (c) => `<th scope="col">${escapeHtml(c.label)}</th>`,
  ).join("");
  const body = data.rows
    .map(
      (row) =>
        `<tr>${TABLE_COLUMNS.map(
          (c) => `<td>${cellHtml(c.key, row[c.key])}</td>`,
        ).join("")}</tr>`,
    )
    .join("");

  panel.innerHTML = `
    <p class="decomp-meta"><strong>${escapeHtml(data.kop?.name || data.objectiveId)}</strong>
      <span class="muted"> · ${data.rowCount} row(s)</span></p>
    <p class="legend muted">One row per KTP × task × solution × actor × measure combination. Ids link to edit.</p>
    <div class="table-scroll">
      <table class="decomp-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

async function ensureTableLoaded() {
  const panel = document.getElementById("decompTablePanel");
  const tableRoot = focusId || lastRootId;
  if (!tableRoot || !panel) return;
  if (lastTableData && lastTableData.objectiveId === tableRoot) {
    renderTableIntoPanel(lastTableData);
    return;
  }
  if (tableLoading) return;
  tableLoading = true;
  panel.innerHTML = `<p class="muted">Loading table for ${escapeHtml(tableRoot)}…</p>`;
  try {
    lastTableData = await api(`/decomp/${encodeURIComponent(tableRoot)}/table`);
    renderTableIntoPanel(lastTableData);
  } catch (err) {
    panel.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  } finally {
    tableLoading = false;
  }
}

function setDecompView(view) {
  decompView = view === "table" ? "table" : "tree";
  for (const btn of document.querySelectorAll(".view-tab")) {
    const on = btn.dataset.view === decompView;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
  const treePanel = document.getElementById("decompTreePanel");
  const tablePanel = document.getElementById("decompTablePanel");
  if (treePanel) treePanel.hidden = decompView !== "tree";
  if (tablePanel) tablePanel.hidden = decompView !== "table";
  if (decompView === "table") ensureTableLoaded();

  const url = new URL(window.location.href);
  url.searchParams.set("view", decompView);
  history.replaceState(null, "", url);
}

function setFocus(id) {
  focusId = id || null;
  lastTableData = null;
  if (focusSelectEl) focusSelectEl.value = focusId || "";
  if (lastTreeData) renderDecomp(lastTreeData);
  const url = new URL(window.location.href);
  if (focusId) url.searchParams.set("focus", focusId);
  else url.searchParams.delete("focus");
  history.replaceState(null, "", url);
  setStatus(
    focusId
      ? `Focused on ${focusId} (ancestors + subtree). Clear focus for the full tree.`
      : lastRootId
        ? `Showing full tree for ${lastRootId}`
        : "",
  );
}

async function loadDecomp(id) {
  const rootId = (id || rootIdEl.value || selectEl.value || "").trim();
  if (!rootId) {
    setStatus("Pick or enter a root id (KOP, KTP, or FC).");
    return;
  }
  rootIdEl.value = rootId;
  selectEl.value = [...selectEl.options].some((o) => o.value === rootId)
    ? rootId
    : "";
  setStatus(`Loading ${rootId}…`);
  try {
    lastRootId = rootId;
    focusId = null;
    lastTableData = null;
    const data = await api(`/decomp/${encodeURIComponent(rootId)}`);
    lastTreeData = data;

    let checklist = null;
    const kopId =
      data.rootKind === "KOP"
        ? rootId
        : data.kop?.id || data.nodes?.find((n) => n.meLevel === "KOP")?.id;
    if (kopId) {
      checklist = await api(
        `/validation/checklist/${encodeURIComponent(kopId)}`,
      ).catch(() => null);
    }

    renderDecomp(data);
    renderKopChecklist(checklist);
    setStatus(
      checklist && !checklist.complete
        ? `Loaded ${rootId} (${data.rootKind}) · KOP checklist missing ${checklist.missing.join(", ")}`
        : `Loaded ${rootId} (${data.rootKind || "root"}) · ${data.nodes.length} nodes`,
    );
    const url = new URL(window.location.href);
    url.searchParams.set("rootId", rootId);
    url.searchParams.set("kind", rootKindEl.value || data.rootKind || "KOP");
    url.searchParams.delete("kopId");
    url.searchParams.delete("focus");
    url.searchParams.set("view", decompView);
    history.replaceState(null, "", url);
  } catch (err) {
    setStatus(err.message);
    decompEl.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    renderKopChecklist(null);
    if (focusRowEl) focusRowEl.hidden = true;
  }
}

function renderKopChecklist(data) {
  const el = document.getElementById("kopChecklist");
  if (!el) return;
  if (!data) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  const pills = data.levels
    .map(
      (l) =>
        `<span class="level-pill ${l.ok ? "ok" : "missing"}" title="${escapeHtml(l.title)}">L${l.level}${l.ok ? "" : "!"}</span>`,
    )
    .join("");
  el.innerHTML = `
    <div class="kop-checklist-row">
      <span class="muted">ME checklist:</span>
      ${pills}
      ${
        data.complete
          ? `<span class="badge ok">Complete</span>`
          : `<span class="badge warn">Missing ${data.missing.join(", ")}</span>`
      }
      <a href="${withBase(`/validation.html?kopId=${encodeURIComponent(data.objectiveId)}`)}">Details</a>
    </div>`;
}

rootKindEl.addEventListener("change", () => {
  loadRootList().catch((err) => setStatus(err.message));
});

selectEl.addEventListener("change", () => {
  if (selectEl.value) rootIdEl.value = selectEl.value;
});

document.getElementById("loadBtn").addEventListener("click", () => loadDecomp());

focusSelectEl.addEventListener("change", () => {
  setFocus(focusSelectEl.value || null);
});
focusClearEl.addEventListener("click", () => setFocus(null));

for (const btn of document.querySelectorAll(".view-tab")) {
  btn.addEventListener("click", () => {
    setDecompView(btn.dataset.view);
    if (!document.getElementById("decompTreePanel") && lastTreeData) {
      renderDecomp(lastTreeData);
    }
  });
}

const params = new URLSearchParams(window.location.search);
const initial =
  params.get("rootId") || params.get("kopId") || params.get("id");
const initialKind = (params.get("kind") || "KOP").toUpperCase();
const initialFocus = params.get("focus");
const initialView = params.get("view");
if (initialView === "table" || initialView === "tree") {
  setDecompView(initialView);
}
if (["KOP", "KTP", "FC"].includes(initialKind)) {
  rootKindEl.value = initialKind;
}

loadRootList()
  .then(() => {
    if (initial) {
      rootIdEl.value = initial;
      return loadDecomp(initial).then(() => {
        if (initialFocus) setFocus(initialFocus);
      });
    }
  })
  .catch((err) => setStatus(err.message));
