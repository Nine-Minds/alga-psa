import {
  updatePortalDomain,
  upsertPortalDomain,
  isTerminalStatus,
  type UpdatePortalDomainInput,
} from '@/models/PortalDomainModel';

import { enqueuePortalDomainWorkflow } from '../workflowClient';
import type {
  PortalDomainProvisioner,
  ReconcileInput,
  RegisterInput,
  RegisterResult,
} from './types';

/**
 * Hosted/cloud provisioner. Behavior-preserving extraction of what the server
 * actions used to do inline: upsert the row to a pending state and drive the
 * Temporal workflow (DNS verification -> certificate -> Istio routing).
 */
export const temporalProvisioner: PortalDomainProvisioner = {
  async register(input: RegisterInput): Promise<RegisterResult> {
    const { knex, tenant, canonicalHost, domain, existing, domainChanged } = input;

    const record = await upsertPortalDomain(knex, tenant, {
      domain,
      status: 'pending_dns',
      statusMessage: domainChanged
        ? `Updating custom domain. Waiting for DNS verification of ${domain}.`
        : `Waiting for DNS verification. Point a CNAME to ${canonicalHost}.`,
      verificationDetails: {
        expected_cname: canonicalHost,
        requested_domain: domain,
        ...(existing && domainChanged ? { previous_domain: existing.domain } : {}),
      },
      lastCheckedAt: new Date().toISOString(),
      certificateSecretName: null,
      lastSyncedResourceVersion: null,
    });

    const workflowResult = await enqueuePortalDomainWorkflow({
      tenantId: tenant,
      portalDomainId: record.id,
      trigger: domainChanged ? 'refresh' : 'register',
    });

    if (!workflowResult.enqueued) {
      await updatePortalDomain(knex, tenant, {
        status: 'pending_dns',
        statusMessage: domainChanged
          ? 'Saved domain change, but failed to enqueue provisioning. Please retry or contact support.'
          : 'Saved domain, but failed to enqueue provisioning. Please try again or contact support.',
      });
    }

    return { enqueued: workflowResult.enqueued };
  },

  async refresh(input: ReconcileInput): Promise<void> {
    const { tenant, existing } = input;

    if (!isTerminalStatus(existing.status)) {
      await enqueuePortalDomainWorkflow({
        tenantId: tenant,
        portalDomainId: existing.id,
        trigger: 'refresh',
      }).catch(() => undefined);
    }
  },

  async retry(input: ReconcileInput): Promise<void> {
    const { knex, tenant, existing } = input;

    const now = new Date().toISOString();
    const nextStatus: UpdatePortalDomainInput = { lastCheckedAt: now };

    if (existing.status === 'dns_failed') {
      nextStatus.status = 'pending_dns';
      nextStatus.statusMessage = `Retrying DNS verification. Ensure ${existing.domain} points to ${existing.canonicalHost}.`;
    } else {
      nextStatus.status = 'pending_certificate';
      nextStatus.statusMessage = 'Retrying certificate provisioning. Verifying ACME challenge reachability.';
    }

    const updated = await updatePortalDomain(knex, tenant, nextStatus);

    if (updated) {
      await enqueuePortalDomainWorkflow({
        tenantId: tenant,
        portalDomainId: updated.id,
        trigger: 'refresh',
      }).catch(() => undefined);
    }
  },

  async disable(input: ReconcileInput): Promise<void> {
    const { knex, tenant } = input;

    const updated = await updatePortalDomain(knex, tenant, {
      status: 'disabled',
      statusMessage: 'Custom domain disabled by administrator.',
      lastCheckedAt: new Date().toISOString(),
      certificateSecretName: null,
      lastSyncedResourceVersion: null,
    });

    if (updated) {
      await enqueuePortalDomainWorkflow({
        tenantId: tenant,
        portalDomainId: updated.id,
        trigger: 'disable',
      }).catch(() => undefined);
    }
  },
};
