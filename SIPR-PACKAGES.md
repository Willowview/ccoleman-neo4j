# SIPR package & image list

Living inventory of everything required to run **neo4j-decisive-lab** on a disconnected / SIPR machine.  
**Source of truth for versions:** `wrapper/package-lock.json` (npm) and `docker-compose.yml` (images).

Last verified: 2026-07-23

---

## Summary (approval ask)

| Category | Items |
|----------|--------|
| Direct npm | `neo4j-driver` only |
| Transitive npm | 9 packages (listed below) |
| Container images | `neo4j:5.15-community`, `node:22-alpine` |
| Host tooling | Docker + Docker Compose |

**Not used:** Express, GraphQL, Neo4j Visualization Library (NVL), React, or other UI frameworks. HTTP and the static UI use Node built-ins + browser JS.

---

## Direct npm dependency

Declared in `wrapper/package.json`.

| Package | Locked version | Needed for |
|---------|----------------|------------|
| [`neo4j-driver`](https://www.npmjs.com/package/neo4j-driver) | **5.28.3** | Official Neo4j Bolt client. Opens sessions, runs Cypher, returns records for `/health`, `/kops`, `/decomp`, `/graph`, `/nodes`, relationships, and `/seed`. **Only intentional app dependency.** |

---

## Transitive npm dependencies

Installed automatically with `neo4j-driver`. Required for offline / SIPR installs (vendor `node_modules` or allow the full closure).

| Package | Locked version | Needed for |
|---------|----------------|------------|
| `neo4j-driver-core` | 5.28.3 | Core driver types, result handling, and shared Neo4j client logic used by `neo4j-driver`. |
| `neo4j-driver-bolt-connection` | 5.28.3 | Low-level Bolt protocol connection (TCP/WebSocket framing) between Node and Neo4j. |
| `rxjs` | 7.8.2 | Reactive streams used internally by the Neo4j driver for connection and result pipelines. |
| `tslib` | 2.8.1 | TypeScript helper runtime required by compiled driver / RxJS packages. |
| `buffer` | 6.0.3 | Binary buffer polyfill used when packing/unpacking Bolt messages. |
| `base64-js` | 1.5.1 | Base64 encode/decode helper used by `buffer`. |
| `ieee754` | 1.2.1 | IEEE 754 float read/write helper used by `buffer`. |
| `string_decoder` | 1.3.0 | Decodes buffers to strings for stream/buffer handling in the driver stack. |
| `safe-buffer` | 5.2.1 | Safer `Buffer` API shim used by `string_decoder`. |

Refresh command (from `wrapper/`):

```bash
node -e "
const lock = require('./package-lock.json');
Object.keys(lock.packages || {})
  .filter((k) => k.startsWith('node_modules/'))
  .sort()
  .forEach((k) => {
    const name = k.replace(/^node_modules\\//, '');
    console.log(name + '@' + lock.packages[k].version);
  });
"
```

---

## Container images

From `docker-compose.yml`.

| Image | Needed for |
|-------|------------|
| `neo4j:5.15-community` | Neo4j Community graph database + Neo4j Browser. Stores the ME / KOP knowledge graph; exposes Bolt (host **7688**) and Browser (host **7475**). |
| `node:22-alpine` | Runtime for the thin wrapper HTTP API + static UI (`wrapper/`). Runs `npm install` then `node src/index.js` on port **3002**. |

---

## Host / platform (not npm)

| Software | Needed for |
|----------|------------|
| Docker | Pull/run the Neo4j and Node images. |
| Docker Compose | Orchestrate `neo4j` + `wrapper` services, healthcheck, and networking (`bolt://neo4j:7687` inside the compose network). |

---

## Explicitly out of scope (do not add to SIPR ask unless product changes)

| Item | Why excluded today |
|------|--------------------|
| Express / Fastify / Koa | Wrapper uses Node `http` only. |
| GraphQL / Apollo | REST + Cypher only. |
| `@neo4j-nvl/*` / Bloom | Decomp UI is custom SVG in `wrapper/public/`. |
| Frontend frameworks | Plain HTML/CSS/JS. |

---

## How this document stays current

1. Any change to `wrapper/package.json`, `wrapper/package-lock.json`, or `docker-compose.yml` **must** update this file in the same change (versions + purpose rows).
2. Project Cursor rule: `.cursor/rules/sipr-packages.mdc`.
3. After dependency changes, re-run the refresh command above and sync the tables.
