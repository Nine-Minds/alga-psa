import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileDiscovery, repositoryTestFiles } from '../scripts/lib/test-discovery.mjs';
import { playwrightTests } from '../scripts/lib/playwright-execution-evidence.mjs';
import { testRevision } from '../scripts/lib/test-revision.mjs';
import { verifyTeamsDevelopment } from '../scripts/lib/teams-development-evidence.mjs';

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(cwd, '..');
const output = path.join(root, 'test-results/teams-development');
mkdirSync(output, { recursive: true });
const files = Object.fromEntries(['collected', 'results', 'discovery', 'evidence'].map(name => [name, path.join(output, `${name}.json`)]));
for (const file of Object.values(files)) writeFileSync(file, 'null\n');
const save = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
let before;
let evidence;
try {
  if (process.argv.length > 2) throw new Error('The Teams development gate runs its entire test directory; filters are not accepted.');
  before = testRevision(root);
  if (before.dirty) throw new Error('Teams development gate requires clean source');
  const cli = require.resolve('@playwright/test/cli');
  const run = (args, report) => spawnSync(process.execPath, [cli, 'test', '--config', path.join(cwd, 'playwright.teams-development.config.ts'), ...args], {
    cwd, stdio: 'inherit',
    env: { ...process.env, E2E_REVISION: before.revision, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
  });
  const collection = run(['--list', '--reporter=json'], files.collected);
  if (collection.status !== 0) throw new Error(`Browser collection failed (exit ${collection.status})`);
  const collected = JSON.parse(readFileSync(files.collected, 'utf8'));
  const cases = playwrightTests(collected, root);
  const discovered = [...new Set(cases.map(entry => entry.file))];
  const discovery = reconcileDiscovery({ root,
    candidates: repositoryTestFiles(root).filter(file => file.startsWith('e2e-tests/development-tests/')),
    collections: [{ runner: 'teams-development-browser', status: 'passed', files: discovered }],
  });
  save(files.discovery, discovery);
  if (discovery.status !== 'passed') throw new Error(discovery.failures.join('\n'));
  const result = run(['--reporter=list,json'], files.results);
  let report;
  try { report = JSON.parse(readFileSync(files.results, 'utf8')); } catch { report = null; }
  evidence = verifyTeamsDevelopment({ collected, report, root, revision: before.revision, exitCode: result.status });
  evidence.configuration = collected.config.metadata;
  evidence.selection = { mode: 'full', filters: [] };
} catch (error) {
  evidence = { schemaVersion: 1, suite: 'teams-development-browser', revision: before?.revision, status: 'failed', failures: [error.message] };
}
try {
  const after = testRevision(root);
  evidence.source = { before, after };
  evidence.workingTreeDirty = Boolean(before?.dirty || after.dirty);
  if (evidence.workingTreeDirty) {
    evidence.status = 'failed';
    evidence.failures.push('Browser gate requires clean source before and after execution');
  }
  if (before?.revision !== after.revision) {
    evidence.status = 'failed';
    evidence.failures.push('Repository revision changed during browser testing');
  }
} catch (error) {
  evidence.status = 'failed';
  evidence.failures.push(error.message);
}
save(files.evidence, evidence);
for (const failure of evidence.failures) console.error(failure);
process.exit(evidence.status === 'passed' ? 0 : 1);
