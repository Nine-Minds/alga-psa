#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PLAN_DIR = path.resolve(
  process.cwd(),
  'ee/docs/plans/2026-01-26-workflow-harness-fixture-suite'
);
const DEFAULT_FIXTURE_ROOT = path.resolve(process.cwd(), 'ee/test-data/workflow-harness');
const SCHEMA_REGISTRY_PATH = path.resolve(
  process.cwd(),
  'shared/workflow/runtime/schemas/workflowEventPayloadSchemas.ts'
);

function usage() {
  console.error(`
Generate scaffolded fixture folders for the workflow harness, based on the plan's tests.json.

Usage:
  node tools/workflow-harness/generate-fixture-catalog.cjs [--plan-dir <dir>] [--fixtures-root <dir>] [--dry-run]

Notes:
  - Only creates missing fixture folders.
  - Marks scaffolded fixtures with a .scaffolded file.
`);
}

function parseArgs(argv) {
  const args = { planDir: DEFAULT_PLAN_DIR, fixturesRoot: DEFAULT_FIXTURE_ROOT, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--help' || t === '-h') args.help = true;
    else if (t === '--dry-run') args.dryRun = true;
    else if (t === '--plan-dir') args.planDir = argv[++i];
    else if (t === '--fixtures-root') args.fixturesRoot = argv[++i];
  }
  return args;
}

function pascalFromEventName(eventName) {
  return String(eventName)
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function listKnownSchemaRefs() {
  const text = fs.readFileSync(SCHEMA_REGISTRY_PATH, 'utf8');
  const matches = [...text.matchAll(/'payload\\.([A-Za-z0-9]+)\\.v1'/g)].map(
    (m) => `payload.${m[1]}.v1`
  );
  return new Set(matches);
}

function stableWorkflowUuidFromFixtureName(fixtureName) {
  const hash = crypto.createHash('sha256').update(`fixture:${fixtureName}`).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function makeBundle({ fixtureName, eventName, schemaRef }) {
  const workflowKey = `fixture.${fixtureName}`;
  const workflowId = stableWorkflowUuidFromFixtureName(fixtureName);
  const pretty = fixtureName
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');

  const definition = {
    id: workflowId,
    version: 1,
    name: `Fixture: ${pretty}`,
    description: `Scaffolded catalog fixture for ${eventName}.`,
    payloadSchemaRef: schemaRef,
    trigger: { type: 'event', eventName },
    steps: [
      { id: 'ready', type: 'state.set', config: { state: 'READY' } },
      {
        id: 'assign-marker',
        type: 'transform.assign',
        config: {
          assign: {
            'vars.marker': { $expr: `'[fixture ${fixtureName}]'` }
          }
        }
      },
      { id: 'done', type: 'control.return' }
    ]
  };

  return {
    format: 'alga-psa.workflow-bundle',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    workflows: [
      {
        key: workflowKey,
        metadata: {
          name: `Fixture: ${pretty}`,
          description: `Scaffolded catalog fixture for ${eventName}.`,
          payloadSchemaRef: schemaRef,
          payloadSchemaMode: 'pinned',
          pinnedPayloadSchemaRef: schemaRef,
          trigger: { type: 'event', eventName },
          isSystem: false,
          isVisible: true,
          isPaused: false,
          concurrencyLimit: null,
          autoPauseOnFailure: false,
          failureRateThreshold: null,
          failureRateMinRuns: null,
          retentionPolicyOverride: null
        },
        dependencies: {
          actions: [],
          nodeTypes: ['state.set', 'transform.assign'],
          schemaRefs: [schemaRef]
        },
        draft: { draftVersion: 1, definition },
        publishedVersions: [{ version: 1, definition, payloadSchemaJson: null }]
      }
    ]
  };
}

function ensureDir(dir, { dryRun }) {
  if (dryRun) return;
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, contents, { dryRun }) {
  if (dryRun) return;
  fs.writeFileSync(filePath, contents, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const planDir = path.resolve(args.planDir);
  const fixturesRoot = path.resolve(args.fixturesRoot);
  const testsPath = path.join(planDir, 'tests.json');
  if (!fs.existsSync(testsPath)) {
    throw new Error(`tests.json not found: ${testsPath}`);
  }

  const knownSchemaRefs = listKnownSchemaRefs();
  const tests = JSON.parse(fs.readFileSync(testsPath, 'utf8'));
  const fixtureByName = new Map();
  for (const t of tests) {
    if (!t.fixture || !t.eventType) continue;
    if (!fixtureByName.has(t.fixture)) {
      fixtureByName.set(t.fixture, t.eventType);
    }
  }

  let created = 0;
  for (const [fixtureName, eventName] of fixtureByName.entries()) {
    const dir = path.join(fixturesRoot, fixtureName);
    if (fs.existsSync(dir)) continue;

    const computedSchemaRef = `payload.${pascalFromEventName(eventName)}.v1`;
    const schemaRef = knownSchemaRefs.has(computedSchemaRef) ? computedSchemaRef : 'payload.TicketCreated.v1';

    ensureDir(dir, { dryRun: args.dryRun });
    writeFile(path.join(dir, '.scaffolded'), `createdBy=generate-fixture-catalog\n`, { dryRun: args.dryRun });
    writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(makeBundle({ fixtureName, eventName, schemaRef }), null, 2)}\n`, { dryRun: args.dryRun });
    writeFile(
      path.join(dir, 'test.cjs'),
      `const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');\n\nmodule.exports = async function run(ctx) {\n  return runScaffoldedFixture(ctx, {\n    fixtureName: ${JSON.stringify(fixtureName)},\n    eventName: ${JSON.stringify(eventName)},\n    schemaRef: ${JSON.stringify(schemaRef)}\n  });\n};\n`,
      { dryRun: args.dryRun }
    );
    created += 1;
  }

  console.log(`Created ${created} scaffolded fixture(s) under ${fixturesRoot}${args.dryRun ? ' (dry-run)' : ''}.`);
}

try {
  main();
} catch (err) {
  console.error(err?.stack ?? err?.message ?? String(err));
  usage();
  process.exit(1);
}

