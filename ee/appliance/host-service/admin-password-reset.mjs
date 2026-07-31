import crypto from 'node:crypto';

const RESET_LABEL = 'app.kubernetes.io/component=initial-admin-password-reset';
const RESET_COMPONENT = 'initial-admin-password-reset';
const RESET_SCRIPT = '/app/server/scripts/appliance-reset-admin-password.mjs';

function decodeSecretValue(value) {
  if (typeof value !== 'string') return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export function resetPasswordPolicyError(value) {
  if (typeof value !== 'string' || value.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(value)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Include an uppercase letter.';
  if (!/\d/.test(value)) return 'Include a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) return 'Include a special character.';
  return null;
}

export async function readInitialAdminIdentity(kube, options = {}) {
  const namespace = options.namespace || 'msp';
  const secretName = options.initialTenantSecretName || 'appliance-initial-tenant';
  const result = await kube.json(`get secret ${secretName} -n ${namespace}`);
  const data = result?.ok ? result.value?.data : null;
  const email = decodeSecretValue(data?.INITIAL_ADMIN_EMAIL).trim().toLowerCase();
  const tenantId = decodeSecretValue(data?.INITIAL_TENANT_ID).trim();
  return {
    available: Boolean(email && tenantId),
    email: email || null,
    tenantId: tenantId || null,
  };
}

function resetName(now = Date.now()) {
  const entropy = crypto.randomBytes(3).toString('hex');
  return `alga-admin-password-reset-${now}-${entropy}`.toLowerCase();
}

function resetLabels() {
  return {
    'app.kubernetes.io/name': RESET_COMPONENT,
    'app.kubernetes.io/component': RESET_COMPONENT,
    'app.kubernetes.io/part-of': 'alga-appliance',
  };
}

export function buildResetSecret({ name, namespace = 'msp', password, email, tenantId, appDeployment }) {
  const deploymentOwner = appDeployment?.metadata?.uid ? [{
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    name: appDeployment.metadata.name,
    uid: appDeployment.metadata.uid,
    controller: false,
    blockOwnerDeletion: false,
  }] : undefined;
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace, labels: resetLabels(), ownerReferences: deploymentOwner },
    type: 'Opaque',
    stringData: {
      RESET_ADMIN_PASSWORD: password,
      RESET_ADMIN_EMAIL: email,
      RESET_ADMIN_TENANT_ID: tenantId,
    },
  };
}

function resetInputEnv(secretName) {
  return ['RESET_ADMIN_PASSWORD', 'RESET_ADMIN_EMAIL', 'RESET_ADMIN_TENANT_ID'].map((name) => ({
    name,
    valueFrom: { secretKeyRef: { name: secretName, key: name } },
  }));
}

export function buildResetJob({
  name,
  namespace = 'msp',
  secretName,
  appDeployment,
}) {
  const templateSpec = appDeployment?.spec?.template?.spec || {};
  const appContainer = (templateSpec.containers || []).find((container) => container.name === 'sebastian')
    || (templateSpec.containers || [])[0];
  if (!appContainer?.image) {
    throw new Error('The running Alga application image could not be determined.');
  }

  const inheritedEnv = (appContainer.env || []).filter((entry) =>
    !['RESET_ADMIN_PASSWORD', 'RESET_ADMIN_EMAIL', 'RESET_ADMIN_TENANT_ID'].includes(entry.name));

  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name, namespace, labels: resetLabels() },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 120,
      ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: resetLabels() },
        spec: {
          restartPolicy: 'Never',
          serviceAccountName: templateSpec.serviceAccountName,
          imagePullSecrets: templateSpec.imagePullSecrets,
          securityContext: templateSpec.securityContext,
          containers: [{
            name: 'reset-admin-password',
            image: appContainer.image,
            imagePullPolicy: appContainer.imagePullPolicy,
            command: ['node', RESET_SCRIPT],
            env: [...inheritedEnv, ...resetInputEnv(secretName)],
            envFrom: appContainer.envFrom,
            securityContext: appContainer.securityContext,
            resources: {
              requests: { cpu: '25m', memory: '64Mi' },
              limits: { cpu: '250m', memory: '256Mi' },
            },
          }],
        },
      },
    },
  };
}

