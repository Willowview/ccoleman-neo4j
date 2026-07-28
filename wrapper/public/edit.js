import { withBase } from "./base-path.js";
const statusEl = document.getElementById("editStatus");
const formEl = document.getElementById("editForm");
const idEl = document.getElementById("editId");
const labelEl = document.getElementById("editLabel");
const propFieldsEl = document.getElementById("propFields");
const outEl = document.getElementById("editOut");
const relsSection = document.getElementById("relsSection");
const deleteSection = document.getElementById("deleteSection");
const relsList = document.getElementById("relsList");
const relsStatus = document.getElementById("relsStatus");
const relOut = document.getElementById("relOut");
const relinkOut = document.getElementById("relinkOut");
const deleteOut = document.getElementById("deleteOut");

const READONLY_KEYS = new Set(["id"]);
const HIDDEN_FROM_ROWS = new Set(["id"]);

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

function currentId() {
  return idEl.value.trim();
}

function valueToInput(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function parseInputValue(raw) {
  const t = raw.trim();
  if (t === "") return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  ) {
    try {
      return JSON.parse(t);
    } catch {
      return raw;
    }
  }
  return raw;
}

function addPropRow(key = "", value = "", { removable = true } = {}) {
  const row = document.createElement("div");
  row.className = "prop-row";
  row.dataset.key = key;

  const keyInput = document.createElement("input");
  keyInput.className = "prop-key";
  keyInput.placeholder = "property key";
  keyInput.value = key;
  keyInput.required = true;
  if (READONLY_KEYS.has(key)) keyInput.readOnly = true;

  const valInput = document.createElement("input");
  valInput.className = "prop-val";
  valInput.placeholder = "value";
  valInput.value = valueToInput(value);
  if (READONLY_KEYS.has(key)) valInput.readOnly = true;

  row.appendChild(keyInput);
  row.appendChild(valInput);

  if (removable && !READONLY_KEYS.has(key)) {
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "secondary prop-remove";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => {
      row.dataset.removed = "1";
      row.hidden = true;
    });
    row.appendChild(rm);
  }

  propFieldsEl.appendChild(row);
}

function renderNode(node) {
  idEl.value = node.id || "";
  const primary =
    (node.labels || []).find((l) =>
      [
        "Objective",
        "FunctionalCapability",
        "CapabilitySolution",
        "Actor",
        "Measure",
        "Project",
        "Artifact",
      ].includes(l),
    ) ||
    node.labels?.[0] ||
    "Objective";
  labelEl.value = primary;

  propFieldsEl.innerHTML = "";
  const props = node.properties || {};
  const keys = Object.keys(props)
    .filter((k) => !HIDDEN_FROM_ROWS.has(k))
    .sort((a, b) => {
      if (a === "name") return -1;
      if (b === "name") return 1;
      return a.localeCompare(b);
    });

  for (const k of keys) addPropRow(k, props[k]);

  statusEl.textContent = `Editing ${node.id} · labels: ${(node.labels || []).join(", ")}`;
  formEl.hidden = false;
  relsSection.hidden = false;
  deleteSection.hidden = false;

  document.getElementById("relFromId").value = node.id;
  document.getElementById("relToId").value = "";
}

function renderRels(data) {
  const rels = data.relationships || [];
  relsStatus.textContent = `${rels.length} relationship(s)`;
  if (!rels.length) {
    relsList.innerHTML = `<p class="muted">No relationships yet.</p>`;
    return;
  }

  relsList.innerHTML = rels
    .map((r) => {
      const arrow =
        r.direction === "out"
          ? `${escapeHtml(r.source)} -[${escapeHtml(r.relationship)}]-> ${escapeHtml(r.target)}`
          : `${escapeHtml(r.source)} -[${escapeHtml(r.relationship)}]-> ${escapeHtml(r.target)}`;
      return `<div class="rel-row">
        <div>
          <code>${arrow}</code>
          <span class="muted"> · ${escapeHtml(r.direction)} · ${escapeHtml(r.otherName || r.otherId)}</span>
        </div>
        <div class="rel-actions">
          <a class="secondary-link" href="${withBase(`/edit.html?id=${encodeURIComponent(r.otherId)}`)}">Open other</a>
          <button type="button" class="secondary rel-delete"
            data-from="${escapeHtml(r.source)}"
            data-to="${escapeHtml(r.target)}"
            data-type="${escapeHtml(r.relationship)}">Delete edge</button>
        </div>
      </div>`;
    })
    .join("");

  for (const btn of relsList.querySelectorAll(".rel-delete")) {
    btn.addEventListener("click", async () => {
      const fromId = btn.dataset.from;
      const toId = btn.dataset.to;
      const relationship = btn.dataset.type;
      if (
        !confirm(
          `Delete relationship?\n(${fromId})-[:${relationship}]->(${toId})`,
        )
      ) {
        return;
      }
      relOut.textContent = "Deleting edge…";
      try {
        const result = await api("/relationships", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromId, toId, relationship }),
        });
        relOut.textContent = JSON.stringify(result, null, 2);
        await loadRels();
      } catch (err) {
        relOut.textContent = err.message;
      }
    });
  }
}

