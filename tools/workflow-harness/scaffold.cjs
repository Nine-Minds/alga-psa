#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error(`
Scaffold a workflow-harness fixture folder.

Usage:
  node tools/workflow-harness/scaffold.cjs --name <fixtureName> --event <EVENT_NAME> --schema <payloadSchemaRef>

Example:
  node tools/workflow-harness/scaffold.cjs --name ticket-created-demo --event TICKET_CREATED --schema payload.TicketCreated.v1
`);
}

function parseArgs(argv) {
  const args = {};
  let i = 0;
  while (i < argv.length) {
    const t = argv[i];
    if (t === '--help' || t === '-h') {
      args.help = true;
      i += 1;
      continue;
    }
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      args[key] = value;
      i += 2;
      continue;
    }
    i += 1;
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfMissing(filePath, contents) {
  if (fs.existsSync(filePath)) {
    throw new Error(`Refusing to overwrite existing file: ${filePath}`);
  }
  fs.writeFileSync(filePath, contents, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const name = args.name;
  const eventName = args.event;
  const schemaRef = args.schema;
  if (!name) throw new Error('Missing --name');
  if (!eventName) throw new Error('Missing --event');
  if (!schemaRef) throw new Error('Missing --schema');

  const root = path.resolve(process.cwd(), 'ee/test-data/workflow-harness', name);
  ensureDir(root);

  const workflowKey = `fixture.${name}`;
  const bundlePath = path.join(root, 'bundle.json');
  const testPath = path.join(root, 'test.cjs');

  const bundle = {
    format: 'alga-psa.workflow-bundle',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    workflows: [
      {
        key: workflowKey,
        metadata: {
          name: `Fixture: ${name}`,
          description: `Scaffolded fixture for ${eventName}.`,
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
          nodeTypes: ['state.set'],
          schemaRefs: [schemaRef]
        },
        draft: {
          draftVersion: 1,
          definition: {
            id: '00000000-0000-0000-0000-00000000f001',
            version: 1,
            name: `Fixture: ${name}`,
            description: `Scaffolded fixture for ${eventName}.`,
            payloadSchemaRef: schemaRef,
            trigger: { type: 'event', eventName },
            steps: [{ id: 'ready', type: 'state.set', config: { state: 'READY' } }, { id: 'done', type: 'control.return' }]
          }
        },
        publishedVersions: [
          {
            version: 1,
            definition: {
              id: '00000000-0000-0000-0000-00000000f001',
              version: 1,
              name: `Fixture: ${name}`,
              description: `Scaffolded fixture for ${eventName}.`,
              payloadSchemaRef: schemaRef,
              trigger: { type: 'event', eventName },
              steps: [{ id: 'ready', type: 'state.set', config: { state: 'READY' } }, { id: 'done', type: 'control.return' }]
            },
            payloadSchemaJson: null
          }
        ]
      }
    ]
  };

  writeIfMissing(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

  writeIfMissing(
    testPath,
    `const { randomUUID } = require('node:crypto');\n\nmodule.exports = async function run(ctx) {\n  const correlationKey = randomUUID();\n\n  await ctx.http.request('/api/workflow/events', {\n    method: 'POST',\n    json: {\n      eventName: ${JSON.stringify(eventName)},\n      correlationKey,\n      payloadSchemaRef: ${JSON.stringify(schemaRef)},\n      payload: {}\n    }\n  });\n\n  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });\n  ctx.expect.equal(runRow.status, 'SUCCEEDED', 'run status');\n};\n`
  );

  console.log(`Scaffolded: ${root}`);
}

main().catch((err) => {
  console.error(err?.stack ?? err?.message ?? String(err));
  usage();
  process.exit(1);
});

