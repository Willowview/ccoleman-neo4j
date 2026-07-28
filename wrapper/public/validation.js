import { withBase } from "./base-path.js";
const checkKopSelect = document.getElementById("checkKopSelect");
const checkKopId = document.getElementById("checkKopId");
const checkStatus = document.getElementById("checkStatus");
const checklistOut = document.getElementById("checklistOut");
const orphanStatus = document.getElementById("orphanStatus");
const orphanList = document.getElementById("orphanList");
const valStatusMsg = document.getElementById("valStatusMsg");
const valLists = document.getElementById("valLists");
const valOut = document.getElementById("valOut");

let lastStatusPayload = null;

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

async function loadKops() {
  const data = await api("/kops");
  checkKopSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = data.kops.length ? "Select a KOP…" : "No KOPs found";
  checkKopSelect.appendChild(blank);
  for (const k of data.kops) {
    const opt = document.createElement("option");
    opt.value = k.id;
    opt.textContent = `${k.id} — ${k.name || "(unnamed)"}`;
    checkKopSelect.appendChild(opt);
  }
}

function renderChecklist(data) {
  const badge = data.complete
    ? `<span class="badge ok">Complete</span>`
    : `<span class="badge warn">Missing levels: ${data.missing.join(", ")}</span>`;

  const rows = data.levels
    .map((l) => {
      const ids = (l.ids || [])
        .slice(0, 8)
        .map(
          (id) =>
            `<a href="${withBase(`/edit.html?id=${encodeURIComponent(id)}`)}">${escapeHtml(id)}</a>`,
        )
        .join(", ");
      return `<tr class="${l.ok ? "row-ok" : "row-missing"}">
        <td>${l.level}</td>
        <td>${escapeHtml(l.title)}</td>
        <td>${l.ok ? "✓" : "✗"} ${l.count}</td>
        <td>${ids || "—"}${l.truncated ? "…" : ""}</td>
      </tr>`;
    })
    .join("");

  checklistOut.innerHTML = `
    <p class="decomp-meta"><strong>${escapeHtml(data.kop?.name || data.objectiveId)}</strong>
      ${badge}</p>
    <div class="table-scroll checklist-scroll">
      <table class="decomp-table checklist-table">
        <thead><tr><th>Lvl</th><th>Expected</th><th>Status</th><th>Sample ids</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="muted"><a href="${withBase(`/?kopId=${encodeURIComponent(data.objectiveId)}`)}">Open KOP decomp</a></p>`;
}

async function runChecklist() {
  const id = (checkKopId.value || checkKopSelect.value || "").trim();
  if (!id) {
    checkStatus.textContent = "Pick or enter a KOP id.";
    return;
  }
  checkKopId.value = id;
  checkStatus.textContent = `Checking ${id}…`;
  try {
    const data = await api(`/validation/checklist/${encodeURIComponent(id)}`);
    renderChecklist(data);
    checkStatus.textContent = data.complete
      ? `${id}: all levels present`
      : `${id}: missing ${data.missing.join(", ")}`;
  } catch (err) {
    checkStatus.textContent = err.message;
    checklistOut.innerHTML = "";
  }
}

async function loadOrphans() {
  orphanStatus.textContent = "Scanning…";
  try {
    const data = await api("/validation/orphans?limit=300");
    orphanStatus.textContent = `${data.count} orphan(s)${
      data.truncated ? " (truncated)" : ""
    }`;
    orphanList.innerHTML = "";
    if (!data.orphans.length) {
      orphanList.innerHTML = `<p class="muted">No orphans found.</p>`;
      return;
    }
    for (const n of data.orphans) {
      const a = document.createElement("a");
      a.className = "node-list-item";
      a.href = withBase(`/edit.html?id=${encodeURIComponent(n.id)}`);
      a.innerHTML = `<strong>${escapeHtml(n.name || n.id)}</strong>
        <span>${escapeHtml(n.id)} · ${escapeHtml((n.labels || []).join(", "))}${
          n.meLevel ? ` · ${escapeHtml(n.meLevel)}` : ""
        }</span>`;
      orphanList.appendChild(a);
    }
  } catch (err) {
    orphanStatus.textContent = err.message;
  }
}

