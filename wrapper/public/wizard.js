/**
 * KOP authoring wizard — static JS only (no extra npm packages).
 * Calls existing POST /nodes; does not change decomp view behavior.
 */

import { withBase } from "./base-path.js";


const state = {
  step: 0,
  kopId: null,
  ktpId: null,
  headFcId: null,
  lastFcId: null,
  csId: null,
  created: [],
};

const STEPS = [
  {
    key: "kop",
    title: "1 — Key Operational Problem (KOP)",
    help: "Create the top-level Objective (meLevel: KOP). No parent link.",
    canSkip: false,
    fields: [
      { name: "name", label: "KOP name", required: true },
      { name: "id", label: "Id (optional)", placeholder: "e.g. KOP-POC-1" },
      { name: "description", label: "Description (optional)" },
    ],
  },
  {
    key: "ktp",
    title: "2 — Key Tactical Problem (KTP)",
    help: "Create a KTP Objective under the KOP via DECOMPOSES_TO.",
    canSkip: false,
    fields: [
      { name: "name", label: "KTP name", required: true },
      { name: "id", label: "Id (optional)" },
      { name: "description", label: "Description (optional)" },
    ],
  },
  {
    key: "approach",
    title: "3 — Mission thread / approach",
    help: "FunctionalCapability with missionThread set, linked from KTP via HAS_APPROACH.",
    canSkip: true,
    fields: [
      { name: "name", label: "Approach / MT name", required: true },
      { name: "missionThread", label: "missionThread value", required: true, placeholder: "e.g. MT-Find-Fix-Finish" },
      { name: "id", label: "Id (optional)" },
      { name: "description", label: "Description (optional)" },
    ],
  },
  {
    key: "fc",
    title: "4 — Sequenced functional capability",
    help: "Additional FunctionalCapability nodes chained with NEXT from the previous FC (starts from the approach head).",
    canSkip: true,
    fields: [
      { name: "name", label: "Capability function name", required: true },
      { name: "id", label: "Id (optional)" },
      { name: "description", label: "Description (optional)" },
    ],
  },
  {
    key: "cs",
    title: "5 — Capability solution",
    help: "CapabilitySolution linked from the current FC via SATISFIED_BY.",
    canSkip: true,
    fields: [
      { name: "name", label: "Solution name", required: true },
      { name: "id", label: "Id (optional)" },
      { name: "description", label: "Description (optional)" },
    ],
  },
  {
    key: "actor",
    title: "6 — Actor",
    help: "Actor linked from the current FC via PERFORMED_BY.",
    canSkip: true,
    fields: [
      { name: "name", label: "Actor name", required: true },
      { name: "id", label: "Id (optional)" },
      { name: "description", label: "Description (optional)" },
    ],
  },
  {
    key: "measure",
    title: "7 — Measure",
    help: "Measure linked to the capability solution via MEASURES (Measure → CS).",
    canSkip: true,
    fields: [
      { name: "name", label: "Measure name", required: true },
      { name: "id", label: "Id (optional)" },
      { name: "description", label: "Description (optional)" },
    ],
  },
];

const stepList = document.getElementById("stepList");
const stepTitle = document.getElementById("stepTitle");
const stepHelp = document.getElementById("stepHelp");
const stepBody = document.getElementById("stepBody");
const stepMsg = document.getElementById("stepMsg");
const sessionOut = document.getElementById("sessionOut");
const doneLinks = document.getElementById("doneLinks");
const viewDecomp = document.getElementById("viewDecomp");
const backBtn = document.getElementById("backBtn");
const skipBtn = document.getElementById("skipBtn");
const addBtn = document.getElementById("addBtn");
const nextBtn = document.getElementById("nextBtn");

async function api(path, opts) {
  const res = await fetch(withBase(path), opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || res.statusText);
  return data;
}

function renderStepList() {
  stepList.innerHTML = STEPS.map((s, i) => {
    const cls = i === state.step ? "active" : i < state.step ? "done" : "";
    return `<li class="${cls}">${s.title}</li>`;
  }).join("");
}

function renderStep() {
  const step = STEPS[state.step];
  stepTitle.textContent = step.title;
  stepHelp.textContent = step.help;
  stepMsg.textContent = "";
  stepBody.innerHTML = step.fields
    .map(
      (f) => `
      <label>
        ${f.label}
        <input name="${f.name}" ${f.required ? "required" : ""} placeholder="${f.placeholder || ""}" />
      </label>`,
    )
    .join("");

  backBtn.disabled = state.step === 0;
  skipBtn.hidden = !step.canSkip;
  addBtn.hidden = state.step === 0; // one KOP root per session
  nextBtn.textContent = state.step === STEPS.length - 1 ? "Save & finish" : "Save & next";

  renderStepList();
  renderSession();
}

