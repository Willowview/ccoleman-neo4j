-- Sample CFTv3 graph covering all 7 node types and key relationships.
-- Load after 01_schema.sql. Safe to re-run after TRUNCATE.

BEGIN;

SET search_path TO cftv3, public;

TRUNCATE graph_edges, graph_nodes CASCADE;

-- ---------------------------------------------------------------------------
-- Nodes
-- ---------------------------------------------------------------------------

INSERT INTO graph_nodes (
  id, label, name, aliases, created_at, updated_at,
  validation_status, validated_by, validated_at, confidence, properties
) VALUES
(
  'OBJ-0001', 'Objective', 'Close long-range kill fires',
  ARRAY['KOP-LRKF'],
  '2026-01-10T12:00:00Z', '2026-01-10T12:00:00Z',
  'validated', 'seed', '2026-01-10T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Close long-range kill fires with joint forces',
    'source', 'ME Mission Thread Handbook (seed)',
    'meLevel', 'KOP'
  )
),
(
  'OBJ-0002', 'Objective', 'Fuse SOF edge sensors',
  ARRAY['KTP-SOF-SENSORS'],
  '2026-01-10T12:00:00Z', '2026-01-10T12:00:00Z',
  'validated', 'seed', '2026-01-10T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Fuse SOF edge sensors into joint kill chains',
    'source', 'ME Mission Thread Handbook (seed)',
    'meLevel', 'KTP'
  )
),
(
  'OBJ-0003', 'Objective', 'Edge sensor fusion vignette',
  ARRAY[]::text[],
  '2026-01-10T12:00:00Z', '2026-01-10T12:00:00Z',
  'validated', 'seed', '2026-01-10T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Vignette: operator fuses edge ISR into a joint fire mission',
    'source', 'ME Mission Thread Handbook (seed)',
    'meLevel', 'vignette'
  )
),
(
  'FCAP-0001', 'FunctionalCapability', 'Sensor data fusion',
  ARRAY['Fuse edge ISR'],
  '2026-01-11T12:00:00Z', '2026-01-11T12:00:00Z',
  'validated', 'seed', '2026-01-11T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Ability to fuse multi-source edge sensor data for targeting',
    'warfighterFunctions', ARRAY['intelligence', 'fires', 'command_and_control'],
    'bowtieFunctions', ARRAY['sense', 'data_fusion', 'c2'],
    'jcsfl', ARRAY['JCSFL-STUB-001']
  )
),
(
  'FCAP-0002', 'FunctionalCapability', 'Joint fires coordination',
  ARRAY[]::text[],
  '2026-01-11T12:00:00Z', '2026-01-11T12:00:00Z',
  'validated', 'seed', '2026-01-11T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Ability to coordinate joint fires across components',
    'warfighterFunctions', ARRAY['fires', 'command_and_control'],
    'bowtieFunctions', ARRAY['c2', 'effect'],
    'jcsfl', ARRAY['JCSFL-STUB-002']
  )
),
(
  'CSOL-0001', 'CapabilitySolution', 'Gaia',
  ARRAY['Palantir Gaia'],
  '2026-01-12T12:00:00Z', '2026-01-12T12:00:00Z',
  'validated', 'seed', '2026-01-12T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Command and control / COP platform',
    'mvcStatus', true,
    'fieldMaturityLevel', 'employed',
    'trl', 7,
    'tags', ARRAY['c2', 'cop'],
    'dataInteroperability', ARRAY['JSON', 'Cursor-on-Target'],
    'appInteroperability', ARRAY['TAK'],
    'hasCapabilityCard', true,
    'currentAto', false
  )
),
(
  'CSOL-0002', 'CapabilitySolution', 'Data Foundry',
  ARRAY[]::text[],
  '2026-01-12T12:00:00Z', '2026-01-12T12:00:00Z',
  'validated', 'seed', '2026-01-12T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Data integration and analytics platform',
    'mvcStatus', true,
    'fieldMaturityLevel', 'employed',
    'trl', 8,
    'tags', ARRAY['data', 'analytics'],
    'dataInteroperability', ARRAY['JSON', 'Parquet'],
    'appInteroperability', ARRAY['Gaia'],
    'hasCapabilityCard', true,
    'currentAto', false
  )
),
(
  'ACTR-0001', 'Actor', 'SOCOM',
  ARRAY['USSOCOM'],
  '2026-01-08T12:00:00Z', '2026-01-08T12:00:00Z',
  'validated', 'seed', '2026-01-08T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'United States Special Operations Command',
    'fullName', 'United States Special Operations Command',
    'type', 'organization',
    'orgType', 'military_command'
  )
),
(
  'ACTR-0002', 'Actor', 'PEO SDA',
  ARRAY[]::text[],
  '2026-01-08T12:00:00Z', '2026-01-08T12:00:00Z',
  'validated', 'seed', '2026-01-08T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Program Executive Office - SOF Digital Applications',
    'fullName', 'Program Executive Office - SOF Digital Applications',
    'type', 'organization',
    'orgType', 'military_command'
  )
),
(
  'ACTR-0003', 'Actor', 'Tom Duley',
  ARRAY[]::text[],
  '2026-01-08T12:00:00Z', '2026-01-08T12:00:00Z',
  'validated', 'seed', '2026-01-08T12:00:00Z', 1.0,
  jsonb_build_object(
    'fullName', 'Tom Duley',
    'type', 'person',
    'role', 'Technical Lead',
    'organizationAffiliation', 'BlackHorse Solutions'
  )
),
(
  'ACTR-0004', 'Actor', 'BlackHorse Solutions',
  ARRAY['BHS'],
  '2026-01-08T12:00:00Z', '2026-01-08T12:00:00Z',
  'validated', 'seed', '2026-01-08T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Defense contractor',
    'fullName', 'BlackHorse Solutions',
    'type', 'organization',
    'orgType', 'vendor'
  )
),
(
  'PROJ-0001', 'Project', 'Sonic Spear 26',
  ARRAY['SS26'],
  '2026-01-09T12:00:00Z', '2026-01-09T12:00:00Z',
  'validated', 'seed', '2026-01-09T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Sonic Spear capability development and integration for 2026',
    'fullName', 'Sonic Spear 2026',
    'status', 'active',
    'startDate', '2026-04-14T00:00:00Z',
    'endDate', '2026-12-31T00:00:00Z',
    'projectType', 'experiment'
  )
),
(
  'MEAS-0001', 'Measure', 'Sensor fusion latency',
  ARRAY[]::text[],
  '2026-01-13T12:00:00Z', '2026-01-13T12:00:00Z',
  'validated', 'seed', '2026-01-13T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'End-to-end latency from edge sensor ingest to fused track',
    'type', ARRAY['MOP', 'TPM'],
    'value', 2500,
    'unit', 'milliseconds'
  )
),
(
  'ARTI-0001', 'Artifact', 'Gaia capability card',
  ARRAY[]::text[],
  '2026-01-14T12:00:00Z', '2026-01-14T12:00:00Z',
  'validated', 'seed', '2026-01-14T12:00:00Z', 1.0,
  jsonb_build_object(
    'description', 'Capability card PDF for Gaia',
    'version', '1.0',
    'sourceUrl', 'https://example.invalid/artifacts/gaia-card.pdf',
    'lastSynced', '2026-01-14T12:00:00Z',
    'classification', 'unclass'
  )
);

