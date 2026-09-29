import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { testRevision } from './lib/test-revision.mjs';
import { verifyMicrosoftCallbackEvidence } from './lib/microsoft-callback-evidence.mjs';

export function callbackRuntimeBinding({ image, container, root, revision }) {
  const mountsReadOnly = ['packages', 'ee', 'e2e-tests'].every(part => {
    const matches = container.Mounts?.filter(mount => mount.Destination === `/app/${part}`) || [];
    return matches.length === 1 && matches[0].Type === 'bind' && matches[0].RW === false
      && path.resolve(matches[0].Source) === path.resolve(root, part);
  });
  return { imageRevision: image.revision, imageId: image.id, containerImageId: container.Image,
    mountedSourceRevision: revision, mountsReadOnly };
}

export function callbackComposeOverride({ root, temporary, output, revision, sourceEmail }) {
  return { services: { server: {
    image: 'alga-e2e-test_server_ee_local:latest',
    entrypoint: ['node', '/app/packages/auth/test-harness/start-microsoft-callback-ci.mjs'], command: [],
    environment: {
      CI: 'true', NODE_ENV: 'development', NODE_OPTIONS: '--max-old-space-size=12288',
      NATIVE_MICROSOFT_OIDC_ISOLATED: 'true', E2E_DATABASE_ISOLATED: 'true',
      NATIVE_MICROSOFT_OIDC_EXPECTED_DB_HOST: 'postgres', NATIVE_MICROSOFT_OIDC_EXPECTED_DB_NAME: 'server',
      DB_HOST: 'postgres', DB_PORT: '5432', DB_NAME_SERVER: 'server', DB_USER_ADMIN: 'postgres', DB_PASSWORD_ADMIN: 'placeholder-password',
      REDIS_HOST: 'redis', REDIS_PORT: '6379', TEMPORAL_ADDRESS: 'temporal-dev:7233',
      NATIVE_MICROSOFT_OIDC_SOURCE_EMAIL: sourceEmail, NATIVE_MICROSOFT_OIDC_REPORT: '/callback-output/microsoft-callback-report.json',
      NATIVE_MICROSOFT_OIDC_APP_ROOT: '/app', NATIVE_MICROSOFT_OIDC_PLAYWRIGHT_ROOT: '/app/e2e-tests', E2E_TEST_REVISION: revision,
    },
    volumes: [
      ...['packages', 'ee', 'e2e-tests'].map(part => ({ type: 'bind', source: path.join(root, part), target: `/app/${part}`, read_only: true })),
      { type: 'bind', source: output, target: '/callback-output' },
      { type: 'bind', source: path.join(temporary, 'dist'), target: '/app/server/.next/microsoft-oidc-callback' },
      { type: 'bind', source: path.join(temporary, 'webpack'), target: '/app/server/node_modules/.cache/webpack' },
    ],
  } } };
}

export function runMicrosoftCallbackCi({ env = process.env } = {}) {
  assert.equal(env.CI, 'true');
  assert.ok(env.GITHUB_WORKSPACE && env.RUNNER_TEMP && env.COMPOSE_FILE && env.NATIVE_MICROSOFT_OIDC_SOURCE_EMAIL);
  const root = env.GITHUB_WORKSPACE;
  const temporary = path.join(env.RUNNER_TEMP, 'microsoft-callback');
  const output = path.join(root, 'test-results/microsoft-callback');
  mkdirSync(output, { recursive: true });
  const save = (name, value) => writeFileSync(path.join(output, `microsoft-callback-${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  rmSync(path.join(output, 'microsoft-callback-report.json'), { force: true });
  for (const name of ['runner', 'evidence']) save(name, null);
  const containerName = `alga-microsoft-callback-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}`;
  const runner = { exitCode: null, source: {}, runtimeBinding: null };
  const command = (name, args, options = {}) => execFileSync(name, args, { cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, ...options }).trim();
  let created = false;
  try {
    runner.source.before = testRevision(root);
    assert.equal(runner.source.before.revision, env.GITHUB_SHA);
    assert.equal(runner.source.before.dirty, false, 'Callback CI requires clean source');
    const revision = runner.source.before.revision;
    const image = JSON.parse(command('docker', ['image', 'inspect', '--format', '{"id":{{json .Id}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}', 'alga-e2e-test_server_ee_local:latest']));
    assert.equal(image.revision, revision, 'Callback image must match tested checkout');
    const overlay = path.join(temporary, 'compose.json');
    writeFileSync(overlay, JSON.stringify(callbackComposeOverride({ root, temporary, output, revision, sourceEmail: env.NATIVE_MICROSOFT_OIDC_SOURCE_EMAIL })));
    const composeEnv = { ...env, COMPOSE_FILE: `${env.COMPOSE_FILE}:${overlay}` };
    command('docker-compose', ['-p', 'alga-e2e-test', 'stop', 'server']);
    // Keep the completed container until its actual image and mounts are inspected.
    created = true;
    command('docker-compose', ['-p', 'alga-e2e-test', 'run', '--no-deps', '-d', '--name', containerName, 'server'], { env: composeEnv });
    const container = JSON.parse(command('docker', ['inspect', '--format', '{"Image":{{json .Image}},"Mounts":{{json .Mounts}}}', containerName]));
    runner.runtimeBinding = callbackRuntimeBinding({ image, container, root, revision });
    assert.equal(runner.runtimeBinding.mountsReadOnly, true);
    assert.equal(runner.runtimeBinding.containerImageId, image.id);
    const result = command('docker', ['wait', containerName], { timeout: 360000 });
    assert.match(result, /^\d+$/);
    runner.exitCode = Number(result);
  } catch {
    runner.failure = 'callback-ci-execution-failed';
  } finally {
    if (created) {
      try { command('docker', ['rm', '-f', containerName]); }
      catch { runner.failure = 'callback-container-cleanup-failed'; runner.exitCode = null; }
    }
    try { runner.source.after = testRevision(root); } catch { runner.source.after = null; }
    save('runner', runner);
  }
  let report;
  try { report = JSON.parse(readFileSync(path.join(output, 'microsoft-callback-report.json'), 'utf8')); } catch { report = null; }
  const evidence = verifyMicrosoftCallbackEvidence({ report, revision: env.GITHUB_SHA, source: runner.source, runtimeBinding: runner.runtimeBinding });
  if (runner.exitCode !== 0 || runner.failure) { evidence.status = 'failed'; evidence.failures.push('callback-runner-failed'); delete evidence.counts; }
  save('evidence', evidence);
  return evidence;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const evidence = runMicrosoftCallbackCi(); console.log(JSON.stringify(evidence)); if (evidence.status !== 'passed') process.exitCode = 1; }
  catch { console.error('Microsoft callback CI requires its isolated workflow configuration'); process.exitCode = 1; }
}
