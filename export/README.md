# CFTv3 Postgres → Neo4j Cypher export

Generic exporter that reads tabular graph tables (`cftv3.graph_nodes` /
`cftv3.graph_edges`) shaped for the **7-node target ontology** and writes an
idempotent `.cypher` file for Neo4j Community Edition.

```
export/
  export_to_cypher.py          # exporter CLI
  requirements.txt
  docker-compose.postgres.yml  # sample Postgres with schema + seed
  schema/
    01_schema.sql              # target tabular schema
    02_seed.sql                # sample dump covering all 7 types
  out/                         # generated cypher (gitignored)
```

## Quick start

```bash
cd neo4j-decisive-lab/export

# 1. Start sample Postgres (loads schema + seed on first boot)
docker compose -f docker-compose.postgres.yml up -d

# 2. Install deps + export
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python export_to_cypher.py -o out/import.cypher

# 3. Import into Neo4j (parent compose: Browser :7475, Bolt :7688)
#    In Neo4j Browser, paste/run out/import.cypher
#    or:
# docker exec -i neo4j-decisive-dev cypher-shell -u neo4j -p decisive-dev-password < out/import.cypher
```

Default DB connection: `postgresql://cftv3:cftv3@localhost:5433/cftv3`  
Override with `DATABASE_URL` or `--host/--port/--user/--password/--dbname`.

## Schema contract

| Table | Role |
|---|---|
| `graph_nodes` | One row per node; `label` = Neo4j label; common fields as columns; type-specific attrs in `properties` JSONB |
| `graph_edges` | `source_id` → `target_id` with `relationship`; optional `validation_status` / `confidence` for edge hygiene |

ID prefixes: `OBJ-` / `FCAP-` / `CSOL-` / `ACTR-` / `PROJ-` / `MEAS-` / `ARTI-`

When Supabase settles, keep the exporter’s Cypher emission and remap only the
SQL `SELECT`s (or rename columns to match this schema).

## Reload seed

```bash
docker compose -f docker-compose.postgres.yml exec -T postgres \
  psql -U cftv3 -d cftv3 < schema/02_seed.sql
```

## Reset sample Postgres volume

Init scripts only run on first empty data dir:

```bash
docker compose -f docker-compose.postgres.yml down -v
docker compose -f docker-compose.postgres.yml up -d
```
