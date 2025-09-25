import { proxyActivities, setHandler, sleep, Trigger, defineSignal, log } from '@temporalio/workflow';
import type {
  PortalDomainWorkflowInput,
  PortalDomainWorkflowTrigger,
  PortalDomainActivityRecord,
  VerifyCnameResult,
  ApplyPortalDomainResourcesResult,
  PortalDomainStatusSnapshot,
  HttpChallengeDetails,
} from './types';

const {
  loadPortalDomain,
  markPortalDomainStatus,
  verifyCnameRecord,
  applyPortalDomainResources,
  checkPortalDomainDeploymentStatus,
  waitForHttpChallenge,
  ensureHttpChallengeRoute,
  removeHttpChallengeRoute,
} = proxyActivities<{
  loadPortalDomain: (args: { portalDomainId: string }) => Promise<PortalDomainActivityRecord | null>;
  markPortalDomainStatus: (args: { portalDomainId: string; status: string; statusMessage?: string | null; verificationDetails?: Record<string, unknown> | null }) => Promise<void>;
  verifyCnameRecord: (args: { domain: string; expectedCname: string; attempts?: number; intervalSeconds?: number }) => Promise<VerifyCnameResult>;
  applyPortalDomainResources: (args: { tenantId: string; portalDomainId: string }) => Promise<ApplyPortalDomainResourcesResult>;
  checkPortalDomainDeploymentStatus: (args: { portalDomainId: string }) => Promise<PortalDomainStatusSnapshot | null>;
  waitForHttpChallenge: (args: { portalDomainId: string }) => Promise<HttpChallengeDetails>;
  ensureHttpChallengeRoute: (args: { portalDomainId: string; challenge: HttpChallengeDetails }) => Promise<void>;
  removeHttpChallengeRoute: (args: { portalDomainId: string }) => Promise<void>;
}>(
  {
    startToCloseTimeout: '5 minutes',
    retry: {
      maximumAttempts: 3,
    },
  }
);

const reconcileSignal = defineSignal<[PortalDomainWorkflowInput | undefined]>('reconcilePortalDomainState');