-- ---------------------------------------------------------------------------
-- Edges
-- ---------------------------------------------------------------------------

INSERT INTO graph_edges (
  source_id, target_id, relationship,
  validation_status, confidence, properties
) VALUES
-- Objective hierarchy: KOP → KTP → vignette
('OBJ-0001', 'OBJ-0002', 'DECOMPOSES_TO', 'validated', 1.0, '{}'::jsonb),
('OBJ-0002', 'OBJ-0003', 'DECOMPOSES_TO', 'validated', 1.0, '{}'::jsonb),

-- Vignette requires functional capabilities
('OBJ-0003', 'FCAP-0001', 'REQUIRES', 'validated', 1.0, '{}'::jsonb),
('OBJ-0003', 'FCAP-0002', 'REQUIRES', 'validated', 1.0, '{}'::jsonb),

-- FC decomposition
('FCAP-0002', 'FCAP-0001', 'DECOMPOSES_TO', 'validated', 1.0, '{}'::jsonb),

-- AI-asserted PERFORMS (edge hygiene: pending + model confidence)
('CSOL-0001', 'FCAP-0001', 'PERFORMS', 'pending', 0.82, '{}'::jsonb),
('CSOL-0001', 'FCAP-0002', 'PERFORMS', 'pending', 0.71, '{}'::jsonb),
('CSOL-0002', 'FCAP-0001', 'PERFORMS', 'pending', 0.90, '{}'::jsonb),

-- Solution interoperability
('CSOL-0001', 'CSOL-0002', 'INTEROPERABLE_WITH', 'validated', 1.0, '{}'::jsonb),

-- Project selects MVC + supports objective
('PROJ-0001', 'CSOL-0001', 'SELECTS_MVC', 'validated', 1.0, '{}'::jsonb),
('PROJ-0001', 'OBJ-0001', 'SUPPORTS', 'validated', 1.0, '{}'::jsonb),

-- Actor structure + ownership
('ACTR-0002', 'ACTR-0001', 'PART_OF', 'validated', 1.0, '{}'::jsonb),
('ACTR-0003', 'ACTR-0004', 'MEMBER_OF', 'validated', 1.0, '{}'::jsonb),
('ACTR-0001', 'CSOL-0001', 'OWNS_EMPLOYMENT', 'validated', 1.0, '{}'::jsonb),
('ACTR-0002', 'CSOL-0001', 'OWNS_TECHNICAL', 'validated', 1.0, '{}'::jsonb),
('ACTR-0002', 'PROJ-0001', 'OWNS_MANAGEMENT', 'validated', 1.0, '{}'::jsonb),
('ACTR-0003', 'PROJ-0001', 'PARTICIPATES_IN', 'validated', 1.0, '{}'::jsonb),

-- Measures + artifacts
('CSOL-0001', 'MEAS-0001', 'HAS_MEASURE', 'validated', 1.0, '{}'::jsonb),
('FCAP-0001', 'MEAS-0001', 'EVALUATED_BY', 'validated', 1.0, '{}'::jsonb),
('ARTI-0001', 'CSOL-0001', 'DESCRIBES', 'validated', 1.0, '{}'::jsonb);

COMMIT;
