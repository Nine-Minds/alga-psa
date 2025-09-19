import { proxyActivities, setHandler, sleep, workflow, Trigger } from '@temporalio/workflow';
import type {
  PortalDomainWorkflowInput,
  PortalDomainWorkflowTrigger,
  PortalDomainActivityRecord,
  VerifyCnameResult,
  ReconcileResult,
} from './types';

const {
  loadPortalDomain,
  markPortalDomainStatus,
  verifyCnameRecord,
  reconcilePortalDomains,
} = proxyActivities<{
  loadPortalDomain: (args: { portalDomainId: string }) => Promise<PortalDomainActivityRecord | null>;
  markPortalDomainStatus: (args: { portalDomainId: string; status: string; statusMessage?: string | null; verificationDetails?: Record<string, unknown> | null }) => Promise<void>;
  verifyCnameRecord: (args: { domain: string; expectedCname: string; attempts?: number; intervalSeconds?: number }) => Promise<VerifyCnameResult>;
  reconcilePortalDomains: (args: { tenantId: string; portalDomainId: string }) => Promise<ReconcileResult>;
}>(
  {
    startToCloseTimeout: '5 minutes',
    retry: {
      maximumAttempts: 3,
    },
  }
);

const SIGNAL_RECONCILE = 'reconcilePortalDomainState';

export async function portalDomainRegistrationWorkflow(input: PortalDomainWorkflowInput): Promise<void> {
  workflow.log.info('Portal domain workflow started', input);

  let pendingTrigger: PortalDomainWorkflowTrigger | undefined = input.trigger;
  let reconcileTrigger = new Trigger<void>();

  setHandler(SIGNAL_RECONCILE, (payload?: PortalDomainWorkflowInput) => {
    pendingTrigger = payload?.trigger ?? 'refresh';
    workflow.log.info('Received reconcile signal', { pendingTrigger });
    reconcileTrigger.resolve();
  });

  async function runOnce(triggerReason: PortalDomainWorkflowTrigger | undefined): Promise<void> {
    const record = await loadPortalDomain({ portalDomainId: input.portalDomainId });

    if (!record) {
      workflow.log.warn('Portal domain not found; exiting workflow', { portalDomainId: input.portalDomainId });
      return;
    }

    const details = (record.verification_details || {}) as Record<string, unknown>;
    const expectedCandidate = details?.expected_cname;
    const expectedCname = typeof expectedCandidate === 'string' && expectedCandidate.length > 0
      ? expectedCandidate
      : record.canonical_host;

    if (record.status === 'disabled') {
      workflow.log.info('Domain disabled, ensuring reconciliation for cleanup');
      await markPortalDomainStatus({
        portalDomainId: record.id,
        status: 'disabled',
        statusMessage: 'Custom domain disabled. Awaiting reconciliation cleanup.',
      });
      await reconcilePortalDomains({ tenantId: record.tenant, portalDomainId: record.id });
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

    const reconcile = await reconcilePortalDomains({ tenantId: record.tenant, portalDomainId: record.id });

    if (!reconcile.success) {
      await markPortalDomainStatus({
        portalDomainId: record.id,
        status: 'certificate_failed',
        statusMessage: `Failed to reconcile Kubernetes resources: ${reconcile.errors?.join('; ') ?? 'Unknown error'}`,
      });
      return;
    }

    await markPortalDomainStatus({
      portalDomainId: record.id,
      status: 'deploying',
      statusMessage: 'Resources applied. Waiting for certificate and gateway readiness.',
    });
  }

  await runOnce(pendingTrigger);

  while (true) {
    const timeoutPromise = sleep('5 minutes');
    await Promise.race([timeoutPromise, reconcileTrigger]);

    if (!pendingTrigger) {
      workflow.log.info('No pending trigger after wake; ending workflow.');
      return;
    }

    const triggerToProcess = pendingTrigger;
    pendingTrigger = undefined;
    reconcileTrigger = new Trigger<void>();
    await runOnce(triggerToProcess);
  }
}
