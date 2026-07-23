-- CFTv3 tabular graph schema (target 7-node ontology)
-- Common fields are columns; type-specific attributes live in properties JSONB.
-- When Supabase settles, adjust column names here and/or the exporter COLUMN_MAP.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS cftv3;
SET search_path TO cftv3, public;

CREATE TABLE graph_nodes (
  id                  TEXT PRIMARY KEY,          -- OBJ-0001, FCAP-0001, CSOL-0001, ...
  label               TEXT NOT NULL,             -- Neo4j label (PascalCase)
  name                TEXT NOT NULL,
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  validation_status   TEXT NOT NULL DEFAULT 'validated'
                        CHECK (validation_status IN ('validated', 'pending')),
  validated_by        TEXT,
  validated_at        TIMESTAMPTZ,
  confidence          DOUBLE PRECISION
                        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  properties          JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT graph_nodes_label_chk CHECK (label IN (
    'Objective',
    'FunctionalCapability',
    'CapabilitySolution',
    'Actor',
    'Project',
    'Measure',
    'Artifact'
  )),
  CONSTRAINT graph_nodes_id_prefix_chk CHECK (
    (label = 'Objective'             AND id LIKE 'OBJ-%')  OR
    (label = 'FunctionalCapability'  AND id LIKE 'FCAP-%') OR
    (label = 'CapabilitySolution'    AND id LIKE 'CSOL-%') OR
    (label = 'Actor'                 AND id LIKE 'ACTR-%') OR
    (label = 'Project'               AND id LIKE 'PROJ-%') OR
    (label = 'Measure'               AND id LIKE 'MEAS-%') OR
    (label = 'Artifact'              AND id LIKE 'ARTI-%')
  )
);

CREATE INDEX idx_graph_nodes_label ON graph_nodes (label);
CREATE INDEX idx_graph_nodes_properties ON graph_nodes USING gin (properties);

CREATE TABLE graph_edges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           TEXT NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
  target_id           TEXT NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
  relationship        TEXT NOT NULL,             -- SCREAMING_SNAKE Neo4j rel type
  -- Edge hygiene (required in practice for PERFORMS; optional elsewhere)
  validation_status   TEXT
                        CHECK (validation_status IS NULL
                               OR validation_status IN ('validated', 'pending')),
  confidence          DOUBLE PRECISION
                        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  properties          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_graph_edges_source ON graph_edges (source_id);
CREATE INDEX idx_graph_edges_target ON graph_edges (target_id);
CREATE INDEX idx_graph_edges_rel ON graph_edges (relationship);

COMMENT ON TABLE graph_nodes IS 'Tabular graph nodes conforming to CFTv3 7-node ontology';
COMMENT ON TABLE graph_edges IS 'Tabular graph edges; PERFORMS carries confidence + validation_status';
COMMENT ON COLUMN graph_nodes.properties IS 'Type-specific attributes only (camelCase keys preferred)';
COMMENT ON COLUMN graph_edges.properties IS 'Optional extra edge attributes beyond hygiene columns';

COMMIT;
