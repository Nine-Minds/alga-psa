#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * One-time upgrader for scaffolded workflow-harness fixtures.
 *
 * Converts fixtures whose `test.cjs` uses `_lib/scaffolded-fixture.cjs` into
 * business-valid notification-based fixtures with deterministic DB assertions.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../ee/test-data/workflow-harness');

const CALLWORKFLOW_FIXTURES = new Set([
  'invoice-overdue-callworkflow-dunning',
  'project-created-callworkflow-tasks',
  'project-task-completed-callworkflow',
  'ticket-created-call-notify-subworkflow',
  'ticket-created-call-triage-subworkflow',
  'ticket-created-callworkflow-onboarding',
  'ticket-created-two-subworkflows',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function pascalCaseEvent(eventName) {
  return String(eventName)
    .trim()
    .toLowerCase()
    .split(/_+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function schemaRefForEvent(eventName) {
  return `payload.${pascalCaseEvent(eventName)}.v1`;
}

function titleFromFixtureName(fixtureName) {
  return String(fixtureName)
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function choosePattern(fixtureName) {
  if (CALLWORKFLOW_FIXTURES.has(fixtureName)) return 'callWorkflow';
  if (fixtureName.includes('trycatch')) return 'tryCatch';
  if (fixtureName.includes('foreach')) return 'forEach';
  if (fixtureName.includes('idempotent')) return 'idempotent';
  if (fixtureName.includes('multi-branch')) return 'multiBranch';
  return 'default';
}

function buildDependenciesNodeTypes(pattern) {
  const base = ['action.call', 'control.return', 'state.set', 'transform.assign'];
  if (pattern === 'forEach') return [...base, 'control.forEach'];
  if (pattern === 'tryCatch') return [...base, 'control.tryCatch'];
  if (pattern === 'multiBranch') return [...base, 'control.if'];
  if (pattern === 'idempotent') return [...base, 'control.if'];
  if (pattern === 'default') return [...base, 'control.if'];
  if (pattern === 'callWorkflow') return [...base, 'control.callWorkflow'];
  return base;
}

function notificationCallStep({ fixtureName, titleExpr, bodyExpr, recipientsExpr, dedupeExpr }) {
  return {
    id: 'notify',
    type: 'action.call',
    config: {
      actionId: 'notifications.send_in_app',
      version: 1,
      inputMapping: {
        recipients: { $expr: recipientsExpr },
        title: { $expr: titleExpr },
        body: { $expr: bodyExpr },
        severity: 'info',
        dedupe_key: { $expr: dedupeExpr ?? `'fixture.${fixtureName}:' & payload.fixtureDedupeKey` },
      },
    },
  };
}

function buildSteps({ fixtureName, pattern }) {
  const markerLiteral = `[fixture ${fixtureName}]`;

  if (pattern === 'forEach') {
    return [
      { id: 'state-fixture', type: 'state.set', config: { state: 'FIXTURE' } },
      {
        id: 'assign-text',
        type: 'transform.assign',
        config: {
          assign: {
            'vars.marker': { $expr: `'${markerLiteral}'` },
            'vars.title': { $expr: `'${markerLiteral} ForEach notify'` },
            'vars.body': { $expr: `'${markerLiteral} dedupe=' & payload.fixtureDedupeKey` },
          },
        },
      },
      {
        id: 'for-each-item',
        type: 'control.forEach',
        items: {
          $expr:
            '[{ "i": 0, "userId": payload.fixtureNotifyUserId }, { "i": 1, "userId": payload.fixtureNotifyUserId }]',
        },
        itemVar: 'item',
        body: [
          notificationCallStep({
            fixtureName,
            recipientsExpr: '{ "user_ids": [vars.item.userId] }',
            titleExpr: `vars.title & ' #' & vars.item.i`,
            bodyExpr: `vars.body & ' item=' & vars.item.i`,
            dedupeExpr: `'fixture.${fixtureName}:' & payload.fixtureDedupeKey & ':' & vars.item.i`,
          }),
        ],
        onItemError: fixtureName.includes('onitemerror-continue') ? 'continue' : 'fail',
      },
      { id: 'done', type: 'control.return' },
    ];
  }

  if (pattern === 'tryCatch') {
    return [
      { id: 'state-fixture', type: 'state.set', config: { state: 'FIXTURE' } },
      {
        id: 'assign-text',
        type: 'transform.assign',
        config: {
          assign: {
            'vars.marker': { $expr: `'${markerLiteral}'` },
            'vars.title': { $expr: `'${markerLiteral} Try/Catch notify'` },
          },
        },
      },
      {
        id: 'try-notify',
        type: 'control.tryCatch',
        captureErrorAs: 'caught',
        try: [
          notificationCallStep({
            fixtureName,
            recipientsExpr: '{ "user_ids": [payload.fixtureBadUserId] }',
            titleExpr: `'${markerLiteral} Try'`,
            bodyExpr: `'${markerLiteral} dedupe=' & payload.fixtureDedupeKey & ' attempt=try'`,
            dedupeExpr: `'fixture.${fixtureName}:' & payload.fixtureDedupeKey & ':try'`,
          }),
          { id: 'return-after-try', type: 'control.return' },
        ],
        catch: [
          notificationCallStep({
            fixtureName,
            recipientsExpr: '{ "user_ids": [payload.fixtureNotifyUserId] }',
            titleExpr: `'${markerLiteral} Fallback'`,
            bodyExpr:
              `'${markerLiteral} dedupe=' & payload.fixtureDedupeKey & ' error=' & coalesce(vars.caught.message, 'unknown')`,
            dedupeExpr: `'fixture.${fixtureName}:' & payload.fixtureDedupeKey & ':catch'`,
          }),
          { id: 'return-after-catch', type: 'control.return' },
        ],
      },
    ];
  }

  if (pattern === 'multiBranch') {
    return [
      { id: 'state-fixture', type: 'state.set', config: { state: 'FIXTURE' } },
      {
        id: 'assign-text',
        type: 'transform.assign',
        config: {
          assign: {
            'vars.marker': { $expr: `'${markerLiteral}'` },
            'vars.body': { $expr: `'${markerLiteral} dedupe=' & payload.fixtureDedupeKey` },
          },
        },
      },
      {
        id: 'if-branch-a',
        type: 'control.if',
        condition: { $expr: "payload.fixtureVariant = 'A'" },
        then: [
          notificationCallStep({
            fixtureName,
            recipientsExpr: '{ "user_ids": [payload.fixtureNotifyUserId] }',
            titleExpr: `'${markerLiteral} Branch A'`,
            bodyExpr: `vars.body & ' branch=A'`,
            dedupeExpr: `'fixture.${fixtureName}:' & payload.fixtureDedupeKey & ':A'`,
          }),
          { id: 'return-a', type: 'control.return' },
        ],
        else: [
          {
            id: 'if-branch-b',
            type: 'control.if',
            condition: { $expr: "payload.fixtureVariant = 'B'" },
            then: [
              notificationCallStep({
                fixtureName,
                recipientsExpr: '{ "user_ids": [payload.fixtureNotifyUserId] }',
                titleExpr: `'${markerLiteral} Branch B'`,
                bodyExpr: `vars.body & ' branch=B'`,
                dedupeExpr: `'fixture.${fixtureName}:' & payload.fixtureDedupeKey & ':B'`,
              }),
              { id: 'return-b', type: 'control.return' },
            ],
            else: [{ id: 'return-default', type: 'control.return' }],
          },
        ],
      },
    ];
  }

  // default + idempotent share the same workflow (idempotency asserted in test).
  return [
    { id: 'state-fixture', type: 'state.set', config: { state: 'FIXTURE' } },
    {
      id: 'assign-text',
      type: 'transform.assign',
      config: {
        assign: {
          'vars.marker': { $expr: `'${markerLiteral}'` },
          'vars.title': { $expr: `'${markerLiteral} Notify'` },
          'vars.body': { $expr: `'${markerLiteral} dedupe=' & payload.fixtureDedupeKey` },
        },
      },
    },
    {
      id: 'if-notify',
      type: 'control.if',
      condition: { $expr: "(payload.fixtureMode ? payload.fixtureMode : 'notify') = 'notify'" },
      then: [
        notificationCallStep({
          fixtureName,
          recipientsExpr: '{ "user_ids": [payload.fixtureNotifyUserId] }',
          titleExpr: 'vars.title',
          bodyExpr: 'vars.body',
        }),
        { id: 'return-after-notify', type: 'control.return' },
      ],
      else: [{ id: 'return-after-skip', type: 'control.return' }],
    },
  ];
}

function updateWorkflowCommon({ workflow, fixtureName, eventName, schemaRef, pattern }) {
  const title = titleFromFixtureName(fixtureName);
  const description =
    pattern === 'forEach'
      ? `For each generated item, send an in-app notification (${eventName}).`
      : pattern === 'tryCatch'
        ? `Exercise try/catch by attempting an invalid notification, then sending a fallback (${eventName}).`
        : pattern === 'multiBranch'
          ? `Exercise multi-branch control flow by selecting Branch A/B via payload (${eventName}).`
          : pattern === 'idempotent'
            ? `Send an in-app notification with a dedupe key (idempotency) (${eventName}).`
            : `Send an in-app notification when the event fires (${eventName}).`;

  workflow.metadata.name = `Fixture: ${title}`;
  workflow.metadata.description = description;
  workflow.metadata.payloadSchemaRef = schemaRef;
  workflow.metadata.payloadSchemaMode = 'pinned';
  workflow.metadata.pinnedPayloadSchemaRef = schemaRef;
  workflow.metadata.trigger = { type: 'event', eventName };

  workflow.dependencies.actions = [{ actionId: 'notifications.send_in_app', version: 1 }];
  workflow.dependencies.nodeTypes = buildDependenciesNodeTypes(pattern);
  workflow.dependencies.schemaRefs = [schemaRef];

  const steps = buildSteps({ fixtureName, pattern });

  const draftDef = workflow.draft.definition;
  draftDef.name = `Fixture: ${title}`;
  draftDef.description = description;
  draftDef.payloadSchemaRef = schemaRef;
  draftDef.trigger = { type: 'event', eventName };
  draftDef.steps = steps;

  if (!Array.isArray(workflow.publishedVersions) || workflow.publishedVersions.length === 0) {
    workflow.publishedVersions = [];
  }

  // Keep a single published version for normal fixtures; callWorkflow fixtures are handled separately.
  if (pattern !== 'callWorkflow') {
    const published = workflow.publishedVersions[0] ?? { version: 1, definition: {}, payloadSchemaJson: null };
    published.version = 1;
    published.payloadSchemaJson = null;
    const pubDef = published.definition;
    pubDef.id = draftDef.id;
    pubDef.version = 1;
    pubDef.name = draftDef.name;
    pubDef.description = draftDef.description;
    pubDef.payloadSchemaRef = draftDef.payloadSchemaRef;
    pubDef.trigger = draftDef.trigger;
    pubDef.steps = draftDef.steps;
    workflow.publishedVersions = [published];
  }
}

function buildCallWorkflowBundle({ fixtureName, eventName, schemaRef, originalBundle }) {
  const title = titleFromFixtureName(fixtureName);
  const parentKey = `fixture.${fixtureName}`;
  const childKey = `subfixture.${fixtureName}`;

  const parentWorkflowId = originalBundle.workflows?.[0]?.draft?.definition?.id ?? randomFixtureUuid();

  const marker = `[fixture ${fixtureName}]`;
  const childMarker = `[fixture ${fixtureName} child]`;

  const parentSteps = [
    { id: 'state-fixture', type: 'state.set', config: { state: 'FIXTURE' } },
    {
      id: 'assign-text',
      type: 'transform.assign',
      config: {
        assign: {
          'vars.marker': { $expr: `'${marker}'` },
          'vars.title': { $expr: `'${marker} Parent'` },
          'vars.body': { $expr: `'${marker} dedupe=' & payload.fixtureDedupeKey` },
        },
      },
    },
    {
      id: 'call-child',
      type: 'control.callWorkflow',
      workflowId: '00000000-0000-0000-0000-000000000000',
      workflowVersion: 1,
      inputMapping: {
        fixtureNotifyUserId: { $expr: 'payload.fixtureNotifyUserId' },
        fixtureDedupeKey: { $expr: 'payload.fixtureDedupeKey' },
      },
    },
    notificationCallStep({
      fixtureName,
      recipientsExpr: '{ "user_ids": [payload.fixtureNotifyUserId] }',
      titleExpr: 'vars.title',
      bodyExpr: 'vars.body',
      dedupeExpr: `'fixture.${fixtureName}:' & payload.fixtureDedupeKey & ':parent'`,
    }),
    { id: 'done', type: 'control.return' },
  ];

  const childSteps = [
    { id: 'state-fixture', type: 'state.set', config: { state: 'FIXTURE' } },
    {
      id: 'assign-text',
      type: 'transform.assign',
      config: {
        assign: {
          'vars.marker': { $expr: `'${childMarker}'` },
          'vars.title': { $expr: `'${childMarker} Child'` },
          'vars.body': { $expr: `'${childMarker} dedupe=' & payload.fixtureDedupeKey` },
        },
      },
    },
    notificationCallStep({
      fixtureName,
      recipientsExpr: '{ "user_ids": [payload.fixtureNotifyUserId] }',
      titleExpr: 'vars.title',
      bodyExpr: 'vars.body',
      dedupeExpr: `'fixture.${fixtureName}:' & payload.fixtureDedupeKey & ':child'`,
    }),
    { id: 'done', type: 'control.return' },
  ];

  const baseMeta = {
    isSystem: false,
    isVisible: true,
    isPaused: false,
    concurrencyLimit: null,
    autoPauseOnFailure: false,
    failureRateThreshold: null,
    failureRateMinRuns: null,
    retentionPolicyOverride: null,
  };

  const parent = {
    key: parentKey,
    metadata: {
      name: `Fixture: ${title} (CallWorkflow)`,
      description: `Call a sub-workflow and assert both parent+child side effects (${eventName}).`,
      payloadSchemaRef: schemaRef,
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: schemaRef,
      trigger: { type: 'event', eventName },
      ...baseMeta,
    },
    dependencies: {
      actions: [{ actionId: 'notifications.send_in_app', version: 1 }],
      nodeTypes: ['action.call', 'control.callWorkflow', 'control.return', 'state.set', 'transform.assign'],
      schemaRefs: [schemaRef],
    },
    draft: {
      draftVersion: 1,
      definition: {
        id: parentWorkflowId,
        version: 1,
        name: `Fixture: ${title} (CallWorkflow)`,
        description: `Call a sub-workflow and assert both parent+child side effects (${eventName}).`,
        payloadSchemaRef: schemaRef,
        trigger: { type: 'event', eventName },
        steps: parentSteps,
      },
    },
    publishedVersions: [],
  };

  const child = {
    key: childKey,
    metadata: {
      name: `Fixture: ${title} (Child)`,
      description: `Child workflow for callWorkflow fixture ${fixtureName}.`,
      payloadSchemaRef: 'payload.TicketCreated.v1',
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: 'payload.TicketCreated.v1',
      trigger: null,
      ...baseMeta,
    },
    dependencies: {
      actions: [{ actionId: 'notifications.send_in_app', version: 1 }],
      nodeTypes: ['action.call', 'control.return', 'state.set', 'transform.assign'],
      schemaRefs: ['payload.TicketCreated.v1'],
    },
    draft: {
      draftVersion: 1,
      definition: {
        id: randomFixtureUuid(),
        version: 1,
        name: `Fixture: ${title} (Child)`,
        description: `Child workflow for callWorkflow fixture ${fixtureName}.`,
        payloadSchemaRef: 'payload.TicketCreated.v1',
        steps: childSteps,
      },
    },
    publishedVersions: [],
  };

  return {
    ...originalBundle,
    exportedAt: new Date().toISOString(),
    workflows: [parent, child],
  };
}

function randomFixtureUuid() {
  // Deterministic isn't required; this is a workflow definition id field that is overwritten on publish.
  // Keep it valid UUID-shaped for consistency.
  return '00000000-0000-0000-0000-00000000' + Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
}

function buildTestContents({ fixtureName, eventName, schemaRef, pattern }) {
  if (pattern === 'callWorkflow') {
    return `const { runCallWorkflowFixture } = require('../_lib/callworkflow-fixture.cjs');\n\nmodule.exports = async function run(ctx) {\n  return runCallWorkflowFixture(ctx, {\n    fixtureName: ${JSON.stringify(fixtureName)},\n    eventName: ${JSON.stringify(eventName)},\n    schemaRef: ${JSON.stringify(schemaRef)}\n  });\n};\n`;
  }

  return `const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');\n\nmodule.exports = async function run(ctx) {\n  return runNotificationFixture(ctx, {\n    fixtureName: ${JSON.stringify(fixtureName)},\n    eventName: ${JSON.stringify(eventName)},\n    schemaRef: ${JSON.stringify(schemaRef)},\n    pattern: ${JSON.stringify(pattern)}\n  });\n};\n`;
}

function main() {
  const dirs = fs.readdirSync(ROOT).filter((name) => fs.statSync(path.join(ROOT, name)).isDirectory());
  let converted = 0;

  for (const fixtureName of dirs) {
    const testPath = path.join(ROOT, fixtureName, 'test.cjs');
    const bundlePath = path.join(ROOT, fixtureName, 'bundle.json');
    if (!fs.existsSync(testPath) || !fs.existsSync(bundlePath)) continue;

    const testSrc = fs.readFileSync(testPath, 'utf8');
    if (!testSrc.includes('_lib/scaffolded-fixture.cjs')) continue;

    const bundle = readJson(bundlePath);
    const eventName = bundle?.workflows?.[0]?.metadata?.trigger?.eventName;
    if (!eventName) {
      throw new Error(`Missing metadata.trigger.eventName in ${bundlePath}`);
    }

    const schemaRef = schemaRefForEvent(eventName);
    const pattern = choosePattern(fixtureName);

    if (pattern === 'callWorkflow') {
      const next = buildCallWorkflowBundle({ fixtureName, eventName, schemaRef, originalBundle: bundle });
      writeJson(bundlePath, next);
    } else {
      const wf = bundle.workflows[0];
      updateWorkflowCommon({ workflow: wf, fixtureName, eventName, schemaRef, pattern });
      bundle.exportedAt = new Date().toISOString();
      bundle.workflows = [wf];
      writeJson(bundlePath, bundle);
    }

    fs.writeFileSync(testPath, buildTestContents({ fixtureName, eventName, schemaRef, pattern }), 'utf8');
    converted += 1;
  }

  console.log(`Converted ${converted} scaffolded fixture(s).`);
}

main();