export async function portalDomainRegistrationWorkflow(input: PortalDomainWorkflowInput): Promise<void> {
  log.info('Portal domain workflow started', { input });

  let pendingTrigger: PortalDomainWorkflowTrigger | undefined = input.trigger;
  let reconcileTrigger = new Trigger<void>();
  let challengeRoutePrepared = false;

  setHandler(reconcileSignal, (payload?: PortalDomainWorkflowInput) => {
    pendingTrigger = payload?.trigger ?? 'refresh';
    log.info('Received reconcile signal', { pendingTrigger });
    reconcileTrigger.resolve();
  });

  async function runOnce(triggerReason: PortalDomainWorkflowTrigger | undefined): Promise<void> {
    const record = await loadPortalDomain({ portalDomainId: input.portalDomainId });

    if (!record) {
      log.warn('Portal domain not found; exiting workflow', { portalDomainId: input.portalDomainId });
      return;
    }

    const details = (record.verification_details || {}) as Record<string, unknown>;
    const expectedCandidate = details?.expected_cname;
    const expectedCname = typeof expectedCandidate === 'string' && expectedCandidate.length > 0
      ? expectedCandidate
      : record.canonical_host;

    if (record.status === 'disabled') {
      log.info('Domain disabled, ensuring resource cleanup');
      await markPortalDomainStatus({
        portalDomainId: record.id,
        status: 'disabled',
        statusMessage: 'Custom domain disabled. Awaiting resource cleanup.',
      });
      await applyPortalDomainResources({ tenantId: record.tenant, portalDomainId: record.id });
      if (challengeRoutePrepared) {
        await removeHttpChallengeRoute({ portalDomainId: record.id }).catch(() => undefined);
        challengeRoutePrepared = false;
      }
      return;
    }

    await markPortalDomainStatus({
      portalDomainId: record.id,
      status: 'verifying_dns',
      statusMessage: `Verifying that ${record.domain} points to ${expectedCname}`,
    });

    const dns = await verifyCnameRecord({
      domain: record.domain,
      expectedCname,
      attempts: 12,
      intervalSeconds: 10,
    });

    if (!dns.matched) {
      await markPortalDomainStatus({
        portalDomainId: record.id,
        status: 'dns_failed',
        statusMessage: `Detected ${dns.observed.join(', ') || 'no CNAME record'}; expected ${expectedCname}. ${dns.message}`,
        verificationDetails: {
          ...record.verification_details,
          last_observed_cname: dns.observed,
          last_observed_at: new Date().toISOString(),
        },
      });
      return;
    }

    await markPortalDomainStatus({
      portalDomainId: record.id,
      status: 'pending_certificate',
      statusMessage: 'DNS verified. Preparing Kubernetes resources and HTTP-01 challenge.',
    });

    const applyResult = await applyPortalDomainResources({ tenantId: record.tenant, portalDomainId: record.id });

    if (!applyResult.success) {
      await markPortalDomainStatus({
        portalDomainId: record.id,
        status: 'certificate_failed',
        statusMessage: `Failed to apply Kubernetes resources: ${applyResult.errors?.join('; ') ?? 'Unknown error'}`,
      });
      if (challengeRoutePrepared) {
        await removeHttpChallengeRoute({ portalDomainId: record.id }).catch(() => undefined);
        challengeRoutePrepared = false;
      }
      return;
    }

    await markPortalDomainStatus({
      portalDomainId: record.id,
      status: 'deploying',
      statusMessage: 'Resources applied. Waiting for ACME HTTP-01 challenge.',
    });

    try {
      const challenge = await waitForHttpChallenge({ portalDomainId: record.id });
      await ensureHttpChallengeRoute({ portalDomainId: record.id, challenge });
      challengeRoutePrepared = true;
      await markPortalDomainStatus({
        portalDomainId: record.id,
        status: 'deploying',
        statusMessage: 'ACME challenge detected. Waiting for certificate issuance.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to prepare HTTP-01 challenge routing', {
        portalDomainId: record.id,
        error: message,
      });
      await markPortalDomainStatus({
        portalDomainId: record.id,
        status: 'certificate_failed',
        statusMessage: `Failed to prepare HTTP-01 challenge routing: ${message}`,
      });
      if (challengeRoutePrepared) {
        await removeHttpChallengeRoute({ portalDomainId: record.id }).catch(() => undefined);
        challengeRoutePrepared = false;
      }
      return;
    }

    log.info('HTTP-01 challenge routing prepared, continuing to monitor certificate.', {
      portalDomainId: record.id,
    });
  }

  const initialTrigger = pendingTrigger;
  pendingTrigger = undefined;
  await runOnce(initialTrigger);

  const terminalStatuses = new Set(['active', 'disabled', 'dns_failed', 'certificate_failed']);

  while (true) {
    const timeoutPromise = sleep('1 minute');
    await Promise.race([timeoutPromise, reconcileTrigger]);

    if (pendingTrigger) {
      const triggerToProcess = pendingTrigger;
      pendingTrigger = undefined;
      reconcileTrigger = new Trigger<void>();
      await runOnce(triggerToProcess);
      continue;
    }

    const deploymentStatus = await checkPortalDomainDeploymentStatus({ portalDomainId: input.portalDomainId });

    if (!deploymentStatus) {
      log.warn('Portal domain record missing during deployment check; ending workflow.', {
        portalDomainId: input.portalDomainId,
      });
      return;
    }

    if (terminalStatuses.has(deploymentStatus.status)) {
      log.info('Portal domain reached terminal status; ending workflow.', {
        portalDomainId: input.portalDomainId,
        status: deploymentStatus.status,
      });
      if (challengeRoutePrepared) {
        await removeHttpChallengeRoute({ portalDomainId: input.portalDomainId }).catch(() => undefined);
        challengeRoutePrepared = false;
      }
      return;
    }

    log.info('Portal domain still progressing; continuing wait.', {
      portalDomainId: input.portalDomainId,
      status: deploymentStatus.status,
    });
  }
}