function renderStatusLists(data) {
  lastStatusPayload = data;
  const nodeRows = (data.nodes || [])
    .map(
      (n) => `<label class="val-item">
        <input type="checkbox" class="val-node" value="${escapeHtml(n.id)}" checked />
        <span><strong>${escapeHtml(n.name || n.id)}</strong>
        <span class="muted">${escapeHtml(n.id)} · ${escapeHtml(
          (n.labels || []).join(", "),
        )}</span></span>
      </label>`,
    )
    .join("");

  const relRows = (data.relationships || [])
    .map(
      (r) => `<label class="val-item">
        <input type="checkbox" class="val-rel" checked
          data-from="${escapeHtml(r.source)}"
          data-to="${escapeHtml(r.target)}"
          data-type="${escapeHtml(r.relationship)}" />
        <span><code>${escapeHtml(r.source)} -[${escapeHtml(r.relationship)}]-> ${escapeHtml(r.target)}</code></span>
      </label>`,
    )
    .join("");

  valLists.innerHTML = `
    <div>
      <h3>Nodes (${data.nodeCount})</h3>
      <div class="val-scroll">${nodeRows || `<p class="muted">None</p>`}</div>
    </div>
    <div>
      <h3>Relationships (${data.relationshipCount})</h3>
      <div class="val-scroll">${relRows || `<p class="muted">None</p>`}</div>
    </div>`;
}

async function loadValidationStatus() {
  const status = document.getElementById("valStatus").value;
  const scope = document.getElementById("valScope").value;
  valStatusMsg.textContent = "Loading…";
  try {
    const data = await api(
      `/validation/status?status=${encodeURIComponent(status)}&scope=${encodeURIComponent(scope)}&limit=300`,
    );
    renderStatusLists(data);
    valStatusMsg.textContent = `${data.nodeCount} node(s), ${data.relationshipCount} relationship(s) with status “${data.status}”`;
  } catch (err) {
    valStatusMsg.textContent = err.message;
    valLists.innerHTML = "";
  }
}

async function bulkUpdate({ selectedOnly }) {
  const toStatus = document.getElementById("valToStatus").value;
  const fromStatus = document.getElementById("valStatus").value;
  const scope = document.getElementById("valScope").value;

  const body = { toStatus, fromStatus, scope };

  if (selectedOnly) {
    body.nodeIds = [...valLists.querySelectorAll(".val-node:checked")].map(
      (el) => el.value,
    );
    body.relationships = [...valLists.querySelectorAll(".val-rel:checked")].map(
      (el) => ({
        fromId: el.dataset.from,
        toId: el.dataset.to,
        relationship: el.dataset.type,
      }),
    );
    if (scope === "nodes") body.relationships = [];
    if (scope === "relationships") body.nodeIds = [];
    if (!body.nodeIds.length && !body.relationships.length) {
      valOut.textContent = "Nothing selected.";
      return;
    }
    // When updating selected, don't also bulk-by-fromStatus for unselected
    // bulkSetValidationStatus uses nodeIds OR fromStatus — with nodeIds it only updates those
  }

  const label = selectedOnly
    ? `Update selected → ${toStatus}?`
    : `Update ALL “${fromStatus}” (${scope}) → ${toStatus}?`;
  if (!confirm(label)) return;

  valOut.textContent = "Updating…";
  try {
    const result = await api("/validation/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    valOut.textContent = JSON.stringify(result, null, 2);
    await loadValidationStatus();
  } catch (err) {
    valOut.textContent = err.message;
  }
}

checkKopSelect.addEventListener("change", () => {
  if (checkKopSelect.value) checkKopId.value = checkKopSelect.value;
});
document.getElementById("checkBtn").addEventListener("click", runChecklist);
document.getElementById("orphanBtn").addEventListener("click", loadOrphans);
document.getElementById("valLoadBtn").addEventListener("click", loadValidationStatus);
document
  .getElementById("valSelectedBtn")
  .addEventListener("click", () => bulkUpdate({ selectedOnly: true }));
document
  .getElementById("valAllBtn")
  .addEventListener("click", () => bulkUpdate({ selectedOnly: false }));

const params = new URLSearchParams(window.location.search);
loadKops()
  .then(() => {
    const kop = params.get("kopId");
    if (kop) {
      checkKopId.value = kop;
      checkKopSelect.value = [...checkKopSelect.options].some((o) => o.value === kop)
        ? kop
        : "";
      return runChecklist();
    }
  })
  .catch((err) => {
    checkStatus.textContent = err.message;
  });

loadValidationStatus().catch(() => {});
