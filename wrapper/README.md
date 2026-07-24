# Node wrapper POC (SIPR package research)

Separate mini HTTP API + static UI in front of Neo4j in this lab. Does **not** change CFTv3 product UI.

## Findings & SIPR inventory

- **POC writeup (purpose, findings, software, capabilities):** [`FINDINGS.md`](../FINDINGS.md)
- **Package / image list (keep updated):** [`SIPR-PACKAGES.md`](../SIPR-PACKAGES.md)

## Required npm package

| Package | Why |
|---------|-----|
| **`neo4j-driver`** | Official Bolt client — **only** npm dependency for this POC |

HTTP and static files use Node built-ins (no Express / GraphQL / NVL).

## Also required (not npm)

| Software | Why |
|----------|-----|
| Docker | Runs Neo4j + wrapper |
| Neo4j 5.15 Community (image) | Graph DB |
| Node 22 (wrapper image) | Runs the wrapper |

## Start

```bash
cd neo4j-decisive-lab
# create .env if needed (gitignored) — see docker-compose defaults / index.js for keys
docker compose up -d
```

Open UI:
- **KOP decomp:** http://localhost:3002/
- **Graph (search/filter):** http://localhost:3002/graph.html — pan, +/− zoom, neighbor highlight, context actions
- **Manage (create/edit/delete):** http://localhost:3002/manage.html
- **Validation:** http://localhost:3002/validation.html
- **Wizard:** http://localhost:3002/wizard.html  
Deep-link: **http://localhost:3002/?kopId=KOP-07&view=table**

```bash
curl -s http://localhost:3002/health
curl -s http://localhost:3002/kops
curl -s 'http://localhost:3002/graph?label=Objective&limit=50'
curl -s http://localhost:3002/validation/checklist/KOP-07
curl -s http://localhost:3002/validation/orphans
curl -s 'http://localhost:3002/validation/status?status=pending'
curl -s http://localhost:3002/decomp/OBJ-0001
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | KOP decomp UI (tree / table) |
| GET | `/graph.html` | Whole-graph UI (search + filters) |
| GET | `/manage.html` | Create / edit / delete UI |
| GET | `/validation.html` | Checklist, orphans, bulk validation status |
| GET | `/edit.html?id=…` | Full node editor |
| GET | `/health` | Process + Bolt check |
| GET | `/kops` | List Objectives with `meLevel: KOP` |
| GET | `/decomp/:kopId` | KOP decomp tree JSON (`nodes` / `edges` / `byLevel`) |
| GET | `/decomp/:kopId/table` | Same KOP as flat tabular rows (ME spreadsheet query) |
| GET | `/graph` | Filtered graph snapshot (`?q=&label=&meLevel=&limit=`) |
| GET | `/validation/checklist/:kopId` | ME levels 1–7 presence checklist for a KOP |
| GET | `/validation/orphans` | Nodes with no ME hierarchy relationships |
| GET | `/validation/status` | List nodes/edges by `validationStatus` (`?status=&scope=`) |
| POST | `/validation/status` | Bulk set `validationStatus` (`toStatus`, `fromStatus` and/or ids) |
| GET | `/nodes` | List nodes (`?q=` filter, `?limit=`) |
| GET | `/nodes/:id` | Fetch one node (labels + all properties) |
| PATCH | `/nodes/:id` | Update properties / primary label (`id` immutable) |
| DELETE | `/nodes/:id` | Delete node (`?detach=true` default; `false` fails if edges remain) |
| GET | `/nodes/:id/relationships` | List inbound/outbound edges for a node |
| POST | `/nodes/:id/relink` | Reparent: drop old parent edge(s) of a type, attach new parent |
| POST | `/relationships` | Create edge `{ fromId, toId, relationship }` |
| DELETE | `/relationships` | Delete edge `{ fromId, toId, relationship }` |
| POST | `/nodes` | Create/MERGE a node; optional `{ link: { fromId, relationship } }` |
| GET | `/graph` | All nodes/edges (debug) |
| POST | `/seed` | Tiny Entity demo nodes |

### Decomp Cypher

**Tree** (`GET /decomp/:kopId`): path-collecting query → `{ nodes, edges, byLevel }` for the SVG hierarchy.

**Table** (`GET /decomp/:kopId/table`): flat RETURN of KOP → KTP → mission-thread head → sequenced FCs → solutions / actors / measures (`NEXT*0..15`). UI toggles Tree | Table on the decomp card (`?view=table` deep-link).

Full 7-level view needs graph data with those relationships (e.g. load `export/cft-synthetic-kg.cypher`). The small seed only has a short Objective chain (`OBJ-0001` → KTP → vignette).

## Ports

| Service | URL |
|---------|-----|
| Wrapper / UI | http://localhost:3002 |
| Neo4j Browser | http://localhost:7475 |
| Bolt (host) | bolt://localhost:7688 |

Auth: `neo4j` / password from `.env` (default `decisive-dev-password`).

## Stop

```bash
docker compose down
```
