import { proxyActivities, setHandler, sleep, Trigger, defineSignal, log } from '@temporalio/workflow';
import type {
  PortalDomainWorkflowInput,
  PortalDomainWorkflowTrigger,
  PortalDomainActivityRecord,
  VerifyCnameResult,
  ApplyPortalDomainResourcesResult,
  PortalDomainStatusSnapshot,
} from './types';

const {
  loadPortalDomain,
  markPortalDomainStatus,
  verifyCnameRecord,
  applyPortalDomainResources,
  checkPortalDomainDeploymentStatus,
} = proxyActivities<{
  loadPortalDomain: (args: { portalDomainId: string }) => Promise<PortalDomainActivityRecord | null>;
  markPortalDomainStatus: (args: { portalDomainId: string; status: string; statusMessage?: string | null; verificationDetails?: Record<string, unknown> | null }) => Promise<void>;
  verifyCnameRecord: (args: { domain: string; expectedCname: string; attempts?: number; intervalSeconds?: number }) => Promise<VerifyCnameResult>;
  applyPortalDomainResources: (args: { tenantId: string; portalDomainId: string }) => Promise<ApplyPortalDomainResourcesResult>;
  checkPortalDomainDeploymentStatus: (args: { portalDomainId: string }) => Promise<PortalDomainStatusSnapshot | null>;
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

    const verificationDetails = {
      ...(record.verification_details ?? {}),
      expected_cname: expectedCname,
      last_verified_at: new Date().toISOString(),
      last_verified_cnames: dns.observed,
    };

    await markPortalDomainStatus({
      portalDomainId: record.id,
      status: 'pending_certificate',
      statusMessage: 'DNS verified. Preparing Kubernetes resources for certificate issuance.',
      verificationDetails,
    });

    const applyResult = await applyPortalDomainResources({ tenantId: record.tenant, portalDomainId: record.id });

    if (!applyResult.success) {
      await markPortalDomainStatus({
        portalDomainId: record.id,
        status: 'certificate_failed',
        statusMessage: `Failed to apply Kubernetes resources: ${applyResult.errors?.join('; ') ?? 'Unknown error'}`,
      });
      return;
    }

    await markPortalDomainStatus({
      portalDomainId: record.id,
      status: 'deploying',
      statusMessage: 'Resources applied. Waiting for certificate issuance.',
    });
  }

  const initialTrigger = pendingTrigger;
  pendingTrigger = undefined;
  await runOnce(initialTrigger);

  const terminalStatuses = new Set(['active', 'disabled', 'dns_failed']);

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

    const isRecoverableCertificateFailure =
      deploymentStatus.status === 'certificate_failed' &&
      typeof deploymentStatus.statusMessage === 'string' &&
      deploymentStatus.statusMessage.toLowerCase().includes('secret does not exist');

    if (terminalStatuses.has(deploymentStatus.status)) {
      log.info('Portal domain reached terminal status; ending workflow.', {
        portalDomainId: input.portalDomainId,
        status: deploymentStatus.status,
      });
      return;
    }

    if (deploymentStatus.status === 'certificate_failed' && !isRecoverableCertificateFailure) {
      log.info('Certificate failed with non-recoverable error; ending workflow.', {
        portalDomainId: input.portalDomainId,
        statusMessage: deploymentStatus.statusMessage,
      });
      return;
    }

    if (deploymentStatus.status === 'certificate_failed' && isRecoverableCertificateFailure) {
      log.info('Certificate secret missing; continuing to monitor.', {
        portalDomainId: input.portalDomainId,
      });
    }

    log.info('Portal domain still progressing; continuing wait.', {
      portalDomainId: input.portalDomainId,
      status: deploymentStatus.status,
    });
  }
}
