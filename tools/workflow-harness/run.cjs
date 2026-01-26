#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');

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

  if (!testDir) throw new Error('Missing --test');
  if (!baseUrl) throw new Error('Missing --base-url');
  if (!tenant) throw new Error('Missing --tenant');
  if (!cookie) throw new Error('Missing --cookie or --cookie-file');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid --timeout-ms (expected positive integer)');

  // Implementation is added incrementally by plan items (see ee/docs/plans/2026-01-26-workflow-harness-fixture-suite).
  console.error('Workflow harness core runtime not yet wired; CLI parsing is ready.');
  console.error(JSON.stringify({ testDir, baseUrl, tenant, force, timeoutMs }, null, 2));
  process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack ?? err?.message ?? String(err));
  usage();
  process.exit(1);
});
