# Neo4j Decisive Lab — POC findings

**Project:** `neo4j-decisive-lab`  
**Date:** 2026-07-23  
**Purpose:** Spike whether a thin Node + Neo4j stack can support mission-engineering (ME) KOP decomposition workflows suitable for a SIPR package-approval conversation — **without** integrating into CFTv3 product UI.

Related docs:

- Package / image inventory (keep in sync): [`SIPR-PACKAGES.md`](./SIPR-PACKAGES.md)
- Operator / API reference: [`wrapper/README.md`](./wrapper/README.md)

---

## 1. Executive findings

1. **Neo4j is a workable store for ME hierarchy data** (KOP → KTP → approach → sequenced FCs → solutions / actors / measures) when loaded with relationship-rich Cypher (e.g. `export/cft-synthetic-kg.cypher`).
2. **A minimal wrapper is enough to explore and author that graph.** One intentional npm dependency (`neo4j-driver`) plus Node’s built-in `http` and static HTML/CSS/JS covers browse, create/edit/delete, relationships, validation helpers, and KOP tree/table views.
3. **SIPR package ask stays small.** No Express, GraphQL, Neo4j Visualization Library (NVL), React, or Bloom required for this POC.
4. **Community vs Enterprise does not change the Node package list.** The same Bolt driver talks to both; Enterprise is a server/image/license choice (clustering, advanced RBAC, etc.), not a new npm dependency.
5. **This lab is intentionally separate from CFTv3.** Findings inform stack/package research; they do not imply a product UI commit.

---

## 2. What was built

Two Docker Compose services:

| Service | Image | Role |
|---------|--------|------|
| `neo4j` | `neo4j:5.15-community` | Graph database + Neo4j Browser |
| `wrapper` | `node:22-alpine` | Thin HTTP API + static ME lab UI |

```text
Browser  →  wrapper (:3002)  →  Bolt  →  Neo4j (:7687 in-compose / :7688 on host)
                ↓
         static HTML/JS UI
         (KOP / Graph / Manage / Validation)
```

The wrapper (`wrapper/src/index.js`):

- Uses **only** `neo4j-driver` for Bolt sessions and Cypher
- Serves static files from `wrapper/public/`
- Exposes REST-ish JSON endpoints for KOP decomp, graph snapshots, node/relationship CRUD, and validation reports

---

## 3. Software required

### Host

| Software | Why |
|----------|-----|
| **Docker** | Runs Neo4j and Node container images |
| **Docker Compose** | Starts both services, healthchecks Neo4j, wires `bolt://neo4j:7687` |

### Container images

| Image | Why |
|-------|-----|
| **`neo4j:5.15-community`** | Graph DB; Browser UI on host port **7475**; Bolt on host **7688** |
| **`node:22-alpine`** | Runs `npm install` + `node src/index.js` for the wrapper on host port **3002** |

### Application npm (SIPR-relevant)

**Direct (declared):**

| Package | Locked version | Why |
|---------|----------------|-----|
| `neo4j-driver` | 5.28.3 | Official Neo4j Bolt client — **only intentional app dependency** |

**Transitive (pulled in by `neo4j-driver`; include for offline/SIPR installs):**

| Package | Locked version | Why |
|---------|----------------|-----|
| `neo4j-driver-core` | 5.28.3 | Shared driver core |
| `neo4j-driver-bolt-connection` | 5.28.3 | Bolt framing / connection |
| `rxjs` | 7.8.2 | Driver-internal streams |
| `tslib` | 2.8.1 | TS helpers for compiled deps |
| `buffer` | 6.0.3 | Binary buffers for Bolt |
| `base64-js` | 1.5.1 | Used by `buffer` |
| `ieee754` | 1.2.1 | Used by `buffer` |
| `string_decoder` | 1.3.0 | Buffer→string helpers |
| `safe-buffer` | 5.2.1 | Safer Buffer shim |

Full living inventory with refresh instructions: **[`SIPR-PACKAGES.md`](./SIPR-PACKAGES.md)**.

### Explicitly not required for this POC

- Express / Fastify / Koa  
- GraphQL / Apollo  
- `@neo4j-nvl/*`, Bloom, or other graph viz SDKs  
- React / Vue / Angular (UI is plain HTML/CSS/JS)

---

## 4. How to run (lab)

```bash
cd neo4j-decisive-lab
# optional: create a local .env (gitignored) with NEO4J_* / LAB_* credentials
docker compose up -d
```

| Surface | URL |
|---------|-----|
| Lab UI | http://localhost:3002/ |
| Neo4j Browser | http://localhost:7475 |
| Bolt (host) | `bolt://localhost:7688` |

Default auth: `neo4j` / password from `.env` (compose default `decisive-dev-password`).

**Load rich ME sample data** (example wipe + reload):

