#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error(`
Generate business-relevant counterparts for notification-only workflow-harness fixtures.

Usage:
  node tools/workflow-harness/generate-biz-counterparts.cjs \\
    --plan planning/adhoc/2026-01-27-biz-test-coverage-analysis/needed-biz-tests.json \\
    [--domain ticket]
`);
}

function parseArgs(argv) {
  const args = { _: [] };
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
    args._.push(t);
    i += 1;
  }
  return args;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function replaceDeep(value, from, to) {
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, from, to));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceDeep(v, from, to);
    return out;
  }
  if (typeof value === 'string') return value.split(from).join(to);
  return value;
}

function isCallWorkflowBundle(bundle) {
  const workflows = Array.isArray(bundle?.workflows) ? bundle.workflows : [];
  const hasCall = (steps) => {
    if (!Array.isArray(steps)) return false;
    for (const s of steps) {
      if (!s || typeof s !== 'object') continue;
      if (s.type === 'control.callWorkflow') return true;
      for (const key of ['then', 'else', 'body', 'try', 'catch']) {
        if (hasCall(s[key])) return true;
      }
    }
    return false;
  };
  return workflows.some((w) => hasCall(w?.draft?.definition?.steps));
}

function walkSteps(steps, visitor) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    visitor(step);
    for (const key of ['then', 'else', 'body', 'try', 'catch']) {
      if (Array.isArray(step[key])) walkSteps(step[key], visitor);
    }
  }
}

function ticketIdExprForEvent(eventName) {
  if (eventName === 'TICKET_MERGED') return 'payload.sourceTicketId';
  if (eventName === 'TICKET_SPLIT') return 'payload.originalTicketId';
  return 'payload.ticketId';
}

function projectIdExprForEvent(eventName) {
  if (String(eventName || '').startsWith('PROJECT_')) return 'payload.projectId';
  if (eventName === 'TASK_COMMENT_ADDED' || eventName === 'TASK_COMMENT_UPDATED') return 'payload.projectId';
  if (String(eventName || '').startsWith('INVOICE_')) return 'payload.invoiceId';
  if (String(eventName || '').startsWith('PAYMENT_')) return 'payload.paymentId';
  if (String(eventName || '').startsWith('CONTRACT_')) return 'payload.contractId';
  if (String(eventName || '').startsWith('COMPANY_')) return 'payload.companyId';
  if (String(eventName || '').startsWith('APPOINTMENT_')) return 'payload.appointmentId';
  if (String(eventName || '').startsWith('TECHNICIAN_')) return 'payload.appointmentId';
  if (String(eventName || '').startsWith('TIME_ENTRY_')) return 'payload.timeEntryId';
  if (String(eventName || '').startsWith('SCHEDULE_BLOCK_')) return 'payload.scheduleBlockId';
  if (String(eventName || '').startsWith('SCHEDULE_ENTRY_')) return 'payload.entryId';
  if (eventName === 'CAPACITY_THRESHOLD_REACHED') return 'payload.teamId';
  if (String(eventName || '').startsWith('INTEGRATION_')) return 'payload.integrationId';
  if (eventName === 'EMAIL_PROVIDER_CONNECTED') return 'payload.providerId';
  return 'payload.projectId';
}

function replaceNotificationActionsInWorkflow({ workflow, kind, fixtureName }) {
  const eventName =
    workflow?.metadata?.trigger?.eventName ??
    workflow?.draft?.definition?.trigger?.eventName ??
    workflow?.publishedVersions?.[0]?.definition?.trigger?.eventName ??
    null;

  const markerFallback = `[fixture ${fixtureName}]`;
  const markerExpr = `(vars.marker ? vars.marker : '${markerFallback}')`;

  const commentBodyExpr = `${markerExpr} & ' ' & (vars.body ? vars.body : (vars.title ? vars.title : ''))`;
  const taskTitleExpr = `${markerExpr} & ' ' & (vars.title ? vars.title : (vars.body ? vars.body : ''))`;

  const actionId = kind === 'ticket_comment' ? 'tickets.add_comment' : 'projects.create_task';

  const makeActionConfig = () => {
    if (kind === 'ticket_comment') {
      return {
        actionId,
        version: 1,
        inputMapping: {
          ticket_id: { $expr: ticketIdExprForEvent(eventName) },
          body: { $expr: commentBodyExpr },
          visibility: 'internal'
        }
      };
    }
    return {
      actionId,
      version: 1,
      inputMapping: {
        project_id: { $expr: projectIdExprForEvent(eventName) },
        title: { $expr: taskTitleExpr }
      }
    };
  };

  const replaceInSteps = (def) => {
    if (!def?.steps) return;
    walkSteps(def.steps, (step) => {
      if (step.type !== 'action.call') return;
      if (step?.config?.actionId !== 'notifications.send_in_app') return;
      step.config = makeActionConfig();
    });
  };

  replaceInSteps(workflow?.draft?.definition);
  if (Array.isArray(workflow?.publishedVersions)) {
    for (const pv of workflow.publishedVersions) replaceInSteps(pv?.definition);
  }

  const deps = workflow.dependencies ?? {};
  const existing = Array.isArray(deps.actions) ? deps.actions.filter((a) => a && a.actionId !== 'notifications.send_in_app') : [];
  const hasAction = existing.some((a) => a.actionId === actionId);
  deps.actions = hasAction ? existing : [...existing, { actionId, version: 1 }];
  workflow.dependencies = deps;
}

function writeIfMissing(filePath, contents) {
  if (fs.existsSync(filePath)) throw new Error(`Refusing to overwrite existing file: ${filePath}`);
  fs.writeFileSync(filePath, contents, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function testTemplate({ fixtureName, eventName, schemaRef, kind, isCallWorkflow }) {
  if (isCallWorkflow) {
    return `const { runCallWorkflowBizFixture } = require('../_lib/biz-fixture.cjs');\n\nmodule.exports = async function run(ctx) {\n  return runCallWorkflowBizFixture(ctx, {\n    fixtureName: ${JSON.stringify(fixtureName)},\n    eventName: ${JSON.stringify(eventName)},\n    schemaRef: ${JSON.stringify(schemaRef)},\n    kind: ${JSON.stringify(kind)}\n  });\n};\n`;
  }

  if (kind === 'ticket_comment') {
    return `const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');\n\nmodule.exports = async function run(ctx) {\n  return runTicketCommentFixture(ctx, {\n    fixtureName: ${JSON.stringify(fixtureName)},\n    eventName: ${JSON.stringify(eventName)},\n    schemaRef: ${JSON.stringify(schemaRef)}\n  });\n};\n`;
  }

  return `const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');\n\nmodule.exports = async function run(ctx) {\n  return runProjectTaskFixture(ctx, {\n    fixtureName: ${JSON.stringify(fixtureName)},\n    eventName: ${JSON.stringify(eventName)},\n    schemaRef: ${JSON.stringify(schemaRef)}\n  });\n};\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const planPath = args.plan || 'planning/adhoc/2026-01-27-biz-test-coverage-analysis/needed-biz-tests.json';
  const domainFilter = args.domain || null;

  const planAbs = path.resolve(process.cwd(), planPath);
  const plan = JSON.parse(fs.readFileSync(planAbs, 'utf8'));
  const fixturesByDomain = plan.fixturesByDomain || {};

  const root = path.resolve(process.cwd(), 'ee/test-data/workflow-harness');

  for (const domain of Object.keys(fixturesByDomain)) {
    if (domainFilter && domain !== domainFilter) continue;

    const entries = Array.isArray(fixturesByDomain[domain]) ? fixturesByDomain[domain] : [];
    const sorted = [...entries].sort((a, b) => String(a.current).localeCompare(String(b.current)));

    for (const entry of sorted) {
      const current = entry.current;
      const suggestedBiz = entry.suggestedBiz;
      if (!current || !suggestedBiz) throw new Error(`Invalid entry: ${JSON.stringify(entry)}`);

      const srcDir = path.join(root, current);
      const dstDir = path.join(root, suggestedBiz);
      const srcBundlePath = path.join(srcDir, 'bundle.json');
      const dstBundlePath = path.join(dstDir, 'bundle.json');
      const dstTestPath = path.join(dstDir, 'test.cjs');

      if (!fs.existsSync(srcBundlePath)) throw new Error(`Missing source bundle.json: ${srcBundlePath}`);
      if (fs.existsSync(dstDir)) throw new Error(`Destination fixture already exists: ${dstDir}`);

      const originalBundle = JSON.parse(fs.readFileSync(srcBundlePath, 'utf8'));
      const callWorkflow = isCallWorkflowBundle(originalBundle);

      const kind = domain === 'ticket' ? 'ticket_comment' : 'project_task';

      let bundle = deepClone(originalBundle);
      bundle.exportedAt = new Date().toISOString();
      bundle = replaceDeep(bundle, current, suggestedBiz);

      if (!Array.isArray(bundle.workflows) || !bundle.workflows.length) {
        throw new Error(`Invalid bundle.workflows for ${current}`);
      }

      for (const workflow of bundle.workflows) {
        replaceNotificationActionsInWorkflow({ workflow, kind, fixtureName: suggestedBiz });
      }

      const eventName = bundle.workflows[0]?.metadata?.trigger?.eventName ?? null;
      const schemaRef = bundle.workflows[0]?.metadata?.payloadSchemaRef ?? null;
      if (!eventName || !schemaRef) {
        throw new Error(`Unable to determine eventName/schemaRef for ${suggestedBiz}`);
      }

      ensureDir(dstDir);
      writeIfMissing(dstBundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
      writeIfMissing(dstTestPath, testTemplate({ fixtureName: suggestedBiz, eventName, schemaRef, kind, isCallWorkflow: callWorkflow }));

      // eslint-disable-next-line no-console
      console.log(`Generated ${suggestedBiz} (from ${current})`);
    }
  }
}

main().catch((err) => {
  console.error(err?.stack ?? err?.message ?? String(err));
  usage();
  process.exit(1);
});