async function loadRels() {
  const id = currentId();
  if (!id) return;
  relsStatus.textContent = "Loading relationships…";
  try {
    const data = await api(`/nodes/${encodeURIComponent(id)}/relationships`);
    renderRels(data);
  } catch (err) {
    relsStatus.textContent = err.message;
    relsList.innerHTML = "";
  }
}

async function load() {
  const params = new URLSearchParams(window.location.search);
  const id = (params.get("id") || "").trim();
  if (!id) {
    statusEl.textContent = "Missing ?id=… — pick a node from the main page.";
    return;
  }
  statusEl.textContent = `Loading ${id}…`;
  try {
    const node = await api(`/nodes/${encodeURIComponent(id)}`);
    renderNode(node);
    await loadRels();
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

document.getElementById("addPropBtn").addEventListener("click", () => {
  addPropRow("", "");
});

formEl.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const id = currentId();
  outEl.textContent = "Saving…";

  const properties = {};
  const removeKeys = [];
  const seen = new Set();

  for (const row of propFieldsEl.querySelectorAll(".prop-row")) {
    const keyInput = row.querySelector(".prop-key");
    const valInput = row.querySelector(".prop-val");
    const key = (keyInput?.value || "").trim();
    if (!key || key === "id") continue;

    if (row.dataset.removed === "1") {
      if (row.dataset.key) removeKeys.push(row.dataset.key);
      continue;
    }

    if (seen.has(key)) {
      outEl.textContent = `Duplicate property key: ${key}`;
      return;
    }
    seen.add(key);
    properties[key] = parseInputValue(valInput?.value ?? "");
  }

  try {
    const updated = await api(`/nodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: labelEl.value,
        properties,
        removeKeys,
      }),
    });
    outEl.textContent = JSON.stringify(updated, null, 2);
    renderNode(updated);
    statusEl.textContent = `Saved ${updated.id}`;
    await loadRels();
  } catch (err) {
    outEl.textContent = err.message;
  }
});

document.getElementById("createRelForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  relOut.textContent = "Creating…";
  try {
    const created = await api("/relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromId: String(fd.get("fromId") || "").trim(),
        toId: String(fd.get("toId") || "").trim(),
        relationship: String(fd.get("relationship") || "").trim(),
      }),
    });
    relOut.textContent = JSON.stringify(created, null, 2);
    await loadRels();
  } catch (err) {
    relOut.textContent = err.message;
  }
});

document.getElementById("relinkForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const id = currentId();
  const fd = new FormData(ev.target);
  const newParentId = String(fd.get("newParentId") || "").trim();
  const oldParentId = String(fd.get("oldParentId") || "").trim();
  const relationship = String(fd.get("relationship") || "").trim();
  const childIsTarget = String(fd.get("childIsTarget")) !== "false";

  if (
    !confirm(
      `Relink ${id}?\nRemove ${relationship} from old parent(s)${
        oldParentId ? ` (${oldParentId})` : ""
      }\nAttach under ${newParentId}`,
    )
  ) {
    return;
  }

  relinkOut.textContent = "Relinking…";
  try {
    const result = await api(`/nodes/${encodeURIComponent(id)}/relink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relationship,
        newParentId,
        oldParentId: oldParentId || undefined,
        childIsTarget,
      }),
    });
    relinkOut.textContent = JSON.stringify(result, null, 2);
    renderRels(result);
  } catch (err) {
    relinkOut.textContent = err.message;
  }
});

document.getElementById("deleteBtn").addEventListener("click", async () => {
  const id = currentId();
  const detach = document.getElementById("detachCheck").checked;
  if (
    !confirm(
      `Delete node ${id}?${
        detach ? "\nRelationships will also be removed (DETACH DELETE)." : ""
      }\nThis cannot be undone.`,
    )
  ) {
    return;
  }
  deleteOut.textContent = "Deleting…";
  try {
    const qs = detach ? "detach=true" : "detach=false";
    const result = await api(`/nodes/${encodeURIComponent(id)}?${qs}`, {
      method: "DELETE",
    });
    deleteOut.textContent = JSON.stringify(result, null, 2);
    statusEl.textContent = `Deleted ${id}`;
    formEl.hidden = true;
    relsSection.hidden = true;
    deleteSection.querySelector("button").disabled = true;
  } catch (err) {
    deleteOut.textContent = err.message;
  }
});

load();

if (location.hash === "#rels") {
  // Reveal + scroll after load paints the sections
  const jump = () => {
    const el = document.getElementById("relsSection");
    if (el && !el.hidden) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else setTimeout(jump, 50);
  };
  setTimeout(jump, 100);
}