function renderSession() {
  if (!state.created.length) {
    sessionOut.textContent = "No nodes created yet.";
    doneLinks.hidden = true;
    return;
  }
  sessionOut.textContent = state.created
    .map((c) => `${c.step}: ${c.label} ${c.id} — ${c.name}${c.link ? ` [${c.link.relationship}]` : ""}`)
    .join("\n");
  if (state.kopId) {
    doneLinks.hidden = false;
    viewDecomp.href = withBase(`/?kopId=${encodeURIComponent(state.kopId)}`);
  }
}

function readFields() {
  const step = STEPS[state.step];
  const values = {};
  for (const f of step.fields) {
    const el = stepBody.querySelector(`[name="${f.name}"]`);
    values[f.name] = (el?.value || "").trim();
    if (f.required && !values[f.name]) {
      throw new Error(`${f.label} is required`);
    }
  }
  return values;
}

function buildPayload(values) {
  const step = STEPS[state.step];
  const props = {};
  if (values.description) props.description = values.description;

  switch (step.key) {
    case "kop":
      return {
        label: "Objective",
        name: values.name,
        id: values.id || undefined,
        meLevel: "KOP",
        properties: props,
      };
    case "ktp":
      if (!state.kopId) throw new Error("Create a KOP first");
      return {
        label: "Objective",
        name: values.name,
        id: values.id || undefined,
        meLevel: "KTP",
        properties: props,
        link: { fromId: state.kopId, relationship: "DECOMPOSES_TO" },
      };
    case "approach":
      if (!state.ktpId) throw new Error("Create a KTP first");
      props.missionThread = values.missionThread;
      return {
        label: "FunctionalCapability",
        name: values.name,
        id: values.id || undefined,
        properties: props,
        link: { fromId: state.ktpId, relationship: "HAS_APPROACH" },
      };
    case "fc": {
      const from = state.lastFcId || state.headFcId;
      if (!from) throw new Error("Create an approach (step 3) first, or skip back");
      return {
        label: "FunctionalCapability",
        name: values.name,
        id: values.id || undefined,
        properties: props,
        link: { fromId: from, relationship: "NEXT" },
      };
    }
    case "cs": {
      const from = state.lastFcId || state.headFcId;
      if (!from) throw new Error("Need a functional capability from step 3 or 4");
      return {
        label: "CapabilitySolution",
        name: values.name,
        id: values.id || undefined,
        properties: props,
        link: { fromId: from, relationship: "SATISFIED_BY" },
      };
    }
    case "actor": {
      const from = state.lastFcId || state.headFcId;
      if (!from) throw new Error("Need a functional capability from step 3 or 4");
      return {
        label: "Actor",
        name: values.name,
        id: values.id || undefined,
        properties: props,
        link: { fromId: from, relationship: "PERFORMED_BY" },
      };
    }
    case "measure": {
      if (!state.csId) throw new Error("Create a capability solution (step 5) first");
      return {
        label: "Measure",
        name: values.name,
        id: values.id || undefined,
        properties: props,
        link: {
          fromId: state.csId,
          relationship: "MEASURES",
          direction: "in",
        },
      };
    }
    default:
      throw new Error("Unknown step");
  }
}

function remember(created) {
  const step = STEPS[state.step];
  state.created.push({
    step: step.key,
    id: created.id,
    label: created.label,
    name: created.name,
    link: created.link,
  });
  switch (step.key) {
    case "kop":
      state.kopId = created.id;
      break;
    case "ktp":
      state.ktpId = created.id;
      break;
    case "approach":
      state.headFcId = created.id;
      state.lastFcId = created.id;
      break;
    case "fc":
      state.lastFcId = created.id;
      break;
    case "cs":
      state.csId = created.id;
      break;
    default:
      break;
  }
  renderSession();
}

async function save({ advance }) {
  try {
    const values = readFields();
    const payload = buildPayload(values);
    stepMsg.textContent = "Saving…";
    const created = await api("/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    remember(created);
    stepMsg.textContent = `Created ${created.id}`;
    stepBody.querySelectorAll("input").forEach((el) => {
      if (el.name !== "missionThread") el.value = "";
    });
    if (advance) {
      if (state.step < STEPS.length - 1) {
        state.step += 1;
        renderStep();
      } else {
        stepMsg.textContent = `Done. Open decomp for ${state.kopId}.`;
        nextBtn.disabled = true;
        addBtn.disabled = true;
      }
    }
  } catch (err) {
    stepMsg.textContent = err.message;
  }
}

backBtn.addEventListener("click", () => {
  if (state.step > 0) {
    state.step -= 1;
    nextBtn.disabled = false;
    addBtn.disabled = false;
    renderStep();
  }
});

skipBtn.addEventListener("click", () => {
  if (state.step < STEPS.length - 1) {
    state.step += 1;
    renderStep();
  }
});

addBtn.addEventListener("click", () => save({ advance: false }));
nextBtn.addEventListener("click", () => save({ advance: true }));

renderStep();
