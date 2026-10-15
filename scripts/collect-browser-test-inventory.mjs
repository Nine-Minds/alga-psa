#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { discoverBrowserTests } from './lib/browser-test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = process.cwd();
const output = path.join(root, 'test-results/browser-discovery');
mkdirSync(output, { recursive: true });
// Use each suite's own installed Playwright version and real configuration.
const runners = [
  { runner: 'teams-development', cwd: 'e2e-tests', cli: 'node_modules/@playwright/test/cli.js', config: 'playwright.teams-development.config.ts', edition: 'enterprise' },
  { runner: 'supported-upgrade', cwd: 'e2e-tests', cli: 'node_modules/@playwright/test/cli.js', config: 'playwright.upgrade.config.ts', edition: 'enterprise' },
  { runner: 'server-legacy', cwd: 'server', cli: '../node_modules/@playwright/test/cli.js', config: 'playwright.config.ts' },
  { runner: 'enterprise-legacy', cwd: 'ee/server', cli: '../../node_modules/@playwright/test/cli.js', config: 'playwright.config.ts' },
  { runner: 'enterprise-deploy', cwd: 'ee/server', cli: '../../node_modules/@playwright/test/cli.js', config: 'playwright.deploy.config.ts' },
  ...['community', 'enterprise'].map(edition => ({ runner: `production-${edition}`, cwd: 'e2e-tests',
    cli: 'node_modules/@playwright/test/cli.js', config: 'playwright.config.ts', edition })),
];
let result;
try {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/collect-browser-test-inventory.mjs (all browser runners; no filters)');
  const before = testRevision(root);
  const reports = runners.map(({ runner, cwd, cli, config, edition }) => {
    const reportFile = path.join(output, `${runner}.json`);
    // Clear prior artifacts so failed collection cannot reuse stale evidence.
    writeFileSync(reportFile, '');
    const run = spawnSync(process.execPath, [cli, 'test', '--config', config, '--list', '--reporter=json'], {
      cwd: path.join(root, cwd), encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        PLAYWRIGHT_BASE_URL: 'http://localhost:53010', E2E_BASE_URL: 'http://localhost:53010',
        E2E_EDITION: edition ?? 'enterprise', E2E_REVISION: before.revision },
    });
    writeFileSync(path.join(output, `${runner}.log`), `${run.stdout ?? ''}\n${run.stderr ?? ''}\n${run.error?.message ?? ''}`);
    if (run.status !== 0) throw new Error(`${runner} collection exited ${run.status ?? 'without an exit code'}; see ${runner}.log`);
    return { runner, exitCode: run.status, report: JSON.parse(readFileSync(reportFile, 'utf8')) };
  });
  result = discoverBrowserTests(root, reports);
  const after = testRevision(root);
  result.sourceRoot = root;
  result.sourceBefore = before;
  result.sourceAfter = after;
  if (before.dirty || after.dirty || before.revision !== after.revision) {
    result.failures.push('Browser discovery requires an unchanged, clean candidate checkout');
  }
  result.status = result.failures.length ? 'failed' : 'passed';
} catch (error) {
  result = { schemaVersion: 1, scope: 'browser-collection', executionVerified: false,
    status: 'failed', failures: [error.message] };
}
writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
console.log(`Browser discovery: ${result.status}; execution is not verified by collection`);
process.exitCode = result.status === 'passed' ? 0 : 1;
