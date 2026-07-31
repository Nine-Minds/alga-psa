import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResetJob,
  buildResetSecret,
  readInitialAdminIdentity,
  resetPasswordPolicyError,
  runInitialAdminPasswordReset,
} from '../admin-password-reset.mjs';

const email = 'admin@example.test';
const tenantId = '11111111-2222-4333-8444-555555555555';
const password = 'N3w!AppliancePass';

function encoded(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function appDeployment() {
  return {
    metadata: { name: 'alga-core-sebastian', uid: 'deployment-uid' },
    spec: {
      template: {
        spec: {
          serviceAccountName: 'alga-core',
          imagePullSecrets: [{ name: 'registry' }],
          securityContext: { runAsNonRoot: true },
          containers: [{
            name: 'sebastian',
            image: 'ghcr.io/nine-minds/alga-psa-ee:c18cf795',
            imagePullPolicy: 'IfNotPresent',
            env: [
              { name: 'ITERATIONS', value: '1000' },
              { name: 'KEY_LENGTH', value: '64' },
              { name: 'ALGORITHM', value: 'sha512' },
              { name: 'NEXTAUTH_SECRET', valueFrom: { secretKeyRef: { name: 'alga-secrets', key: 'NEXTAUTH_SECRET' } } },
              { name: 'DB_PASSWORD_ADMIN', valueFrom: { secretKeyRef: { name: 'db-credentials', key: 'DB_PASSWORD_SUPERUSER' } } },
            ],
            securityContext: { allowPrivilegeEscalation: false },
          }],
        },
      },
    },
  };
}

function fakeKube(overrides = {}) {
  const calls = [];
  let jobReads = 0;
  return {
    calls,
    quote: (value) => `'${String(value).replaceAll("'", "'\\''")}'`,
    json: async (args) => {
      calls.push(['json', args]);
      if (overrides.json) return overrides.json(args);
      if (args === 'get secret appliance-initial-tenant -n msp') {
        return { ok: true, value: { data: { INITIAL_ADMIN_EMAIL: encoded(email), INITIAL_TENANT_ID: encoded(tenantId) } } };
      }
      if (args.includes('get jobs')) return { ok: true, value: { items: [] } };
      if (args.includes('get deployment')) return { ok: true, value: appDeployment() };
      if (args.includes('get job')) {
        jobReads += 1;
        return jobReads === 1
          ? { ok: true, value: { metadata: { uid: 'job-uid' }, status: { active: 1 } } }
          : { ok: true, value: { metadata: { uid: 'job-uid' }, status: { succeeded: 1 } } };
      }
      return { ok: false };
    },
    apply: async (manifest) => {
      calls.push(['apply', manifest]);
      return { ok: true };
    },
    run: async (args) => {
      calls.push(['run', args]);
      return { ok: true };
    },
  };
}

test('password policy matches appliance setup requirements', () => {
  assert.equal(resetPasswordPolicyError('short'), 'Use at least 8 characters.');
  assert.equal(resetPasswordPolicyError('NoNumber!'), 'Include a number.');
  assert.equal(resetPasswordPolicyError(password), null);
});

test('original administrator identity is decoded from appliance-owned state', async () => {
  const identity = await readInitialAdminIdentity(fakeKube());
  assert.deepEqual(identity, { available: true, email, tenantId });
});

test('reset resources keep plaintext out of job metadata and arguments', () => {
  const deployment = appDeployment();
  const secret = buildResetSecret({ name: 'reset-1', password, email, tenantId, appDeployment: deployment });
  const job = buildResetJob({ name: 'reset-1', secretName: 'reset-1', appDeployment: deployment });

  assert.equal(secret.stringData.RESET_ADMIN_PASSWORD, password);
  assert.equal(secret.metadata.ownerReferences[0].uid, 'deployment-uid');
  assert.equal(JSON.stringify(secret.metadata).includes(password), false);
  assert.equal(JSON.stringify(job).includes(password), false);

  const container = job.spec.template.spec.containers[0];
  assert.equal(container.image, 'ghcr.io/nine-minds/alga-psa-ee:c18cf795');
  assert.deepEqual(container.command, ['node', '/app/server/scripts/appliance-reset-admin-password.mjs']);
  assert.equal(container.env.find((entry) => entry.name === 'ITERATIONS').value, '1000');
  assert.equal(container.env.find((entry) => entry.name === 'RESET_ADMIN_PASSWORD').valueFrom.secretKeyRef.name, 'reset-1');
  assert.equal(job.spec.ttlSecondsAfterFinished, 300);
});

test('successful reset creates, secures, waits for, and cleans up transient resources', async () => {
  const kube = fakeKube();
  const result = await runInitialAdminPasswordReset({
    kube,
    password,
    passwordConfirm: password,
    waitOptions: { pollMs: 0, sleep: async () => {} },
  });

  assert.deepEqual(result, { ok: true, email });
  const applied = kube.calls.filter(([kind]) => kind === 'apply').map(([, value]) => value);
  assert.deepEqual(applied.map((manifest) => manifest.kind), ['Secret', 'Job']);
  assert.ok(kube.calls.some(([kind, args]) => kind === 'run' && args.includes('patch secret') && args.includes('job-uid')));
  assert.ok(kube.calls.some(([kind, args]) => kind === 'run' && args.includes('delete job')));
  assert.ok(kube.calls.some(([kind, args]) => kind === 'run' && args.includes('delete secret')));

  const observableCalls = kube.calls
    .filter(([kind]) => kind !== 'apply')
    .map((call) => JSON.stringify(call))
    .join('\n');
  assert.equal(observableCalls.includes(password), false);
});

test('an active reset is rejected before any resource mutation', async () => {
  const kube = fakeKube({
    json: (args) => {
      if (args.includes('get secret')) {
        return { ok: true, value: { data: { INITIAL_ADMIN_EMAIL: encoded(email), INITIAL_TENANT_ID: encoded(tenantId) } } };
      }
      if (args.includes('get jobs')) return { ok: true, value: { items: [{ status: { active: 1 } }] } };
      throw new Error(`unexpected query: ${args}`);
    },
  });
  const result = await runInitialAdminPasswordReset({ kube, password, passwordConfirm: password });
  assert.equal(result.status, 409);
  assert.equal(kube.calls.some(([kind]) => kind === 'apply'), false);
});

test('job-list uncertainty fails closed before mutation', async () => {
  const kube = fakeKube({
    json: (args) => {
      if (args.includes('get secret')) {
        return { ok: true, value: { data: { INITIAL_ADMIN_EMAIL: encoded(email), INITIAL_TENANT_ID: encoded(tenantId) } } };
      }
      if (args.includes('get jobs')) return { ok: false };
      throw new Error(`unexpected query: ${args}`);
    },
  });
  const result = await runInitialAdminPasswordReset({ kube, password, passwordConfirm: password });
  assert.equal(result.status, 502);
  assert.equal(kube.calls.some(([kind]) => kind === 'apply'), false);
});
