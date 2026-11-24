import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isCitusOwnedIntegrationTest, isPostgresIntegrationTest, reconcileDiscovery } from '../lib/test-discovery.mjs';
import { vitestInventoryArtifacts } from '../lib/repository-inventory-artifacts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const server = path.join(root, 'server');
const vitest = path.join(root, 'node_modules/vitest/vitest.mjs');
const postgresSuite = 'server/src/test/integration/emailOAuthGrants.integration.test.ts';
const citusSuite = 'server/src/test/integration/emailOAuthGrants.citus.integration.test.ts';

test('actual Vitest collections reconcile PostgreSQL and mandatory Citus ownership separately', t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'citus-discovery-owner-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));

  const collect = ({ backend, requireCitus, suites }) => {
    const output = path.join(temporary, `${backend}.json`);
    const env = { ...process.env, TEST_DB_BACKEND: backend, REQUIRE_CITUS: requireCitus ? '1' : '' };
    const result = spawnSync(process.execPath, [vitest, 'list', '--filesOnly',
      ...suites.map(suite => path.join(server, suite.slice('server/'.length))), `--json=${output}`],
    { cwd: server, encoding: 'utf8', timeout: 60_000, env });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return JSON.parse(readFileSync(output, 'utf8')).map(entry =>
      path.relative(root, path.resolve(server, entry.file)).split(path.sep).join('/'));
  };

  const candidateFiles = [postgresSuite, citusSuite];
  const postgresCandidates = candidateFiles.filter(isPostgresIntegrationTest);
  assert.deepEqual(postgresCandidates, [postgresSuite]);
  assert.equal(isCitusOwnedIntegrationTest(citusSuite), true);

  const postgresCollection = collect({ backend: 'postgres', requireCitus: false, suites: candidateFiles });
  assert.deepEqual(postgresCollection, [postgresSuite]);
  const postgresDiscovery = reconcileDiscovery({ root, candidates: postgresCandidates,
    collections: [{ runner: 'integration', status: 'passed', files: postgresCollection }] });
  assert.equal(postgresDiscovery.status, 'passed', postgresDiscovery.failures.join('\n'));

  const citusCollection = collect({ backend: 'citus', requireCitus: true, suites: [citusSuite] });
  assert.deepEqual(citusCollection, [citusSuite]);
  const citusDiscovery = reconcileDiscovery({ root, candidates: [citusSuite],
    collections: [{ runner: 'citus-runtime', status: 'passed', files: citusCollection }] });
  assert.equal(citusDiscovery.status, 'passed', citusDiscovery.failures.join('\n'));

  const revision = 'a'.repeat(40);
  assert.ok(vitestInventoryArtifacts(revision).some(artifact =>
    artifact.runner === 'citus-runtime' && artifact.directory === 'citus-runtime'));
});
