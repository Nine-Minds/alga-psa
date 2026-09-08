import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySupportedUpgrade } from '../scripts/lib/supported-upgrade-evidence.mjs';
import { testRevision } from '../scripts/lib/test-revision.mjs';

const cwd = fileURLToPath(new URL('.', import.meta.url)), root = path.resolve(cwd, '..');
const output = path.join(root, 'test-results/supported-upgrade');
mkdirSync(output, { recursive: true });
const files = Object.fromEntries(['schema', 'collected', 'results', 'evidence'].map(name => [name, path.join(output, `${name}.json`)]));
for (const file of Object.values(files)) writeFileSync(file, 'null\n');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
let verdict, before;
try {
  if (process.argv.length > 2) throw new Error('Upgrade gate requires all upgrade tests; filters are not accepted');
  before = testRevision(root);
  if (before.dirty) throw new Error('Upgrade browser gate requires clean source');
  if (!process.env.UPGRADE_SCHEMA_EVIDENCE) throw new Error('UPGRADE_SCHEMA_EVIDENCE is required');
  const schema = read(process.env.UPGRADE_SCHEMA_EVIDENCE);
  save(files.schema, schema);
  if (schema.status !== 'passed' || schema.source?.revision !== before.revision || schema.source?.dirty !== false
    || schema.sourceAfter?.revision !== before.revision || schema.sourceAfter?.dirty !== false
    || schema.database !== process.env.E2E_DB_NAME || process.env.UPGRADE_APPLICATION_REVISION !== before.revision) {
    throw new Error('Upgrade execution requires matching clean schema, database and application revision');
  }
  // Validate the fixture identity rather than accepting an unrelated path from a previous run.
  if (!process.env.UPGRADE_FIXTURE_PATH || path.resolve(process.env.UPGRADE_FIXTURE_PATH) !== path.join(schema.output, 'fixture.json')) {
    throw new Error('Browser fixture does not belong to schema evidence output');
  }
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const run = (args, report) => spawnSync(process.execPath, [cli, 'test', '--config', path.join(cwd, 'playwright.upgrade.config.ts'), ...args], {
    cwd, stdio: 'inherit', env: { ...process.env, E2E_REVISION: before.revision, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
  });
  const collection = run(['--list', '--reporter=json'], files.collected);
  if (collection.status !== 0) throw new Error(`Upgrade collection failed: ${collection.status}`);
  const result = run(['--reporter=list,json'], files.results);
  verdict = verifySupportedUpgrade({ revision: before.revision, schema, collected: read(files.collected), report: read(files.results),
    exitCode: result.status, root, database: process.env.E2E_DB_NAME, applicationRevision: process.env.UPGRADE_APPLICATION_REVISION });
} catch (error) {
  verdict = { schemaVersion: 1, scope: 'supported-upgrade', revision: before?.revision, status: 'failed', failures: [error.message] };
}
try {
  const after = testRevision(root);
  verdict.source = { before, after };
  if (after.dirty || after.revision !== before?.revision) {
    verdict.status = 'failed'; verdict.failures.push('Source changed during upgrade browser execution');
  }
} catch (error) { verdict.status = 'failed'; verdict.failures.push(error.message); }
save(files.evidence, verdict);
for (const failure of verdict.failures) console.error(failure);
process.exit(verdict.status === 'passed' ? 0 : 1);
