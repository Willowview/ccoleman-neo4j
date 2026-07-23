/**
 * Minimal Neo4j Node wrapper POC (neo4j-decisive-lab).
 * Sole npm dependency: neo4j-driver (official).
 * HTTP via Node built-in http (no Express).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import neo4j from "neo4j-driver";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const PORT = Number(process.env.PORT || 3002);
const URI = process.env.NEO4J_URI || "bolt://localhost:7688";
const USER = process.env.NEO4J_USER || "neo4j";
const PASSWORD = process.env.NEO4J_PASSWORD || "decisive-dev-password";

const ALLOWED_LABELS = [
  "Objective",
  "FunctionalCapability",
  "CapabilitySolution",
  "Actor",
  "Project",
  "Measure",
  "Artifact",
];

/** Whitelist for create / delete / relink relationship types. */
const ALLOWED_RELS = [
  "DECOMPOSES_TO",
  "HAS_APPROACH",
  "NEXT",
  "SATISFIED_BY",
  "PERFORMED_BY",
  "MEASURES",
  "REQUIRES",
  "PERFORMS",
  "HAS_MEASURE",
  "EVALUATED_BY",
  "SELECTS_MVC",
  "SUPPORTS",
  "DESCRIBES",
  "PART_OF",
  "MEMBER_OF",
  "RELATED_TO",
];

const ID_PREFIX = {
  Objective: "OBJ",
  FunctionalCapability: "FCAP",
  CapabilitySolution: "CSOL",
  Actor: "ACTR",
  Project: "PROJ",
  Measure: "MEAS",
  Artifact: "ARTI",
};

const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