function jobIsActive(job) {
  if (Number(job?.status?.active || 0) > 0) return true;
  const terminal = Number(job?.status?.succeeded || 0) > 0 || Number(job?.status?.failed || 0) > 0;
  return !terminal;
}

async function cleanupResetResources(kube, namespace, name) {
  await kube.run(`delete job ${name} -n ${namespace} --ignore-not-found=true --wait=false`).catch(() => {});
  await kube.run(`delete secret ${name} -n ${namespace} --ignore-not-found=true --wait=false`).catch(() => {});
}

async function makeJobOwnSecret(kube, namespace, name) {
  const jobResult = await kube.json(`get job ${name} -n ${namespace}`);
  const uid = jobResult?.ok ? jobResult.value?.metadata?.uid : null;
  if (!uid) return false;
  const patch = JSON.stringify({
    metadata: {
      ownerReferences: [{
        apiVersion: 'batch/v1',
        kind: 'Job',
        name,
        uid,
        controller: false,
        blockOwnerDeletion: false,
      }],
    },
  });
  const patched = await kube.run(`patch secret ${name} -n ${namespace} --type=merge -p ${kube.quote(patch)}`);
  return Boolean(patched?.ok);
}

async function waitForResetJob(kube, namespace, name, options = {}) {
  const timeoutMs = options.timeoutMs || 150_000;
  const pollMs = options.pollMs || 1_000;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await kube.json(`get job ${name} -n ${namespace}`);
    const job = result?.ok ? result.value : null;
    if (Number(job?.status?.succeeded || 0) === 1) return { ok: true };
    if (Number(job?.status?.failed || 0) > 0) return { ok: false };
    await sleep(pollMs);
  }
  return { ok: false };
}

export async function runInitialAdminPasswordReset(deps) {
  const {
    kube,
    password,
    passwordConfirm,
    namespace = 'msp',
    appDeploymentName = 'alga-core-sebastian',
    waitOptions = {},
  } = deps;

  const policyError = resetPasswordPolicyError(password);
  if (policyError) return { ok: false, status: 400, error: policyError };
  if (password !== passwordConfirm) {
    return { ok: false, status: 400, error: 'Passwords do not match.' };
  }

  const identity = await readInitialAdminIdentity(kube, { namespace });
  if (!identity.available) {
    return { ok: false, status: 412, error: 'The original Alga administrator identity is unavailable.' };
  }

  const existing = await kube.json(`get jobs -n ${namespace} -l ${RESET_LABEL}`);
  if (!existing?.ok) {
    return { ok: false, status: 502, error: 'Unable to determine whether a password reset is already running.' };
  }
  if ((existing.value?.items || []).some(jobIsActive)) {
    return { ok: false, status: 409, error: 'An Alga administrator password reset is already running.' };
  }

  const deployment = await kube.json(`get deployment ${appDeploymentName} -n ${namespace}`);
  if (!deployment?.ok || !deployment.value) {
    return { ok: false, status: 412, error: 'The Alga application deployment is unavailable.' };
  }

  const name = resetName();
  const secret = buildResetSecret({
    name,
    namespace,
    password,
    email: identity.email,
    tenantId: identity.tenantId,
    appDeployment: deployment.value,
  });
  const job = buildResetJob({
    name,
    namespace,
    secretName: name,
    appDeployment: deployment.value,
  });

  try {
    const secretResult = await kube.apply(secret);
    if (!secretResult?.ok) {
      return { ok: false, status: 502, error: 'Unable to prepare the password reset.' };
    }
    const jobResult = await kube.apply(job);
    if (!jobResult?.ok) {
      return { ok: false, status: 502, error: 'Unable to start the password reset.' };
    }
    if (!(await makeJobOwnSecret(kube, namespace, name))) {
      return { ok: false, status: 502, error: 'Unable to secure the password reset resources.' };
    }

    const completed = await waitForResetJob(kube, namespace, name, waitOptions);
    if (!completed.ok) {
      return { ok: false, status: 502, error: 'The password reset did not complete successfully.' };
    }
    return { ok: true, email: identity.email };
  } finally {
    await cleanupResetResources(kube, namespace, name);
  }
}
