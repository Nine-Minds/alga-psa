#!/usr/bin/env node
/* eslint-disable no-console */

function usage() {
  console.error(`
Workflow Fixture Harness (V1)

Usage:
  node tools/workflow-harness/run.cjs --test <fixtureDir> --base-url <url> --tenant <tenantId> (--cookie <cookie> | --cookie-file <file>) [--force] [--timeout-ms <ms>] [--debug] [--artifacts-dir <dir>] [--json]

Fixture directory must contain:
  - bundle.json
  - test.cjs
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(2);
  }

  console.error('Workflow harness not yet fully implemented. See plan: ee/docs/plans/2026-01-26-workflow-harness-fixture-suite/PRD.md');
  usage();
  process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack ?? err?.message ?? String(err));
  process.exit(1);
});