function toPlain(value) {
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") {
    if (typeof value.toString === "function" && value.constructor?.name === "DateTime") {
      return value.toString();
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

function json(res, status, body) {
  const payload = JSON.stringify(toPlain(body));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function withSession(work) {
  const session = driver.session();
  try {
    return await work(session);
  } finally {
    await session.close();
  }
}

function nodeLevelHint(labels, props) {
  const me = props?.meLevel;
  if (labels.includes("Objective")) {
    if (me === "KOP") return 1;
    if (me === "KTP") return 2;
    if (me === "vignette" || me === "MT") return 3;
    return 2;
  }
  if (labels.includes("FunctionalCapability")) {
    return props?.missionThread != null ? 3 : 4;
  }
  if (labels.includes("CapabilitySolution")) return 5;
  if (labels.includes("Actor")) return 6;
  if (labels.includes("Measure")) return 7;
  if (labels.includes("Project")) return 5;
  if (labels.includes("Artifact")) return 5;
  return 0;
}

function serializeNode(node) {
  const labels = node.labels || [];
  const props = toPlain(node.properties || {});
  return {
    id: props.id,
    labels,
    name: props.name ?? props.label ?? props.id,
    meLevel: props.meLevel ?? null,
    missionThread: props.missionThread ?? null,
    levelHint: nodeLevelHint(labels, props),
    properties: props,
  };
}

function collectFromPath(path, nodeMap, edgeMap) {
  if (!path) return;
  const start = serializeNode(path.start);
  if (start.id) nodeMap.set(start.id, start);
  for (const seg of path.segments || []) {
    const a = serializeNode(seg.start);
    const b = serializeNode(seg.end);
    if (a.id) nodeMap.set(a.id, a);
    if (b.id) nodeMap.set(b.id, b);
    const rel = seg.relationship;
    const key = `${a.id}|${rel.type}|${b.id}`;
    edgeMap.set(key, {
      source: a.id,
      target: b.id,
      relationship: rel.type,
      properties: toPlain(rel.properties || {}),
    });
  }
  const end = serializeNode(path.end);
  if (end.id) nodeMap.set(end.id, end);
}

async function health() {
  await driver.verifyConnectivity();
  const result = await withSession((s) => s.run("RETURN 1 AS ok"));
  return { ok: true, neo4j: true, sample: result.records[0]?.get("ok") };
}

async function listKops() {
  return withSession(async (s) => {
    const result = await s.run(`
      MATCH (kop:Objective)
      WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
      RETURN kop.id AS id, kop.name AS name, kop.meLevel AS meLevel
      ORDER BY kop.id
    `);
    return result.records.map((r) => ({
      id: r.get("id"),
      name: r.get("name"),
      meLevel: r.get("meLevel"),
      kind: "KOP",
    }));
  });
}

/**
 * List selectable decomp roots by kind: KOP | KTP | FC
 */
async function listDecompRoots(kind = "KOP") {
  const k = String(kind || "KOP").toUpperCase();
  return withSession(async (s) => {
    if (k === "KTP") {
      const result = await s.run(`
        MATCH (n:Objective)
        WHERE n.meLevel = 'KTP' OR n.id STARTS WITH 'KTP-'
        RETURN n.id AS id, n.name AS name, n.meLevel AS meLevel
        ORDER BY n.id
      `);
      return {
        kind: "KTP",
        roots: result.records.map((r) => ({
          id: r.get("id"),
          name: r.get("name"),
          meLevel: r.get("meLevel"),
          kind: "KTP",
        })),
      };
    }
    if (k === "FC") {
      const result = await s.run(`
        MATCH (n:FunctionalCapability)
        WHERE n.id IS NOT NULL
        RETURN n.id AS id,
               n.name AS name,
               n.missionThread AS missionThread,
               n.sequence AS sequence,
               n.meLevel AS meLevel
        ORDER BY coalesce(n.missionThread, ''), coalesce(n.sequence, 0), n.id
        LIMIT 500
      `);
      return {
        kind: "FC",
        roots: result.records.map((r) => ({
          id: r.get("id"),
          name: r.get("name"),
          meLevel: r.get("meLevel"),
          missionThread: toPlain(r.get("missionThread")),
          sequence: toPlain(r.get("sequence")),
          kind: "FC",
        })),
      };
    }
    const kops = await listKops();
    return { kind: "KOP", roots: kops };
  });
}

function classifyDecompRoot(serialized) {
  if (!serialized) return "OTHER";
  const labels = serialized.labels || [];
  const me = serialized.meLevel;
  const id = String(serialized.id || "");
  if (labels.includes("Objective")) {
    if (me === "KOP" || id.startsWith("KOP-")) return "KOP";
    if (me === "KTP" || id.startsWith("KTP-")) return "KTP";
  }
  if (labels.includes("FunctionalCapability")) return "FC";
  return "OTHER";
}

function packDecompResult(rootId, rootKind, rootSerialized, pathRecords) {
  const nodeMap = new Map();
  const edgeMap = new Map();
  for (const rec of pathRecords) {
    collectFromPath(rec.get("path"), nodeMap, edgeMap);
  }
  if (rootSerialized?.id && !nodeMap.has(rootSerialized.id)) {
    nodeMap.set(rootSerialized.id, rootSerialized);
  }

  const nodes = [...nodeMap.values()].sort(
    (a, b) => a.levelHint - b.levelHint || String(a.id).localeCompare(String(b.id)),
  );
  const edges = [...edgeMap.values()];
  const byLevel = {};
  for (const n of nodes) {
    const key = String(n.levelHint || 0);
    if (!byLevel[key]) byLevel[key] = [];
    byLevel[key].push(n);
  }

  const root =
    nodes.find((n) => n.id === rootId) || rootSerialized || null;

  return {
    objectiveId: rootId,
    rootId,
    rootKind,
    root,
    kop: rootKind === "KOP" ? root : nodes.find((n) => n.meLevel === "KOP") || null,
    nodes,
    edges,
    byLevel,
    pathCount: pathRecords.length,
  };
}

const TABLE_COLUMNS = [
  "kopId",
  "kopName",
  "ktpId",
  "ktpName",
  "threadHeadId",
  "missionThread",
  "taskId",
  "taskName",
  "taskSequence",
  "taskPhase",
  "capabilitySolutionId",
  "capabilitySolutionName",
  "materielVariant",
  "actorId",
  "actorName",
  "mopMeasureId",
  "mopMeasureName",
  "ktpMeasureId",
  "ktpMeasureName",
  "kopMeasureId",
  "kopMeasureName",
];

function packTableResult(rootId, rootKind, rootMeta, records) {
  const rows = records.map((r) => {
    const row = {};
    for (const col of TABLE_COLUMNS) {
      row[col] = toPlain(r.get(col));
    }
    return row;
  });
  return {
    objectiveId: rootId,
    rootId,
    rootKind,
    root: rootMeta,
    kop: rootMeta,
    columns: TABLE_COLUMNS,
    rows,
    rowCount: rows.length,
  };
}

/**
 * ME decomp rooted at a KOP, KTP, or FunctionalCapability.
 * :param rootId => 'KOP-07' | 'KTP-07.3' | 'T-07.3.1-01'
 */
async function decompFrom(rootId) {
  return withSession(async (s) => {
    const found = await s.run(
      `
      MATCH (n {id: $rootId})
      WHERE NONE(l IN labels(n) WHERE l STARTS WITH '_')
      RETURN n
      LIMIT 1
      `,
      { rootId },
    );
    if (found.records.length === 0) {
      const err = new Error(`Node not found: ${rootId}`);
      err.status = 404;
      throw err;
    }

    const rootSerialized = serializeNode(found.records[0].get("n"));
    const rootKind = classifyDecompRoot(rootSerialized);
    if (rootKind === "OTHER") {
      const err = new Error(
        `Decomp root must be a KOP, KTP, or FunctionalCapability (got ${rootId})`,
      );
      err.status = 400;
      throw err;
    }

    let result;
    if (rootKind === "KOP") {
      result = await s.run(
        `
        MATCH (kop:Objective {id: $rootId})
        WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
        MATCH pDecompose = (kop)-[:DECOMPOSES_TO]->(ktp:Objective {meLevel: 'KTP'})
        OPTIONAL MATCH pApproach = (ktp)-[:HAS_APPROACH]->(head:FunctionalCapability)
          WHERE head.missionThread IS NOT NULL
        OPTIONAL MATCH pThread = (head)-[:NEXT*0..50]->(fc:FunctionalCapability)
        OPTIONAL MATCH pSatisfy = (fc)-[:SATISFIED_BY]->(cs:CapabilitySolution)
        OPTIONAL MATCH pPerform = (fc)-[:PERFORMED_BY]->(actor:Actor)
        OPTIONAL MATCH mopMeasure = (m:Measure)-[:MEASURES]->(cs)
        OPTIONAL MATCH ktpMeasure = (m:Measure)-[:MEASURES]->(ktp)
        OPTIONAL MATCH kopMeasure = (m:Measure)-[:MEASURES]->(kop)
        WITH [p IN [pDecompose, pApproach, pThread, pSatisfy, pPerform, mopMeasure, ktpMeasure, kopMeasure]
              WHERE p IS NOT NULL | p] AS paths
        UNWIND paths AS path
        RETURN path
        `,
        { rootId },
      );
    } else if (rootKind === "KTP") {
      result = await s.run(
        `
        MATCH (ktp:Objective {id: $rootId})
        WHERE ktp.meLevel = 'KTP' OR ktp.id STARTS WITH 'KTP-'
        OPTIONAL MATCH pUp = (kop:Objective)-[:DECOMPOSES_TO]->(ktp)
          WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
        OPTIONAL MATCH pApproach = (ktp)-[:HAS_APPROACH]->(head:FunctionalCapability)
          WHERE head.missionThread IS NOT NULL
        OPTIONAL MATCH pThread = (head)-[:NEXT*0..50]->(fc:FunctionalCapability)
        OPTIONAL MATCH pSatisfy = (fc)-[:SATISFIED_BY]->(cs:CapabilitySolution)
        OPTIONAL MATCH pPerform = (fc)-[:PERFORMED_BY]->(actor:Actor)
        OPTIONAL MATCH mopMeasure = (m:Measure)-[:MEASURES]->(cs)
        OPTIONAL MATCH ktpMeasure = (m:Measure)-[:MEASURES]->(ktp)
        OPTIONAL MATCH kopMeasure = (m:Measure)-[:MEASURES]->(kop)
        WITH [p IN [pUp, pApproach, pThread, pSatisfy, pPerform, mopMeasure, ktpMeasure, kopMeasure]
              WHERE p IS NOT NULL | p] AS paths
        UNWIND paths AS path
        RETURN path
        `,
        { rootId },
      );
    } else {
      result = await s.run(
        `
        MATCH (start:FunctionalCapability {id: $rootId})
        OPTIONAL MATCH pBack = (head:FunctionalCapability)-[:NEXT*0..50]->(start)
          WHERE head.missionThread IS NOT NULL
            AND NOT (()-[:NEXT]->(head))
        OPTIONAL MATCH pApproach = (ktp:Objective)-[:HAS_APPROACH]->(head)
          WHERE ktp.meLevel = 'KTP' OR ktp.id STARTS WITH 'KTP-'
        OPTIONAL MATCH pUp = (kop:Objective)-[:DECOMPOSES_TO]->(ktp)
          WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
        OPTIONAL MATCH pThread = (start)-[:NEXT*0..50]->(fc:FunctionalCapability)
        OPTIONAL MATCH pSatisfy = (fc)-[:SATISFIED_BY]->(cs:CapabilitySolution)
        OPTIONAL MATCH pPerform = (fc)-[:PERFORMED_BY]->(actor:Actor)
        OPTIONAL MATCH mopMeasure = (m:Measure)-[:MEASURES]->(cs)
        OPTIONAL MATCH ktpMeasure = (m:Measure)-[:MEASURES]->(ktp)
        OPTIONAL MATCH kopMeasure = (m:Measure)-[:MEASURES]->(kop)
        WITH [p IN [pBack, pApproach, pUp, pThread, pSatisfy, pPerform, mopMeasure, ktpMeasure, kopMeasure]
              WHERE p IS NOT NULL | p] AS paths
        UNWIND paths AS path
        RETURN path
        `,
        { rootId },
      );
    }

    return packDecompResult(rootId, rootKind, rootSerialized, result.records);
  });
}

/** @deprecated alias — use decompFrom */
async function decompKop(objectiveId) {
  return decompFrom(objectiveId);
}

/**
 * Flat tabular decomp rows rooted at KOP, KTP, or FC.
 */
async function decompTable(rootId) {
  return withSession(async (s) => {
    const found = await s.run(
      `
      MATCH (n {id: $rootId})
      WHERE NONE(l IN labels(n) WHERE l STARTS WITH '_')
      RETURN n
      LIMIT 1
      `,
      { rootId },
    );
    if (found.records.length === 0) {
      const err = new Error(`Node not found: ${rootId}`);
      err.status = 404;
      throw err;
    }

    const rootSerialized = serializeNode(found.records[0].get("n"));
    const rootKind = classifyDecompRoot(rootSerialized);
    if (rootKind === "OTHER") {
      const err = new Error(
        `Decomp root must be a KOP, KTP, or FunctionalCapability (got ${rootId})`,
      );
      err.status = 400;
      throw err;
    }

    const rootMeta = {
      id: rootSerialized.id,
      name: rootSerialized.name,
      kind: rootKind,
    };

    let result;
    if (rootKind === "KOP") {
      result = await s.run(
        `
        MATCH (kop:Objective {id: $rootId})
        WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
        MATCH (kop)-[:DECOMPOSES_TO]->(ktp:Objective {meLevel: 'KTP'})
        OPTIONAL MATCH (ktp)-[:HAS_APPROACH]->(head:FunctionalCapability)
          WHERE head.missionThread IS NOT NULL
        OPTIONAL MATCH (head)-[:NEXT*0..15]->(fc:FunctionalCapability)
        OPTIONAL MATCH (fc)-[sb:SATISFIED_BY]->(cs:CapabilitySolution)
        OPTIONAL MATCH (fc)-[pb:PERFORMED_BY]->(actor:Actor)
        OPTIONAL MATCH (mopM:Measure)-[:MEASURES]->(cs)
        OPTIONAL MATCH (ktpM:Measure)-[:MEASURES]->(ktp)
        OPTIONAL MATCH (kopM:Measure)-[:MEASURES]->(kop)
        RETURN kop.id AS kopId, kop.name AS kopName,
               ktp.id AS ktpId, ktp.name AS ktpName,
               head.id AS threadHeadId, head.missionThread AS missionThread,
               fc.id AS taskId, fc.name AS taskName,
               fc.sequence AS taskSequence, fc.phase AS taskPhase,
               cs.id AS capabilitySolutionId, cs.name AS capabilitySolutionName,
               sb.variant AS materielVariant,
               actor.id AS actorId, actor.name AS actorName,
               mopM.id AS mopMeasureId, mopM.name AS mopMeasureName,
               ktpM.id AS ktpMeasureId, ktpM.name AS ktpMeasureName,
               kopM.id AS kopMeasureId, kopM.name AS kopMeasureName
        ORDER BY ktp.id, fc.sequence, cs.id, actor.id, mopM.id, ktpM.id, kopM.id
        `,
        { rootId },
      );
    } else if (rootKind === "KTP") {
      result = await s.run(
        `
        MATCH (ktp:Objective {id: $rootId})
        WHERE ktp.meLevel = 'KTP' OR ktp.id STARTS WITH 'KTP-'
        OPTIONAL MATCH (kop:Objective)-[:DECOMPOSES_TO]->(ktp)
          WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
        OPTIONAL MATCH (ktp)-[:HAS_APPROACH]->(head:FunctionalCapability)
          WHERE head.missionThread IS NOT NULL
        OPTIONAL MATCH (head)-[:NEXT*0..15]->(fc:FunctionalCapability)
        OPTIONAL MATCH (fc)-[sb:SATISFIED_BY]->(cs:CapabilitySolution)
        OPTIONAL MATCH (fc)-[pb:PERFORMED_BY]->(actor:Actor)
        OPTIONAL MATCH (mopM:Measure)-[:MEASURES]->(cs)
        OPTIONAL MATCH (ktpM:Measure)-[:MEASURES]->(ktp)
        OPTIONAL MATCH (kopM:Measure)-[:MEASURES]->(kop)
        RETURN kop.id AS kopId, kop.name AS kopName,
               ktp.id AS ktpId, ktp.name AS ktpName,
               head.id AS threadHeadId, head.missionThread AS missionThread,
               fc.id AS taskId, fc.name AS taskName,
               fc.sequence AS taskSequence, fc.phase AS taskPhase,
               cs.id AS capabilitySolutionId, cs.name AS capabilitySolutionName,
               sb.variant AS materielVariant,
               actor.id AS actorId, actor.name AS actorName,
               mopM.id AS mopMeasureId, mopM.name AS mopMeasureName,
               ktpM.id AS ktpMeasureId, ktpM.name AS ktpMeasureName,
               kopM.id AS kopMeasureId, kopM.name AS kopMeasureName
        ORDER BY fc.sequence, cs.id, actor.id, mopM.id
        `,
        { rootId },
      );
    } else {
      result = await s.run(
        `
        MATCH (start:FunctionalCapability {id: $rootId})
        OPTIONAL MATCH (head:FunctionalCapability)-[:NEXT*0..50]->(start)
          WHERE head.missionThread IS NOT NULL
            AND NOT (()-[:NEXT]->(head))
        OPTIONAL MATCH (ktp:Objective)-[:HAS_APPROACH]->(head)
          WHERE ktp.meLevel = 'KTP' OR ktp.id STARTS WITH 'KTP-'
        OPTIONAL MATCH (kop:Objective)-[:DECOMPOSES_TO]->(ktp)
          WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
        OPTIONAL MATCH (start)-[:NEXT*0..15]->(fc:FunctionalCapability)
        OPTIONAL MATCH (fc)-[sb:SATISFIED_BY]->(cs:CapabilitySolution)
        OPTIONAL MATCH (fc)-[pb:PERFORMED_BY]->(actor:Actor)
        OPTIONAL MATCH (mopM:Measure)-[:MEASURES]->(cs)
        OPTIONAL MATCH (ktpM:Measure)-[:MEASURES]->(ktp)
        OPTIONAL MATCH (kopM:Measure)-[:MEASURES]->(kop)
        RETURN kop.id AS kopId, kop.name AS kopName,
               ktp.id AS ktpId, ktp.name AS ktpName,
               coalesce(head.id, start.id) AS threadHeadId,
               coalesce(head.missionThread, start.missionThread) AS missionThread,
               fc.id AS taskId, fc.name AS taskName,
               fc.sequence AS taskSequence, fc.phase AS taskPhase,
               cs.id AS capabilitySolutionId, cs.name AS capabilitySolutionName,
               sb.variant AS materielVariant,
               actor.id AS actorId, actor.name AS actorName,
               mopM.id AS mopMeasureId, mopM.name AS mopMeasureName,
               ktpM.id AS ktpMeasureId, ktpM.name AS ktpMeasureName,
               kopM.id AS kopMeasureId, kopM.name AS kopMeasureName
        ORDER BY fc.sequence, cs.id, actor.id, mopM.id
        `,
        { rootId },
      );
    }

    return packTableResult(rootId, rootKind, rootMeta, result.records);
  });
}

/** @deprecated alias — use decompTable */
async function decompKopTable(objectiveId) {
  return decompTable(objectiveId);
}

async function createNode(body) {
  const label = body.label;
  const name = body.name?.trim();
  if (!ALLOWED_LABELS.includes(label)) {
    const err = new Error(`label must be one of: ${ALLOWED_LABELS.join(", ")}`);
    err.status = 400;
    throw err;
  }
  if (!name) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }

  let id = body.id?.trim();
  if (!id) {
    id = `${ID_PREFIX[label]}-POC-${Date.now().toString(36).toUpperCase()}`;
  }

  const props = {
    id,
    name,
    validationStatus: "pending",
    confidence: 0,
    ...(body.properties && typeof body.properties === "object" ? body.properties : {}),
  };
  if (body.meLevel) props.meLevel = String(body.meLevel).trim();
  if (label === "Objective" && !props.meLevel) props.meLevel = "KTP";
  if (body.missionThread != null && String(body.missionThread).trim() !== "") {
    props.missionThread = String(body.missionThread).trim();
  }
  if (body.sequence != null && body.sequence !== "") {
    const seq = Number(body.sequence);
    if (!Number.isNaN(seq)) props.sequence = seq;
  }
  if (body.phase != null && String(body.phase).trim() !== "") {
    props.phase = String(body.phase).trim();
  }

  const link = body.link;
  if (link) {
    if (!link.fromId || !link.relationship) {
      const err = new Error("link requires fromId and relationship");
      err.status = 400;
      throw err;
    }
  }

  return withSession(async (s) => {
    // Label cannot be parameterized in Cypher — whitelist already enforced
    await s.run(
      `
      MERGE (n:${label} {id: $id})
      ON CREATE SET n.createdAt = datetime()
      SET n += $props,
          n.updatedAt = datetime()
      RETURN n
      `,
      { id, props },
    );

    let relationship = null;
    if (link) {
      const relType = String(link.relationship).replace(/[^A-Z0-9_]/gi, "");
      if (!relType) {
        const err = new Error("invalid relationship type");
        err.status = 400;
        throw err;
      }
      // direction "out" (default): (fromId)-[r]->(new)
      // direction "in": (new)-[r]->(fromId) — e.g. Measure -MEASURES-> CS
      const inbound = link.direction === "in";
      const relResult = await s.run(
        inbound
          ? `
        MATCH (a {id: $fromId})
        MATCH (b {id: $id})
        MERGE (b)-[r:${relType}]->(a)
        ON CREATE SET r.validationStatus = 'pending', r.confidence = 0.0, r.createdAt = datetime()
        RETURN type(r) AS relationship, b.id AS source, a.id AS target
        `
          : `
        MATCH (a {id: $fromId})
        MATCH (b {id: $id})
        MERGE (a)-[r:${relType}]->(b)
        ON CREATE SET r.validationStatus = 'pending', r.confidence = 0.0, r.createdAt = datetime()
        RETURN type(r) AS relationship, a.id AS source, b.id AS target
        `,
        { fromId: link.fromId, id },
      );
      if (relResult.records.length === 0) {
        const err = new Error(`could not link: fromId ${link.fromId} or node missing`);
        err.status = 400;
        throw err;
      }
      relationship = {
        source: relResult.records[0].get("source"),
        target: relResult.records[0].get("target"),
        relationship: relResult.records[0].get("relationship"),
      };
    }

    return { id, label, name, link: relationship };
  });
}

async function listAllNodes({ q, limit = 500 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  return withSession(async (s) => {
    const result = await s.run(
      `
      MATCH (n)
      WHERE n.id IS NOT NULL
        AND NONE(l IN labels(n) WHERE l STARTS WITH '_')
        AND ($q = '' OR toLower(toString(n.id)) CONTAINS $q
             OR toLower(coalesce(n.name, '')) CONTAINS $q)
      RETURN n
      ORDER BY n.id
      LIMIT $limit
      `,
      { q: String(q || "").trim().toLowerCase(), limit: neo4j.int(lim) },
    );
    return result.records.map((r) => serializeNode(r.get("n")));
  });
}

async function getNode(nodeId) {
  return withSession(async (s) => {
    const result = await s.run(
      `
      MATCH (n {id: $id})
      RETURN n
      LIMIT 1
      `,
      { id: nodeId },
    );
    if (!result.records.length) {
      const err = new Error(`Node not found: ${nodeId}`);
      err.status = 404;
      throw err;
    }
    return serializeNode(result.records[0].get("n"));
  });
}

/**
 * Update node properties. id is immutable.
 * body.properties — merge onto node
 * body.removeKeys — property keys to REMOVE
 * body.label — optional single primary label swap (whitelist)
 */
async function updateNode(nodeId, body) {
  const propsIn =
    body.properties && typeof body.properties === "object" ? body.properties : {};
  const removeKeys = Array.isArray(body.removeKeys)
    ? body.removeKeys.map(String).filter((k) => k && k !== "id")
    : [];

  if ("id" in propsIn && propsIn.id !== nodeId) {
    const err = new Error("id cannot be changed");
    err.status = 400;
    throw err;
  }

  const props = { ...propsIn };
  delete props.id;

  let newLabel = body.label?.trim() || null;
  if (newLabel && !ALLOWED_LABELS.includes(newLabel)) {
    const err = new Error(`label must be one of: ${ALLOWED_LABELS.join(", ")}`);
    err.status = 400;
    throw err;
  }

  return withSession(async (s) => {
    const exists = await s.run(
      `MATCH (n {id: $id}) RETURN n LIMIT 1`,
      { id: nodeId },
    );
    if (!exists.records.length) {
      const err = new Error(`Node not found: ${nodeId}`);
      err.status = 404;
      throw err;
    }

    if (newLabel) {
      const current = serializeNode(exists.records[0].get("n"));
      const toRemove = current.labels.filter(
        (l) => ALLOWED_LABELS.includes(l) && l !== newLabel,
      );
      // Remove old allowed labels then set the new one
      for (const lab of toRemove) {
        await s.run(`MATCH (n {id: $id}) REMOVE n:${lab}`, { id: nodeId });
      }
      await s.run(`MATCH (n {id: $id}) SET n:${newLabel}`, { id: nodeId });
    }

    for (const key of removeKeys) {
      // Property key cannot be parameterized — sanitize to identifier-like
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        const err = new Error(`invalid property key to remove: ${key}`);
        err.status = 400;
        throw err;
      }
      await s.run(`MATCH (n {id: $id}) REMOVE n.\`${key}\``, { id: nodeId });
    }

    const updated = await s.run(
      `
      MATCH (n {id: $id})
      SET n += $props,
          n.updatedAt = datetime()
      RETURN n
      `,
      { id: nodeId, props },
    );

    return serializeNode(updated.records[0].get("n"));
  });
}

function sanitizeRelType(raw) {
  const relType = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  if (!relType || !ALLOWED_RELS.includes(relType)) {
    const err = new Error(
      `relationship must be one of: ${ALLOWED_RELS.join(", ")}`,
    );
    err.status = 400;
    throw err;
  }
  return relType;
}

async function deleteNode(nodeId, { detach = true } = {}) {
  return withSession(async (s) => {
    const exists = await s.run(
      `MATCH (n {id: $id}) RETURN n LIMIT 1`,
      { id: nodeId },
    );
    if (!exists.records.length) {
      const err = new Error(`Node not found: ${nodeId}`);
      err.status = 404;
      throw err;
    }

    if (detach) {
      await s.run(`MATCH (n {id: $id}) DETACH DELETE n`, { id: nodeId });
      return { deleted: nodeId, detach: true };
    }

    const degree = await s.run(
      `
      MATCH (n {id: $id})
      OPTIONAL MATCH (n)-[r]-()
      RETURN count(r) AS c
      `,
      { id: nodeId },
    );
    const c = toPlain(degree.records[0].get("c"));
    if (c > 0) {
      const err = new Error(
        `Node ${nodeId} still has ${c} relationship(s). Pass detach=true to remove them.`,
      );
      err.status = 409;
      throw err;
    }
    await s.run(`MATCH (n {id: $id}) DELETE n`, { id: nodeId });
    return { deleted: nodeId, detach: false };
  });
}

async function listRelationships(nodeId) {
  return withSession(async (s) => {
    const exists = await s.run(
      `MATCH (n {id: $id}) RETURN n LIMIT 1`,
      { id: nodeId },
    );
    if (!exists.records.length) {
      const err = new Error(`Node not found: ${nodeId}`);
      err.status = 404;
      throw err;
    }

    const result = await s.run(
      `
      MATCH (n {id: $id})-[r]-(m)
      WHERE m.id IS NOT NULL
      RETURN n.id AS selfId,
             startNode(r).id AS source,
             endNode(r).id AS target,
             type(r) AS relationship,
             properties(r) AS properties,
             CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END AS direction,
             m.id AS otherId,
             coalesce(m.name, m.id) AS otherName,
             labels(m) AS otherLabels
      ORDER BY type(r), otherId
      `,
      { id: nodeId },
    );

    return {
      id: nodeId,
      relationships: result.records.map((r) => ({
        source: r.get("source"),
        target: r.get("target"),
        relationship: r.get("relationship"),
        direction: r.get("direction"),
        otherId: r.get("otherId"),
        otherName: r.get("otherName"),
        otherLabels: r.get("otherLabels"),
        properties: toPlain(r.get("properties") || {}),
      })),
    };
  });
}

async function createRelationship(body) {
  const fromId = body.fromId?.trim();
  const toId = body.toId?.trim();
  if (!fromId || !toId) {
    const err = new Error("fromId and toId are required");
    err.status = 400;
    throw err;
  }
  const relType = sanitizeRelType(body.relationship || body.type);
  const props =
    body.properties && typeof body.properties === "object" ? body.properties : {};

  return withSession(async (s) => {
    const result = await s.run(
      `
      MATCH (a {id: $fromId})
      MATCH (b {id: $toId})
      MERGE (a)-[r:${relType}]->(b)
      ON CREATE SET r.createdAt = datetime(),
                    r.validationStatus = 'pending',
                    r.confidence = 0.0
      SET r += $props,
          r.updatedAt = datetime()
      RETURN a.id AS source, b.id AS target, type(r) AS relationship, properties(r) AS properties
      `,
      { fromId, toId, props },
    );
    if (!result.records.length) {
      const err = new Error(`could not link: missing ${fromId} or ${toId}`);
      err.status = 400;
      throw err;
    }
    const rec = result.records[0];
    return {
      source: rec.get("source"),
      target: rec.get("target"),
      relationship: rec.get("relationship"),
      properties: toPlain(rec.get("properties") || {}),
    };
  });
}

async function deleteRelationship(body) {
  const fromId = body.fromId?.trim();
  const toId = body.toId?.trim();
  if (!fromId || !toId) {
    const err = new Error("fromId and toId are required");
    err.status = 400;
    throw err;
  }
  const relType = sanitizeRelType(body.relationship || body.type);

  return withSession(async (s) => {
    const result = await s.run(
      `
      MATCH (a {id: $fromId})-[r:${relType}]->(b {id: $toId})
      DELETE r
      RETURN $fromId AS source, $toId AS target, $relType AS relationship
      `,
      { fromId, toId, relType },
    );
    if (!result.records.length) {
      const err = new Error(
        `Relationship not found: (${fromId})-[:${relType}]->(${toId})`,
      );
      err.status = 404;
      throw err;
    }
    return {
      deleted: true,
      source: fromId,
      target: toId,
      relationship: relType,
    };
  });
}

/**
 * Move this node under a new parent for a hierarchy relationship.
 * Default: (parent)-[rel]->(thisNode). For MEASURES-style, set childIsTarget=false
 * so (thisNode)-[rel]->(parent).
 */
async function relinkNode(nodeId, body) {
  const relType = sanitizeRelType(body.relationship || body.type);
  const newParentId = body.newParentId?.trim();
  if (!newParentId) {
    const err = new Error("newParentId is required");
    err.status = 400;
    throw err;
  }
  const oldParentId = body.oldParentId?.trim() || null;
  const childIsTarget = body.childIsTarget !== false;

  return withSession(async (s) => {
    const exists = await s.run(
      `MATCH (n {id: $id}) RETURN n LIMIT 1`,
      { id: nodeId },
    );
    if (!exists.records.length) {
      const err = new Error(`Node not found: ${nodeId}`);
      err.status = 404;
      throw err;
    }

    const parentCheck = await s.run(
      `MATCH (p {id: $id}) RETURN p LIMIT 1`,
      { id: newParentId },
    );
    if (!parentCheck.records.length) {
      const err = new Error(`New parent not found: ${newParentId}`);
      err.status = 404;
      throw err;
    }

    let removed = 0;
    if (childIsTarget) {
      const del = await s.run(
        `
        MATCH (parent)-[r:${relType}]->(child {id: $nodeId})
        WHERE $oldParentId IS NULL OR parent.id = $oldParentId
        WITH collect(r) AS rels
        FOREACH (r IN rels | DELETE r)
        RETURN size(rels) AS c
        `,
        { nodeId, oldParentId },
      );
      removed = toPlain(del.records[0].get("c"));
      await s.run(
        `
        MATCH (parent {id: $newParentId})
        MATCH (child {id: $nodeId})
        MERGE (parent)-[r:${relType}]->(child)
        ON CREATE SET r.createdAt = datetime(),
                      r.validationStatus = 'pending',
                      r.confidence = 0.0
        SET r.updatedAt = datetime()
        `,
        { newParentId, nodeId },
      );
    } else {
      const del = await s.run(
        `
        MATCH (child {id: $nodeId})-[r:${relType}]->(parent)
        WHERE $oldParentId IS NULL OR parent.id = $oldParentId
        WITH collect(r) AS rels
        FOREACH (r IN rels | DELETE r)
        RETURN size(rels) AS c
        `,
        { nodeId, oldParentId },
      );
      removed = toPlain(del.records[0].get("c"));
      await s.run(
        `
        MATCH (child {id: $nodeId})
        MATCH (parent {id: $newParentId})
        MERGE (child)-[r:${relType}]->(parent)
        ON CREATE SET r.createdAt = datetime(),
                      r.validationStatus = 'pending',
                      r.confidence = 0.0
        SET r.updatedAt = datetime()
        `,
        { newParentId, nodeId },
      );
    }

    const relResult = await s.run(
      `
      MATCH (n {id: $id})-[r]-(m)
      WHERE m.id IS NOT NULL
      RETURN startNode(r).id AS source,
             endNode(r).id AS target,
             type(r) AS relationship,
             properties(r) AS properties,
             CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END AS direction,
             m.id AS otherId,
             coalesce(m.name, m.id) AS otherName,
             labels(m) AS otherLabels
      ORDER BY type(r), otherId
      `,
      { id: nodeId },
    );

    return {
      id: nodeId,
      relationship: relType,
      newParentId,
      oldParentId,
      removed,
      childIsTarget,
      relationships: relResult.records.map((r) => ({
        source: r.get("source"),
        target: r.get("target"),
        relationship: r.get("relationship"),
        direction: r.get("direction"),
        otherId: r.get("otherId"),
        otherName: r.get("otherName"),
        otherLabels: r.get("otherLabels"),
        properties: toPlain(r.get("properties") || {}),
      })),
    };
  });
}

async function seedDemo() {
  await withSession(async (s) => {
    await s.run(`
      MERGE (a:Entity {id: 'POC-1'})
        ON CREATE SET a.label = 'Demo Node A', a.type = 'demo'
      MERGE (b:Entity {id: 'POC-2'})
        ON CREATE SET b.label = 'Demo Node B', b.type = 'demo'
      MERGE (a)-[r:RELATED_TO]->(b)
        ON CREATE SET r.relationship = 'RELATED_TO'
    `);
  });
  return { seeded: true };
}

async function graphNodes() {
  return withSession(async (s) => {
    const result = await s.run(`
      MATCH (n)
      WHERE n.id IS NOT NULL AND NONE(l IN labels(n) WHERE l STARTS WITH '_')
      RETURN n
      LIMIT 500
    `);
    return result.records.map((r) => serializeNode(r.get("n")));
  });
}

async function graphEdges() {
  return withSession(async (s) => {
    const result = await s.run(`
      MATCH (a)-[r]->(b)
      WHERE a.id IS NOT NULL AND b.id IS NOT NULL
        AND NONE(l IN labels(a) WHERE l STARTS WITH '_')
        AND NONE(l IN labels(b) WHERE l STARTS WITH '_')
      RETURN a.id AS source, b.id AS target, type(r) AS relationship
      LIMIT 2000
    `);
    return result.records.map((r) => ({
      source: r.get("source"),
      target: r.get("target"),
      relationship: r.get("relationship"),
    }));
  });
}

/** Statuses treated as "validated" for the graph visibility toggle. */
const VALIDATED_STATUSES = ["validated", "approved"];

/**
 * Filtered whole-graph snapshot for the Graph UI.
 * Query: q (id/name), label, meLevel, validatedOnly, limit
 */
async function graphSnapshot({
  q = "",
  label = "",
  meLevel = "",
  validatedOnly = false,
  limit = 400,
} = {}) {
  const lim = Math.min(Math.max(Number(limit) || 400, 1), 1000);
  const qNorm = String(q || "").trim().toLowerCase();
  const labelNorm = String(label || "").trim();
  const meNorm = String(meLevel || "").trim();
  const onlyValidated = Boolean(validatedOnly);

  return withSession(async (s) => {
    const nodeResult = await s.run(
      `
      MATCH (n)
      WHERE n.id IS NOT NULL
        AND NONE(l IN labels(n) WHERE l STARTS WITH '_')
        AND ($label = '' OR $label IN labels(n))
        AND ($meLevel = '' OR n.meLevel = $meLevel)
        AND ($q = '' OR toLower(toString(n.id)) CONTAINS $q
             OR toLower(coalesce(n.name, '')) CONTAINS $q)
        AND (NOT $validatedOnly
             OR toLower(coalesce(n.validationStatus, '')) IN $validatedStatuses)
      RETURN n
      ORDER BY n.id
      LIMIT $limit
      `,
      {
        q: qNorm,
        label: labelNorm,
        meLevel: meNorm,
        validatedOnly: onlyValidated,
        validatedStatuses: VALIDATED_STATUSES,
        limit: neo4j.int(lim),
      },
    );

    const nodes = nodeResult.records.map((r) => serializeNode(r.get("n")));
    const ids = nodes.map((n) => n.id).filter(Boolean);

    let edges = [];
    if (ids.length) {
      const edgeResult = await s.run(
        `
        MATCH (a)-[r]->(b)
        WHERE a.id IN $ids AND b.id IN $ids
          AND (NOT $validatedOnly
               OR toLower(coalesce(r.validationStatus, '')) IN $validatedStatuses)
        RETURN a.id AS source, b.id AS target, type(r) AS relationship,
               r.validationStatus AS validationStatus
        LIMIT 3000
        `,
        {
          ids,
          validatedOnly: onlyValidated,
          validatedStatuses: VALIDATED_STATUSES,
        },
      );
      edges = edgeResult.records.map((r) => ({
        source: r.get("source"),
        target: r.get("target"),
        relationship: r.get("relationship"),
        validationStatus: r.get("validationStatus") ?? null,
      }));
    }

    const labelResult = await s.run(`
      MATCH (n)
      WHERE n.id IS NOT NULL AND NONE(l IN labels(n) WHERE l STARTS WITH '_')
      UNWIND labels(n) AS lab
      RETURN DISTINCT lab
      ORDER BY lab
    `);
    const labels = labelResult.records.map((r) => r.get("lab"));

    const meResult = await s.run(`
      MATCH (n)
      WHERE n.meLevel IS NOT NULL
      RETURN DISTINCT n.meLevel AS meLevel
      ORDER BY meLevel
    `);
    const meLevels = meResult.records.map((r) => r.get("meLevel"));

    return {
      nodes,
      edges,
      labels,
      meLevels,
      filters: {
        q: qNorm,
        label: labelNorm,
        meLevel: meNorm,
        validatedOnly: onlyValidated,
        limit: lim,
      },
      truncated: nodes.length >= lim,
    };
  });
}

const HIERARCHY_EDGE_TYPES = [
  "DECOMPOSES_TO",
  "HAS_APPROACH",
  "NEXT",
  "SATISFIED_BY",
  "PERFORMED_BY",
  "MEASURES",
  "REQUIRES",
  "PERFORMS",
  "HAS_MEASURE",
  "PART_OF",
  "MEMBER_OF",
  "SUPPORTS",
];

const ALLOWED_VALIDATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "draft",
];

/**
 * ME levels 1–7 presence checklist for a KOP.
 */
async function kopChecklist(objectiveId) {
  return withSession(async (s) => {
    const exists = await s.run(
      `
      MATCH (kop:Objective {id: $objectiveId})
      WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
      RETURN kop.id AS id, kop.name AS name
      LIMIT 1
      `,
      { objectiveId },
    );
    if (!exists.records.length) {
      const err = new Error(`KOP not found: ${objectiveId}`);
      err.status = 404;
      throw err;
    }

    const result = await s.run(
      `
      MATCH (kop:Objective {id: $objectiveId})
      WHERE kop.meLevel = 'KOP' OR kop.id STARTS WITH 'KOP-'
      OPTIONAL MATCH (kop)-[:DECOMPOSES_TO]->(ktp:Objective {meLevel: 'KTP'})
      OPTIONAL MATCH (ktp)-[:HAS_APPROACH]->(head:FunctionalCapability)
        WHERE head.missionThread IS NOT NULL
      OPTIONAL MATCH (head)-[:NEXT*0..15]->(fc:FunctionalCapability)
      OPTIONAL MATCH (fc)-[:SATISFIED_BY]->(cs:CapabilitySolution)
      OPTIONAL MATCH (fc)-[:PERFORMED_BY]->(actor:Actor)
      OPTIONAL MATCH (mopM:Measure)-[:MEASURES]->(cs)
      OPTIONAL MATCH (ktpM:Measure)-[:MEASURES]->(ktp)
      OPTIONAL MATCH (kopM:Measure)-[:MEASURES]->(kop)
      RETURN
        collect(DISTINCT kop.id) AS kopIds,
        collect(DISTINCT ktp.id) AS ktpIds,
        collect(DISTINCT head.id) AS approachIds,
        collect(DISTINCT fc.id) AS taskIds,
        collect(DISTINCT cs.id) AS csIds,
        collect(DISTINCT actor.id) AS actorIds,
        collect(DISTINCT mopM.id) + collect(DISTINCT ktpM.id) + collect(DISTINCT kopM.id) AS measureIds
      `,
      { objectiveId },
    );

    const rec = result.records[0];
    const clean = (ids) =>
      [...new Set((ids || []).filter((x) => x != null))].sort();

    const levelDefs = [
      {
        level: 1,
        key: "kop",
        title: "KOP",
        required: true,
        ids: clean(rec.get("kopIds")),
      },
      {
        level: 2,
        key: "ktp",
        title: "KTP (DECOMPOSES_TO)",
        required: true,
        ids: clean(rec.get("ktpIds")),
      },
      {
        level: 3,
        key: "approach",
        title: "Mission thread / approach (HAS_APPROACH)",
        required: true,
        ids: clean(rec.get("approachIds")),
      },
      {
        level: 4,
        key: "task",
        title: "Sequenced FC / task (NEXT chain)",
        required: true,
        ids: clean(rec.get("taskIds")),
      },
      {
        level: 5,
        key: "cs",
        title: "Capability solution (SATISFIED_BY)",
        required: true,
        ids: clean(rec.get("csIds")),
      },
      {
        level: 6,
        key: "actor",
        title: "Actors (PERFORMED_BY)",
        required: true,
        ids: clean(rec.get("actorIds")),
      },
      {
        level: 7,
        key: "measure",
        title: "Measures (MEASURES → CS/KTP/KOP)",
        required: true,
        ids: clean(rec.get("measureIds")),
      },
    ];

    const levels = levelDefs.map((d) => ({
      level: d.level,
      key: d.key,
      title: d.title,
      required: d.required,
      count: d.ids.length,
      ok: d.ids.length > 0,
      ids: d.ids.slice(0, 40),
      truncated: d.ids.length > 40,
    }));

    const missing = levels.filter((l) => l.required && !l.ok).map((l) => l.level);

    return {
      objectiveId,
      kop: {
        id: exists.records[0].get("id"),
        name: exists.records[0].get("name"),
      },
      levels,
      missing,
      complete: missing.length === 0,
    };
  });
}

/**
 * Nodes with no ME hierarchy relationships (in or out).
 */
async function listOrphans({ limit = 200 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return withSession(async (s) => {
    const result = await s.run(
      `
      MATCH (n)
      WHERE n.id IS NOT NULL
        AND NONE(l IN labels(n) WHERE l STARTS WITH '_')
        AND NOT (n)-[:DECOMPOSES_TO|HAS_APPROACH|NEXT|SATISFIED_BY|PERFORMED_BY|MEASURES|REQUIRES|PERFORMS|HAS_MEASURE|PART_OF|MEMBER_OF|SUPPORTS]-()
      RETURN n
      ORDER BY n.id
      LIMIT $limit
      `,
      { limit: neo4j.int(lim) },
    );
    const nodes = result.records.map((r) => serializeNode(r.get("n")));
    return {
      orphans: nodes,
      count: nodes.length,
      truncated: nodes.length >= lim,
      hierarchyRels: HIERARCHY_EDGE_TYPES,
    };
  });
}

async function listByValidationStatus({
  status = "pending",
  scope = "both",
  limit = 200,
} = {}) {
  const st = String(status || "pending").trim().toLowerCase();
  if (!ALLOWED_VALIDATION_STATUSES.includes(st)) {
    const err = new Error(
      `status must be one of: ${ALLOWED_VALIDATION_STATUSES.join(", ")}`,
    );
    err.status = 400;
    throw err;
  }
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const wantNodes = scope === "nodes" || scope === "both";
  const wantRels = scope === "relationships" || scope === "both";

  return withSession(async (s) => {
    let nodes = [];
    let relationships = [];

    if (wantNodes) {
      const nr = await s.run(
        `
        MATCH (n)
        WHERE n.id IS NOT NULL
          AND NONE(l IN labels(n) WHERE l STARTS WITH '_')
          AND toLower(coalesce(n.validationStatus, '')) = $status
        RETURN n
        ORDER BY n.id
        LIMIT $limit
        `,
        { status: st, limit: neo4j.int(lim) },
      );
      nodes = nr.records.map((r) => serializeNode(r.get("n")));
    }

    if (wantRels) {
      const rr = await s.run(
        `
        MATCH (a)-[r]->(b)
        WHERE a.id IS NOT NULL AND b.id IS NOT NULL
          AND toLower(coalesce(r.validationStatus, '')) = $status
        RETURN a.id AS source, b.id AS target, type(r) AS relationship,
               properties(r) AS properties
        ORDER BY type(r), a.id, b.id
        LIMIT $limit
        `,
        { status: st, limit: neo4j.int(lim) },
      );
      relationships = rr.records.map((r) => ({
        source: r.get("source"),
        target: r.get("target"),
        relationship: r.get("relationship"),
        properties: toPlain(r.get("properties") || {}),
      }));
    }

    return {
      status: st,
      scope,
      nodes,
      relationships,
      nodeCount: nodes.length,
      relationshipCount: relationships.length,
    };
  });
}

/**
 * Bulk set validationStatus on nodes and/or relationships.
 * body: { toStatus, fromStatus?, scope?, nodeIds?, relationships?: [{fromId,toId,relationship}] }
 * If nodeIds / relationships omitted and fromStatus set, updates all matching that status.
 */
async function bulkSetValidationStatus(body) {
  const toStatus = String(body.toStatus || "").trim().toLowerCase();
  if (!ALLOWED_VALIDATION_STATUSES.includes(toStatus)) {
    const err = new Error(
      `toStatus must be one of: ${ALLOWED_VALIDATION_STATUSES.join(", ")}`,
    );
    err.status = 400;
    throw err;
  }

  let fromStatus = body.fromStatus
    ? String(body.fromStatus).trim().toLowerCase()
    : null;
  if (fromStatus && !ALLOWED_VALIDATION_STATUSES.includes(fromStatus)) {
    const err = new Error(
      `fromStatus must be one of: ${ALLOWED_VALIDATION_STATUSES.join(", ")}`,
    );
    err.status = 400;
    throw err;
  }

  const scope = body.scope || "both";
  const hasNodeIds = Array.isArray(body.nodeIds);
  const hasRels = Array.isArray(body.relationships);
  const nodeIds = hasNodeIds ? body.nodeIds.map(String).filter(Boolean) : [];
  const rels = hasRels ? body.relationships : [];
  const selectMode = hasNodeIds || hasRels;

  return withSession(async (s) => {
    let nodesUpdated = 0;
    let relationshipsUpdated = 0;

    if (scope === "nodes" || scope === "both") {
      if (selectMode) {
        if (hasNodeIds && nodeIds.length) {
          const r = await s.run(
            `
            MATCH (n)
            WHERE n.id IN $ids
              AND ($fromStatus IS NULL OR toLower(coalesce(n.validationStatus, '')) = $fromStatus)
            SET n.validationStatus = $toStatus,
                n.updatedAt = datetime()
            RETURN count(n) AS c
            `,
            { ids: nodeIds, fromStatus, toStatus },
          );
          nodesUpdated = toPlain(r.records[0].get("c"));
        }
      } else if (fromStatus) {
        const r = await s.run(
          `
          MATCH (n)
          WHERE n.id IS NOT NULL
            AND NONE(l IN labels(n) WHERE l STARTS WITH '_')
            AND toLower(coalesce(n.validationStatus, '')) = $fromStatus
          SET n.validationStatus = $toStatus,
              n.updatedAt = datetime()
          RETURN count(n) AS c
          `,
          { fromStatus, toStatus },
        );
        nodesUpdated = toPlain(r.records[0].get("c"));
      }
    }

    if (scope === "relationships" || scope === "both") {
      if (selectMode) {
        if (hasRels && rels.length) {
          for (const edge of rels) {
            const fromId = edge.fromId || edge.source;
            const toId = edge.toId || edge.target;
            const relType = sanitizeRelType(edge.relationship || edge.type);
            if (!fromId || !toId) continue;
            const r = await s.run(
              `
              MATCH (a {id: $fromId})-[rel:${relType}]->(b {id: $toId})
              WHERE $fromStatus IS NULL OR toLower(coalesce(rel.validationStatus, '')) = $fromStatus
              SET rel.validationStatus = $toStatus,
                  rel.updatedAt = datetime()
              RETURN count(rel) AS c
              `,
              { fromId, toId, fromStatus, toStatus },
            );
            relationshipsUpdated += toPlain(r.records[0].get("c"));
          }
        }
      } else if (fromStatus) {
        const r = await s.run(
          `
          MATCH ()-[rel]->()
          WHERE toLower(coalesce(rel.validationStatus, '')) = $fromStatus
          SET rel.validationStatus = $toStatus,
              rel.updatedAt = datetime()
          RETURN count(rel) AS c
          `,
          { fromStatus, toStatus },
        );
        relationshipsUpdated = toPlain(r.records[0].get("c"));
      }
    }

    if (!selectMode && !fromStatus) {
      const err = new Error(
        "Provide fromStatus (bulk by current status) and/or nodeIds / relationships",
      );
      err.status = 400;
      throw err;
    }

    return {
      toStatus,
      fromStatus,
      scope,
      nodesUpdated,
      relationshipsUpdated,
    };
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function serveStatic(urlPath, res) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, await health());
      return;
    }
    if (req.method === "POST" && url.pathname === "/seed") {
      json(res, 200, await seedDemo());
      return;
    }
    if (req.method === "GET" && url.pathname === "/kops") {
      json(res, 200, { kops: await listKops() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/decomp-roots") {
      const kind = url.searchParams.get("kind") || "KOP";
      json(res, 200, await listDecompRoots(kind));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/decomp/")) {
      const rest = decodeURIComponent(url.pathname.slice("/decomp/".length));
      if (rest.endsWith("/table")) {
        const rootId = rest.slice(0, -"/table".length).replace(/\/$/, "");
        json(res, 200, await decompTable(rootId));
        return;
      }
      json(res, 200, await decompFrom(rest));
      return;
    }
    if (req.method === "POST" && url.pathname === "/nodes") {
      const body = await readBody(req);
      json(res, 201, await createNode(body));
      return;
    }
    if (req.method === "GET" && url.pathname === "/nodes") {
      const q = url.searchParams.get("q") || "";
      const limit = url.searchParams.get("limit") || "500";
      json(res, 200, { nodes: await listAllNodes({ q, limit }) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/relationships") {
      const body = await readBody(req);
      json(res, 201, await createRelationship(body));
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/relationships") {
      const body = await readBody(req);
      json(res, 200, await deleteRelationship(body));
      return;
    }
    if (url.pathname.startsWith("/nodes/")) {
      const rest = decodeURIComponent(url.pathname.slice("/nodes/".length));
      if (!rest) {
        json(res, 400, { error: "bad_request", message: "node id required" });
        return;
      }

      if (rest.endsWith("/relationships") && req.method === "GET") {
        const nodeId = rest.slice(0, -"/relationships".length).replace(/\/$/, "");
        json(res, 200, await listRelationships(nodeId));
        return;
      }
      if (rest.endsWith("/relink") && req.method === "POST") {
        const nodeId = rest.slice(0, -"/relink".length).replace(/\/$/, "");
        const body = await readBody(req);
        json(res, 200, await relinkNode(nodeId, body));
        return;
      }

      const nodeId = rest;
      if (req.method === "GET") {
        json(res, 200, await getNode(nodeId));
        return;
      }
      if (req.method === "PATCH") {
        const body = await readBody(req);
        json(res, 200, await updateNode(nodeId, body));
        return;
      }
      if (req.method === "DELETE") {
        const detachParam = url.searchParams.get("detach");
        const detach =
          detachParam === null || detachParam === ""
            ? true
            : !["0", "false", "no"].includes(String(detachParam).toLowerCase());
        json(res, 200, await deleteNode(nodeId, { detach }));
        return;
      }
    }
    if (req.method === "GET" && url.pathname === "/graph") {
      const validatedParam = url.searchParams.get("validatedOnly");
      const validatedOnly =
        validatedParam != null &&
        !["0", "false", "no", ""].includes(String(validatedParam).toLowerCase());
      json(
        res,
        200,
        await graphSnapshot({
          q: url.searchParams.get("q") || "",
          label: url.searchParams.get("label") || "",
          meLevel: url.searchParams.get("meLevel") || "",
          validatedOnly,
          limit: url.searchParams.get("limit") || "400",
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/graph/nodes") {
      json(res, 200, { nodes: await graphNodes() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/graph/edges") {
      json(res, 200, { edges: await graphEdges() });
      return;
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/validation/checklist/")
    ) {
      const kopId = decodeURIComponent(
        url.pathname.slice("/validation/checklist/".length),
      );
      json(res, 200, await kopChecklist(kopId));
      return;
    }
    if (req.method === "GET" && url.pathname === "/validation/orphans") {
      json(
        res,
        200,
        await listOrphans({ limit: url.searchParams.get("limit") || "200" }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/validation/status") {
      json(
        res,
        200,
        await listByValidationStatus({
          status: url.searchParams.get("status") || "pending",
          scope: url.searchParams.get("scope") || "both",
          limit: url.searchParams.get("limit") || "200",
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/validation/status") {
      const body = await readBody(req);
      json(res, 200, await bulkSetValidationStatus(body));
      return;
    }
    if (req.method === "GET" && serveStatic(url.pathname, res)) {
      return;
    }
    json(res, 404, {
      error: "not_found",
      routes: [
        "GET /",
        "GET /health",
        "GET /kops",
        "GET /decomp-roots?kind=KOP|KTP|FC",
        "GET /decomp/:rootId",
        "GET /decomp/:rootId/table",
        "GET /nodes",
        "GET /nodes/:id",
        "PATCH /nodes/:id",
        "DELETE /nodes/:id",
        "GET /nodes/:id/relationships",
        "POST /nodes/:id/relink",
        "POST /relationships",
        "DELETE /relationships",
        "POST /nodes",
        "GET /graph",
        "GET /validation/checklist/:kopId",
        "GET /validation/orphans",
        "GET /validation/status",
        "POST /validation/status",
        "POST /seed",
        "GET /edit.html",
        "GET /validation.html",
      ],
    });
  } catch (err) {
    json(res, err.status || 500, {
      error:
        err.status === 404
          ? "not_found"
          : err.status === 400
            ? "bad_request"
            : err.status === 409
              ? "conflict"
              : "server_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`decisive-lab neo4j wrapper listening on :${PORT}`);
  console.log(`NEO4J_URI=${URI}`);
  console.log(`UI http://localhost:${PORT}/`);
});

async function shutdown() {
  await driver.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
