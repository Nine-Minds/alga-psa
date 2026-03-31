import { v4 as uuidv4 } from 'uuid';
import type { TrialInstance, TrialRequest } from './types';
import { trialStore } from './trial-store';
import { getTrialConfig } from './config';
import { generateTrialSecrets } from './secrets';
import {
  createNamespace,
  createDbCredentialsSecret,
  createSecret,
  deleteNamespace,
  waitForPodsReady,
  waitForJobComplete,
} from './k8s';
import { helmInstall, helmUninstall } from './helm';

/**
 * Provisions a full Alga PSA trial instance:
 *  1. Creates a unique namespace
 *  2. Generates and injects secrets
 *  3. Deploys the Helm chart
 *  4. Waits for bootstrap job + pods to become ready
 *  5. Records the URL and credentials
 *
 * Runs asynchronously — the caller gets the trial ID immediately and polls for status.
 */
export async function provisionTrial(request: TrialRequest): Promise<string> {
  const config = getTrialConfig();
  const id = uuidv4().slice(0, 8);
  const namespace = `trial-${id}`;
  const releaseName = `alga-trial-${id}`;
  const host = `${id}.${config.baseDomain}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.trialDurationHours * 60 * 60 * 1000);

  const trial: TrialInstance = {
    id,
    request,
    status: 'pending',
    statusMessage: 'Initialising trial...',
    url: null,
    credentials: null,
    namespace,
    releaseName,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    error: null,
  };

  trialStore.create(trial);

  // Fire-and-forget the deployment pipeline
  deployTrial(id, namespace, releaseName, host, config).catch(err => {
    console.error(`[trial ${id}] fatal error:`, err);
    trialStore.setError(id, err instanceof Error ? err.message : String(err));
  });

  return id;
}

async function deployTrial(
  id: string,
  namespace: string,
  releaseName: string,
  host: string,
  config: ReturnType<typeof getTrialConfig>
): Promise<void> {
  const secrets = generateTrialSecrets();

  // --- Step 1: Create namespace ---
  trialStore.updateStatus(id, 'provisioning_namespace', 'Creating isolated namespace...');
  await createNamespace(namespace);

  // --- Step 2: Create secrets ---
  trialStore.updateStatus(id, 'creating_secrets', 'Generating secure credentials...');

  await createDbCredentialsSecret(namespace, {
    superuser: secrets.postgresPassword,
    server: secrets.dbPasswordServer,
    hocuspocus: secrets.dbPasswordHocuspocus,
  });

  await createSecret(namespace, 'alga-trial-secrets', {
    CRYPTO_KEY: secrets.cryptoKey,
    TOKEN_SECRET_KEY: secrets.tokenSecretKey,
    NEXTAUTH_SECRET: secrets.nextauthSecret,
    ALGA_AUTH_KEY: secrets.algaAuthKey,
    REDIS_PASSWORD: secrets.redisPassword,
  });

  // --- Step 3: Deploy Helm chart ---
  trialStore.updateStatus(id, 'deploying_helm', 'Deploying Alga PSA services...');

  await helmInstall({
    releaseName,
    namespace,
    chartPath: config.helmChartPath,
    trialId: id,
    host,
    config,
    secrets,
  });

  // --- Step 4: Wait for bootstrap job ---
  trialStore.updateStatus(id, 'running_migrations', 'Running database migrations and seeding data...');

  const jobDone = await waitForJobComplete(namespace, `${releaseName}-bootstrap`, 300_000);
  if (!jobDone) {
    trialStore.setError(id, 'Database bootstrap timed out after 5 minutes');
    return;
  }

  // --- Step 5: Wait for server pods ---
  trialStore.updateStatus(id, 'waiting_for_pods', 'Waiting for application to start...');

  const podsReady = await waitForPodsReady(namespace, 180_000);
  if (!podsReady) {
    trialStore.setError(id, 'Application pods did not become ready within 3 minutes');
    return;
  }

  // --- Step 6: Mark ready ---
  const trialUrl = config.istioEnabled
    ? `https://${host}`
    : `https://${host}`;

  trialStore.setReady(id, trialUrl, {
    email: 'glinda@emeraldcity.oz',
    password: secrets.adminPassword,
  });

  console.log(`[trial ${id}] ready at ${trialUrl}`);
}

/**
 * Tear down a trial instance — uninstalls Helm release, deletes namespace.
 */
export async function destroyTrial(id: string): Promise<void> {
  const trial = trialStore.get(id);
  if (!trial) throw new Error(`Trial ${id} not found`);

  trialStore.updateStatus(id, 'destroying', 'Cleaning up trial environment...');

  try {
    await helmUninstall(trial.releaseName, trial.namespace);
  } catch (err) {
    console.warn(`[trial ${id}] helm uninstall warning:`, err);
  }

  try {
    await deleteNamespace(trial.namespace);
  } catch (err) {
    console.warn(`[trial ${id}] namespace cleanup warning:`, err);
  }

  trialStore.delete(id);
}

/**
 * Clean up expired trials.
 */
export async function cleanupExpiredTrials(): Promise<number> {
  const now = new Date();
  const expired = trialStore
    .getAll()
    .filter(t => new Date(t.expiresAt) < now && t.status !== 'destroying');

  for (const trial of expired) {
    try {
      await destroyTrial(trial.id);
    } catch (err) {
      console.error(`[trial ${trial.id}] cleanup error:`, err);
    }
  }

  return expired.length;
}
