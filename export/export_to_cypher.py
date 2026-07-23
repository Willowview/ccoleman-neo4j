#!/usr/bin/env python3
"""
Export CFTv3 tabular graph data from Postgres to Neo4j Cypher.

Reads cftv3.graph_nodes / cftv3.graph_edges (see schema/01_schema.sql) and
writes an idempotent .cypher file for Neo4j Community Edition import.

Usage:
  export DATABASE_URL=postgresql://cftv3:cftv3@localhost:5433/cftv3
  python export_to_cypher.py -o out/import.cypher

  # or:
  python export_to_cypher.py \\
    --host localhost --port 5433 --dbname cftv3 --user cftv3 --password cftv3 \\
    -o out/import.cypher
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from uuid import UUID

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    print(
        "Missing dependency: pip install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv() -> bool:  # type: ignore[misc]
        return False


# ---------------------------------------------------------------------------
# Ontology contract (Neo4j side)
# ---------------------------------------------------------------------------

NODE_LABELS: frozenset[str] = frozenset(
    {
        "Objective",
        "FunctionalCapability",
        "CapabilitySolution",
        "Actor",
        "Project",
        "Measure",
        "Artifact",
    }
)

# Allowed relationships from the CFTv3 matrix (warn, don't hard-fail, on unknown).
ALLOWED_RELATIONSHIPS: frozenset[str] = frozenset(
    {
        "CONTAINS",
        "MEMBER_OF",
        "PART_OF",
        "EMPLOYS",
        "OWNS_EMPLOYMENT",
        "OWNS_PRODUCTION",
        "OWNS_RESOURCING",
        "OWNS_SPONSORSHIP",
        "OWNS_TECHNICAL",
        "OWNS_MANAGEMENT",
        "PARTICIPATES_IN",
        "INTEROPERABLE_WITH",
        "PERFORMS",
        "HAS_MEASURE",
        "DECOMPOSES_TO",
        "EVALUATED_BY",
        "SELECTS_MVC",
        "SUPPORTS",
        "REQUIRES",
        "DEMANDS",
        "DESCRIBES",
    }
)

# Edges that should always carry hygiene props when present.
HYGIENE_EDGE_TYPES: frozenset[str] = frozenset({"PERFORMS"})

# Postgres snake_case common columns → Neo4j camelCase properties.
COMMON_COLUMN_MAP: dict[str, str] = {
    "id": "id",
    "name": "name",
    "aliases": "aliases",
    "created_at": "createdAt",
    "updated_at": "updatedAt",
    "validation_status": "validationStatus",
    "validated_by": "validatedBy",
    "validated_at": "validatedAt",
    "confidence": "confidence",
}

EDGE_HYGIENE_COLUMN_MAP: dict[str, str] = {
    "validation_status": "validationStatus",
    "confidence": "confidence",
}


# ---------------------------------------------------------------------------
# Cypher literal helpers
# ---------------------------------------------------------------------------

def cypher_escape_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def cypher_literal(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            raise ValueError(f"Non-finite float cannot be emitted: {value}")
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        # Prefer timezone-aware ISO; Neo4j datetime() accepts ISO-8601.
        iso = value.isoformat()
        return f"datetime({cypher_escape_string(iso)})"
    if isinstance(value, date):
        return f"date({cypher_escape_string(value.isoformat())})"
    if isinstance(value, UUID):
        return cypher_escape_string(str(value))
    if isinstance(value, (list, tuple)):
        inner = ", ".join(cypher_literal(v) for v in value)
        return f"[{inner}]"
    if isinstance(value, dict):
        # Nested maps are rare; emit as JSON string to stay CE-safe/simple.
        return cypher_escape_string(json.dumps(value, default=str))
    return cypher_escape_string(str(value))


def set_clause(alias: str, props: Mapping[str, Any]) -> str:
    parts = [f"{alias}.{key} = {cypher_literal(val)}" for key, val in props.items()]
    return ",\n    ".join(parts)


# ---------------------------------------------------------------------------
# Row → property bag
# ---------------------------------------------------------------------------

def node_properties(row: Mapping[str, Any]) -> dict[str, Any]:
    props: dict[str, Any] = {}
    for col, neo_key in COMMON_COLUMN_MAP.items():
        if col == "id":
            continue  # used in MERGE key
        if col not in row:
            continue
        val = row[col]
        if val is None:
            continue
        if col == "aliases" and val == []:
            continue
        props[neo_key] = val

    extra = row.get("properties") or {}
    if isinstance(extra, str):
        extra = json.loads(extra)
    if not isinstance(extra, dict):
        raise TypeError(f"properties must be a JSON object for node {row.get('id')}")

    for key, val in extra.items():
        if val is None:
            continue
        # Prefer camelCase keys already; leave as-is (schema contract).
        props[str(key)] = val

    return props


def edge_properties(row: Mapping[str, Any]) -> dict[str, Any]:
    props: dict[str, Any] = {}
    for col, neo_key in EDGE_HYGIENE_COLUMN_MAP.items():
        val = row.get(col)
        if val is not None:
            props[neo_key] = val

    extra = row.get("properties") or {}
    if isinstance(extra, str):
        extra = json.loads(extra)
    if isinstance(extra, dict):
        for key, val in extra.items():
            if val is not None:
                props[str(key)] = val

    # Stamping defaults for hygiene edges if columns were null.
    rel = row["relationship"]
    if rel in HYGIENE_EDGE_TYPES:
        props.setdefault("validationStatus", "pending")
        if "confidence" not in props:
            props["confidence"] = 0.0
    elif props.get("validationStatus") is None and props.get("confidence") is None:
        # Authored/seeded edges: stamp as settled facts when nothing provided.
        props["validationStatus"] = "validated"
        props["confidence"] = 1.0

    return props


# ---------------------------------------------------------------------------
# Emitters
# ---------------------------------------------------------------------------

def emit_constraints() -> list[str]:
    lines: list[str] = ["// === Constraints (idempotent) ==="]
    for label in sorted(NODE_LABELS):
        lines.append(
            f"CREATE CONSTRAINT {label.lower()}_id IF NOT EXISTS\n"
            f"FOR (n:{label}) REQUIRE n.id IS UNIQUE;"
        )
    return lines


def emit_node(row: Mapping[str, Any]) -> str:
    label = row["label"]
    node_id = row["id"]
    props = node_properties(row)
    body = set_clause("n", props)
    return (
        f"MERGE (n:{label} {{id: {cypher_literal(node_id)}}})\n"
        f"SET {body};"
    )


def emit_edge(row: Mapping[str, Any]) -> str:
    rel = row["relationship"]
    props = edge_properties(row)
    src = cypher_literal(row["source_id"])
    tgt = cypher_literal(row["target_id"])
    set_body = set_clause("r", props) if props else None
    stmt = (
        f"MATCH (a {{id: {src}}})\n"
        f"MATCH (b {{id: {tgt}}})\n"
        f"MERGE (a)-[r:{rel}]->(b)"
    )
    if set_body:
        stmt += f"\nSET {set_body}"
    return stmt + ";"


def build_cypher(
    nodes: Sequence[Mapping[str, Any]],
    edges: Sequence[Mapping[str, Any]],
    *,
    warn: bool = True,
) -> str:
    warnings: list[str] = []
    sections: list[str] = [
        "// Auto-generated by export_to_cypher.py — Neo4j Community Edition",
        "// Import order: constraints → nodes → relationships",
        "",
    ]
    sections.extend(emit_constraints())
    sections.append("")
    sections.append("// === Nodes ===")

    for row in nodes:
        label = row["label"]
        if label not in NODE_LABELS:
            msg = f"Unknown node label '{label}' for id={row['id']}"
            if warn:
                warnings.append(msg)
            else:
                raise ValueError(msg)
            continue
        sections.append(emit_node(row))
        sections.append("")

    sections.append("// === Relationships ===")
    for row in edges:
        rel = row["relationship"]
        if rel not in ALLOWED_RELATIONSHIPS:
            msg = (
                f"Unknown relationship '{rel}' "
                f"({row['source_id']} → {row['target_id']})"
            )
            if warn:
                warnings.append(msg)
            else:
                raise ValueError(msg)
        sections.append(emit_edge(row))
        sections.append("")

    if warnings:
        header = ["// === Warnings from export ==="]
        header.extend(f"// WARN: {w}" for w in warnings)
        header.append("")
        sections = header + sections
        for w in warnings:
            print(f"WARN: {w}", file=sys.stderr)

    return "\n".join(sections).rstrip() + "\n"


# ---------------------------------------------------------------------------
# DB access
# ---------------------------------------------------------------------------

def connect_kwargs(args: argparse.Namespace) -> dict[str, Any]:
    if args.database_url:
        return {"conninfo": args.database_url}
    return {
        "host": args.host,
        "port": args.port,
        "dbname": args.dbname,
        "user": args.user,
        "password": args.password,
    }


def fetch_graph(conn: psycopg.Connection) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    schema = "cftv3"
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            SELECT id, label, name, aliases, created_at, updated_at,
                   validation_status, validated_by, validated_at, confidence,
                   properties
            FROM {schema}.graph_nodes
            ORDER BY label, id
            """
        )
        nodes = list(cur.fetchall())
        cur.execute(
            f"""
            SELECT source_id, target_id, relationship,
                   validation_status, confidence, properties
            FROM {schema}.graph_edges
            ORDER BY relationship, source_id, target_id
            """
        )
        edges = list(cur.fetchall())
    return nodes, edges


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("out/import.cypher"),
        help="Output .cypher path (default: out/import.cypher)",
    )
    p.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres URL (or set DATABASE_URL)",
    )
    p.add_argument("--host", default=os.environ.get("PGHOST", "localhost"))
    p.add_argument("--port", type=int, default=int(os.environ.get("PGPORT", "5433")))
    p.add_argument("--dbname", default=os.environ.get("PGDATABASE", "cftv3"))
    p.add_argument("--user", default=os.environ.get("PGUSER", "cftv3"))
    p.add_argument("--password", default=os.environ.get("PGPASSWORD", "cftv3"))
    p.add_argument(
        "--strict",
        action="store_true",
        help="Fail on unknown labels/relationships instead of warning",
    )
    return p.parse_args(list(argv) if argv is not None else None)


def main(argv: Iterable[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(argv)
    kwargs = connect_kwargs(args)

    try:
        with psycopg.connect(**kwargs) as conn:
            nodes, edges = fetch_graph(conn)
    except psycopg.Error as exc:
        print(f"Postgres error: {exc}", file=sys.stderr)
        return 1

    cypher = build_cypher(nodes, edges, warn=not args.strict)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(cypher, encoding="utf-8")
    print(
        f"Wrote {args.output} "
        f"({len(nodes)} nodes, {len(edges)} relationships)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
