import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseAllDocuments } from 'yaml';
import { pinnedImage } from '../../../../scripts/lib/pinned-images.mjs';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const algaCoreChartPath = path.join(repoRoot, 'helm');
const emailServiceChartPath = path.join(repoRoot, 'ee', 'helm', 'email-service');

function helmTemplate(chartPath, extraArgs = []) {
  const result = spawnSync('helm', ['template', 'test-release', chartPath, '--namespace', 'msp', ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return parseAllDocuments(result.stdout).map((doc) => doc.toJSON()).filter(Boolean);
}

test('T007 alga-core chart with db.enabled=false renders no bundled database objects', () => {
  const docs = helmTemplate(algaCoreChartPath, [
    '--set', 'db.enabled=false',
    '--set', 'setup.runMigrations=true',
    // The chart requires secret references for every DB credential when the database is external.
    ...['server_password_admin_secret', 'server_password_secret', 'hocuspocus_password_secret', 'pgbouncer_password_secret']
      .flatMap((name) => [
        '--set', `config.db.${name}.name=managed-db-${name}`,
        '--set', `config.db.${name}.key=password`,
      ]),
  ]);

  assert.equal(docs.filter((doc) => doc.kind === 'StatefulSet' && doc.metadata?.name === 'db').length, 0);
  assert.equal(docs.filter((doc) => doc.kind === 'Job' && /^db-extension-update-/.test(doc.metadata?.name ?? '')).length, 0);

  // Managed databases keep today's wait image: setup.image, not the DB image.
  const deployment = docs.find((doc) => doc.kind === 'Deployment' && doc.metadata?.name === 'test-release-sebastian');
  assert.ok(deployment);
  const waitInit = deployment.spec.template.spec.initContainers.find((container) => container.name === 'wait-for-bootstrap');
  assert.ok(waitInit);
  const setupContainer = docs.find((doc) => doc.kind === 'Job' && doc.metadata?.name === 'test-release-sebastian-bootstrap')
    .spec.template.spec.containers[0];
  assert.equal(waitInit.image, setupContainer.image);
  assert.notEqual(waitInit.image, pinnedImage('pgvector'));
});

test('T008 alga-core chart rejects a malformed image digest', () => {
  const result = spawnSync('helm', ['template', 'test-release', algaCoreChartPath, '--set', 'db.image.digest=sha256:abc'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must match sha256/);
});

test('T009 email-service wait-for-bootstrap uses the pinned database image', () => {
  const docs = helmTemplate(emailServiceChartPath, ['--set', 'waitForBootstrap.enabled=true']);
  const deployment = docs.find((doc) => doc.kind === 'Deployment');
  assert.ok(deployment);
  const waitInit = deployment.spec.template.spec.initContainers.find((container) => container.name === 'wait-for-bootstrap');
  assert.ok(waitInit);
  assert.equal(waitInit.image, pinnedImage('pgvector'));
});
