#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createTestContext } = require('./lib/context.cjs');
const { createHttpClient } = require('./lib/http.cjs');
const { createDbClient } = require('./lib/db.cjs');
const { importWorkflowBundleV1, exportWorkflowBundleV1 } = require('./lib/workflow.cjs');
const { waitForRun, getRunSteps, summarizeSteps, getRunLogs } = require('./lib/runs.cjs');

function usage() {
  console.error(`
Workflow Fixture Harness (V1)

Usage:
  node tools/workflow-harness/run.cjs --test <fixtureDir> --base-url <url> --tenant <tenantId> (--cookie <cookie> | --cookie-file <file>) [--force] [--timeout-ms <ms>] [--debug] [--artifacts-dir <dir>] [--json]

Flags:
  --test           Fixture directory path (contains bundle.json + test.cjs)
  --base-url       Server base URL (e.g. http://localhost:3010)
  --tenant         Tenant id (sets x-tenant-id)
  --cookie         Raw Cookie header value (e.g. next-auth.session-token=...)
  --cookie-file    File containing the raw Cookie header value (newlines trimmed)
  --force          Overwrite workflows on import
  --timeout-ms     Global timeout (default: 60000)
  --debug          Verbose logs
  --artifacts-dir  Failure artifact output directory (default: $TMPDIR)
  --json           Print a JSON result object to stdout (in addition to PASS/FAIL line)
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      i += 1;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      if (key === 'force' || key === 'debug' || key === 'json') {
        args[key] = true;
        i += 1;
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i += 2;
      continue;
    }
    args._.push(token);
    i += 1;
  }
  return args;
}

function readCookieFromFile(path) {
  const raw = fs.readFileSync(path, 'utf8');
  return raw.trim();
}

function validateFixtureDir(testDir) {
  if (!fs.existsSync(testDir)) {
    throw new Error(`Fixture directory does not exist: ${testDir}`);
  }
  const stat = fs.statSync(testDir);
  if (!stat.isDirectory()) {
    throw new Error(`--test must point to a directory: ${testDir}`);
  }
  const bundlePath = `${testDir.replace(/\/$/, '')}/bundle.json`;
  const testPath = `${testDir.replace(/\/$/, '')}/test.cjs`;
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Missing required fixture file: ${bundlePath}`);
  }
  if (!fs.existsSync(testPath)) {
    throw new Error(`Missing required fixture file: ${testPath}`);
  }
  return { bundlePath, testPath };
}

function fixtureIdFromDir(testDir) {
  const normalized = testDir.replace(/\/$/, '');
  return path.basename(normalized);
}

function getDefaultArtifactsDir() {
  return process.env.TMPDIR || os.tmpdir();
}

function sanitizeSingleLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function runFixture({ testDir, bundlePath, testPath, baseUrl, tenantId, cookie, force, timeoutMs, debug, artifactsDir, pgUrl }) {
  const http = createHttpClient({ baseUrl, tenantId, cookie, debug });
  const db = await createDbClient({ connectionString: pgUrl, debug });

  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse bundle JSON: ${bundlePath}\n${err?.message ?? String(err)}`);
  }

  const importSummary = await importWorkflowBundleV1({ http, bundle, force });
  const workflowKey =
    Array.isArray(bundle?.workflows) && bundle.workflows[0] && typeof bundle.workflows[0].key === 'string'
      ? bundle.workflows[0].key
      : null;
  const workflowId =
    workflowKey && Array.isArray(importSummary?.createdWorkflows)
      ? importSummary.createdWorkflows.find((w) => w.key === workflowKey)?.workflowId ?? importSummary.createdWorkflows[0]?.workflowId ?? null
      : importSummary?.createdWorkflows?.[0]?.workflowId ?? null;

  if (!workflowId) {
    throw new Error('Workflow import did not return a workflowId (createdWorkflows missing?).');
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const runTest = require(testPath);
  if (typeof runTest !== 'function') {
    throw new Error(`Fixture test.cjs must export an async function. Got: ${typeof runTest}`);
  }

  const ctx = createTestContext(
    { baseUrl, tenantId, timeoutMs, debug, artifactsDir },
    {}
  );

  ctx.http = http;
  ctx.db = db;
  ctx.fixture = { id: fixtureIdFromDir(testDir), dir: testDir };
  ctx.workflow = {
    id: workflowId,
    key: workflowKey,
    importSummary,
    export: () => exportWorkflowBundleV1({ http, workflowId })
  };
  ctx.waitForRun = async (opts = {}) =>
    waitForRun({
      db,
      workflowId,
      tenantId,
      startedAfter: opts.startedAfter ?? ctx.triggerStartedAt ?? new Date(0).toISOString(),
      timeoutMs: opts.timeoutMs ?? timeoutMs
    });
  ctx.getRunSteps = async (runId) => getRunSteps({ db, runId });
  ctx.getRunLogs = async (runId, limit) => getRunLogs({ db, runId, limit });
  ctx.summarizeSteps = summarizeSteps;

  ctx.triggerStartedAt = new Date().toISOString();
  const result = await runTest(ctx);

  await db.close();
  return { result, importSummary, workflowId, workflowKey };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const testDir = args.test;
  const baseUrl = args['base-url'];
  const tenant = args.tenant;
  const cookie = args.cookie ?? (args['cookie-file'] ? readCookieFromFile(args['cookie-file']) : undefined);
  const force = !!args.force;
  const timeoutMs = args['timeout-ms'] ? Number(args['timeout-ms']) : 60_000;
  const debug = !!args.debug;
  const artifactsDir = args['artifacts-dir'] ?? getDefaultArtifactsDir();
  const pgUrl = args['pg-url'] ?? undefined;

  if (!testDir) throw new Error('Missing --test');
  if (!baseUrl) throw new Error('Missing --base-url');
  if (!tenant) throw new Error('Missing --tenant');
  if (!cookie) throw new Error('Missing --cookie or --cookie-file');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid --timeout-ms (expected positive integer)');

  const fixture = validateFixtureDir(testDir);
  const testId = fixtureIdFromDir(testDir);
  const startedAtMs = Date.now();

  try {
    await runFixture({
      testDir,
      ...fixture,
      baseUrl,
      tenantId: tenant,
      cookie,
      force,
      timeoutMs,
      debug,
      artifactsDir,
      pgUrl
    });
    const durationMs = Date.now() - startedAtMs;
    console.log(`PASS ${testId} ${durationMs}`);
    process.exit(0);
  } catch (err) {
    const durationMs = Date.now() - startedAtMs;
    const reason = sanitizeSingleLine(err?.message ?? String(err));
    console.log(`FAIL ${testId} ${durationMs} ${reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.stack ?? err?.message ?? String(err));
  usage();
  process.exit(1);
});