```bash
docker compose down
rm -rf data && mkdir data
docker compose up -d
# wait for healthy, then:
docker exec -i neo4j-decisive-dev cypher-shell -u neo4j -p decisive-dev-password \
  < export/cft-synthetic-kg.cypher
```

Note: bare `CREATE INDEX` in that file can fail if indexes already exist after a soft wipe; a fresh `data/` volume avoids that.

---

## 5. What the UI can do

### KOP decomp (`/`)

- Load a KOP and view decomposition as an **SVG tree** (parent→child elbows) or **spreadsheet table**
- Show an **ME levels 1–7 checklist** summary for the loaded KOP

### Graph (`/graph.html`)

- Browse a filtered snapshot of the whole graph
- Search by id/name; filter by label / `meLevel`; limit node count
- **Pan** (drag background); **zoom** with **+ / −** (and Fit / Reset view)
- **Neighbor highlight** on select (dim unrelated nodes/edges)
- **Right-click** / selection actions: Edit, relationships/relink, Delete, open KOP decomp when a KOP is reachable in the current filter
- Select a node to print **all properties**

### Manage (`/manage.html`)

- **Create** nodes for ME ontology levels 1–7 (plus Project / Artifact), with optional parent link
- Search → open full editor or quick-delete
- Link to **KOP authoring wizard** (guided 1–7 create flow)

### Edit (`/edit.html?id=…`)

- Edit all properties; change primary label (`id` immutable)
- List / create / delete relationships; **relink / reparent**
- Detach-delete the node

### Validation (`/validation.html`)

- Full missing-level checklist for a KOP
- **Orphan** report (nodes with no ME hierarchy edges)
- Filter by `validationStatus` and **bulk update** (e.g. pending → approved)

---

## 6. ME model (as exercised here)

Typical path used by decomp / checklist queries:

| Level | Concept | Typical label / cue | Typical relationships |
|------|---------|---------------------|------------------------|
| 1 | KOP | `Objective` + `meLevel: KOP` | — |
| 2 | KTP | `Objective` + `meLevel: KTP` | `DECOMPOSES_TO` from KOP |
| 3 | Mission thread / approach | `FunctionalCapability` + `missionThread` | `HAS_APPROACH` from KTP |
| 4 | Sequenced FC / task | `FunctionalCapability` | `NEXT` along thread |
| 5 | Capability solution | `CapabilitySolution` | `SATISFIED_BY` from FC |
| 6 | Actor | `Actor` | `PERFORMED_BY` from FC |
| 7 | Measure | `Measure` | `MEASURES` → CS / KTP / KOP |

Validation status on nodes/edges (`pending`, `approved`, …) is tracked and bulk-editable. **Views do not yet hide non-approved items by default** — status is a review flag, not a visibility gate (a deliberate follow-on if “published graph only” is required).

---

## 7. Community vs Enterprise

| Topic | Finding |
|-------|---------|
| npm packages | **Same** — `neo4j-driver` (+ transitives) for both |
| What changes | Neo4j **image/license** and server features (e.g. clustering, advanced security) |
| Connection | Still Bolt; cluster deployments may use `neo4j://` routing URIs — still the same driver package |

---

## 8. SIPR / package-approval notes

- Approve **`neo4j-driver` and its transitive closure** (or vendor a frozen `node_modules` / offline registry mirror).
- Approve container images **`neo4j:5.15-community`** (or Enterprise equivalent if required) and **`node:22-alpine`**.
- Host needs Docker + Compose (or an equivalent approved runtime that can run those images).
- Keep the wrapper dependency surface intentional: every new npm package or image should update [`SIPR-PACKAGES.md`](./SIPR-PACKAGES.md).

---

## 9. Limitations / not claimed

- Not a CFTv3 product integration or replacement for Bloom/NVL-grade visualization.
- Graph layout is a simple custom force/SVG view — fine for POC scale, not a full enterprise graph explorer.
- Synthetic / exported lab data may not match every production ME edge case.
- Auth is basic Neo4j username/password for the lab; production SIPR auth/RBAC would be a separate design (often Enterprise + platform IAM).

---

## 10. Suggested next steps (optional)

1. **Approved-only graph toggle** (hide `pending` / `rejected` unless explicitly included).
2. Click tree node → open editor; CSV export of table view.
3. If product direction requires richer viz, evaluate Bloom/NVL **as a separate SIPR package ask** — not needed for the findings above.

---

## 11. Quick reference — key URLs & docs

| Item | Location |
|------|----------|
| Lab UI | http://localhost:3002/ |
| Package inventory | [`SIPR-PACKAGES.md`](./SIPR-PACKAGES.md) |
| API / runbook | [`wrapper/README.md`](./wrapper/README.md) |
| Compose | [`docker-compose.yml`](./docker-compose.yml) |
| Sample ME Cypher | [`export/cft-synthetic-kg.cypher`](./export/cft-synthetic-kg.cypher) |
