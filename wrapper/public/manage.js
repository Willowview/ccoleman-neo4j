import { withBase } from "./base-path.js";
const createOut = document.getElementById("createOut");
const manageSearch = document.getElementById("manageSearch");
const manageNodeList = document.getElementById("manageNodeList");
const manageStatus = document.getElementById("manageStatus");
const manageOut = document.getElementById("manageOut");
const openEditBtn = document.getElementById("openEditBtn");
const quickDeleteBtn = document.getElementById("quickDeleteBtn");
const ontologyEl = document.getElementById("ontology");
const meLevelEl = document.getElementById("meLevel");
const relationshipEl = document.getElementById("relationship");
const linkDirectionEl = document.getElementById("linkDirection");
const fromIdEl = document.getElementById("fromId");
const missionThreadRow = document.getElementById("missionThreadRow");
const sequenceRow = document.getElementById("sequenceRow");
const phaseRow = document.getElementById("phaseRow");

/** Defaults for ME ontology choices (label is derived — not a separate UI field). */
const ONTOLOGY = {
  1: {
    label: "Objective",
    meLevel: "KOP",
    relationship: "",
    direction: "out",
    fromPlaceholder: "(usually none — top-level KOP)",
  },
  2: {
    label: "Objective",
    meLevel: "KTP",
    relationship: "DECOMPOSES_TO",
    direction: "out",
    fromPlaceholder: "KOP id",
  },
  3: {
    label: "FunctionalCapability",
    meLevel: "approach",
    relationship: "HAS_APPROACH",
    direction: "out",
    fromPlaceholder: "KTP id",
    missionThread: true,
  },
  4: {
    label: "FunctionalCapability",
    meLevel: "FC",
    relationship: "NEXT",
    direction: "out",
    fromPlaceholder: "previous FC / approach head id",
    sequence: true,
    phase: true,
  },
  5: {
    label: "CapabilitySolution",
    meLevel: "CS",
    relationship: "SATISFIED_BY",
    direction: "out",
    fromPlaceholder: "FC / task id",
  },
  6: {
    label: "Actor",
    meLevel: "Actor",
    relationship: "PERFORMED_BY",
    direction: "out",
    fromPlaceholder: "FC / task id",
  },
  7: {
    label: "Measure",
    meLevel: "Measure",
    relationship: "MEASURES",
    direction: "in",
    fromPlaceholder: "CS / KTP / KOP id being measured",
  },
  project: {
    label: "Project",
    meLevel: "",
    relationship: "SUPPORTS",
    direction: "out",
    fromPlaceholder: "optional related id",
  },
  artifact: {
    label: "Artifact",
    meLevel: "",
    relationship: "DESCRIBES",
    direction: "out",
    fromPlaceholder: "optional related id",
  },
};

let selectedId = null;
let filterTimer = null;

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, opts) {
  const res = await fetch(withBase(path), opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || res.statusText);
  return data;
}

function applyOntologyDefaults() {
  const cfg = ONTOLOGY[ontologyEl.value];
  missionThreadRow.hidden = true;
  sequenceRow.hidden = true;
  phaseRow.hidden = true;
  if (!cfg) return;

  meLevelEl.value = cfg.meLevel || "";
  relationshipEl.value = cfg.relationship;
  linkDirectionEl.value = cfg.direction;
  fromIdEl.placeholder = cfg.fromPlaceholder || "parent id";
  missionThreadRow.hidden = !cfg.missionThread;
  sequenceRow.hidden = !cfg.sequence;
  phaseRow.hidden = !cfg.phase;
}

ontologyEl.addEventListener("change", applyOntologyDefaults);
applyOntologyDefaults();

function setSelected(id) {
  selectedId = id;
  openEditBtn.disabled = !id;
  quickDeleteBtn.disabled = !id;
  for (const btn of manageNodeList.querySelectorAll(".node-list-item")) {
    btn.classList.toggle("selected", btn.dataset.id === id);
  }
}

function renderList(nodes) {
  manageNodeList.innerHTML = "";
  if (!nodes.length) {
    manageNodeList.innerHTML = `<p class="muted">No nodes match.</p>`;
    setSelected(null);
    return;
  }
  for (const n of nodes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "node-list-item";
    btn.dataset.id = n.id;
    const labels = (n.labels || []).join(", ");
    btn.innerHTML = `<strong>${escapeHtml(n.name || n.id)}</strong>
      <span>${escapeHtml(n.id)}${labels ? ` · ${escapeHtml(labels)}` : ""}${
        n.meLevel ? ` · ${escapeHtml(n.meLevel)}` : ""
      }</span>`;
    btn.addEventListener("click", () => setSelected(n.id));
    btn.addEventListener("dblclick", () => {
      window.location.href = withBase(`/edit.html?id=${encodeURIComponent(n.id)}`);
    });
    manageNodeList.appendChild(btn);
  }
  if (selectedId && nodes.some((n) => n.id === selectedId)) {
    setSelected(selectedId);
  } else {
    setSelected(null);
  }
}

async function loadNodes(q = "") {
  manageStatus.textContent = "Loading…";
  try {
    const qs = q ? `?q=${encodeURIComponent(q)}&limit=300` : "?limit=300";
    const data = await api(`/nodes${qs}`);
    renderList(data.nodes || []);
    manageStatus.textContent = `${(data.nodes || []).length} node(s)`;
  } catch (err) {
    manageStatus.textContent = err.message;
    manageNodeList.innerHTML = "";
  }
}

document.getElementById("createForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const ontology = String(fd.get("ontology") || "");
  const cfg = ONTOLOGY[ontology];
  if (!cfg) {
    createOut.textContent = "Pick an ME ontology.";
    return;
  }

  const body = {
    label: cfg.label,
    name: fd.get("name"),
    id: fd.get("id") || undefined,
    meLevel: cfg.meLevel || undefined,
  };

  const missionThread = String(fd.get("missionThread") || "").trim();
  if (missionThread) body.missionThread = missionThread;
  if (ontology === "3" && !missionThread) {
    createOut.textContent = "Mission thread is required for level 3 (approach).";
    return;
  }

  const sequence = String(fd.get("sequence") || "").trim();
  if (sequence) body.sequence = sequence;
  const phase = String(fd.get("phase") || "").trim();
  if (phase) body.phase = phase;

  const fromId = String(fd.get("fromId") || "").trim();
  const relationship = String(fd.get("relationship") || "").trim();
  const direction = String(fd.get("linkDirection") || cfg.direction || "out");
  if (fromId) {
    body.link = {
      fromId,
      relationship: relationship || cfg.relationship || "RELATED_TO",
      direction,
    };
  }

  createOut.textContent = "Creating…";
  try {
    const created = await api("/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    createOut.textContent = JSON.stringify(created, null, 2);
    await loadNodes(manageSearch.value.trim());
    if (created.id) setSelected(created.id);
  } catch (err) {
    createOut.textContent = err.message;
  }
});

manageSearch.addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => loadNodes(manageSearch.value.trim()), 200);
});

openEditBtn.addEventListener("click", () => {
  if (!selectedId) return;
  window.location.href = withBase(`/edit.html?id=${encodeURIComponent(selectedId)}`);
});

quickDeleteBtn.addEventListener("click", async () => {
  if (!selectedId) return;
  if (
    !confirm(
      `Delete node ${selectedId}?\nRelationships will be detached.\nThis cannot be undone.`,
    )
  ) {
    return;
  }
  manageOut.textContent = "Deleting…";
  try {
    const result = await api(
      `/nodes/${encodeURIComponent(selectedId)}?detach=true`,
      { method: "DELETE" },
    );
    manageOut.textContent = JSON.stringify(result, null, 2);
    selectedId = null;
    await loadNodes(manageSearch.value.trim());
  } catch (err) {
    manageOut.textContent = err.message;
  }
});

const params = new URLSearchParams(window.location.search);
if (params.get("q")) manageSearch.value = params.get("q");
loadNodes(manageSearch.value.trim());
