'use server';

import logger from '@alga-psa/shared/core/logger';
import { getAdminConnection } from '@shared/db/admin';
import { getCurrentTenantId } from '@/lib/db';
import { getPortalDomainStatusAction } from '@/lib/actions/tenant-actions/portalDomainActions';
import { listImportJobs } from '@/lib/actions/import-actions/importActions';
import { getCalendarProviders } from '@/lib/actions/calendarActions';
import type { ImportJobRecord } from '@/types/imports.types';
import type { PortalDomainStatusResponse } from '@/lib/actions/tenant-actions/portalDomain.types';

export type OnboardingStepId =
  | 'identity_sso'
  | 'client_portal_domain'
  | 'data_import'
  | 'calendar_sync'
  | 'managed_email';

export type OnboardingStepStatus = 'not_started' | 'in_progress' | 'blocked' | 'complete';

export interface OnboardingStepServerState {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
  lastUpdated: string | null;
  blocker?: string | null;
  progressValue?: number | null;
  meta?: Record<string, unknown>;
}

export interface OnboardingProgressResponse {
  generatedAt: string;
  steps: OnboardingStepServerState[];
}

const dateToIso = (value?: string | Date | null): string | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const buildErrorStep = (
  id: OnboardingStepId,
  message: string,
  error?: unknown
): OnboardingStepServerState => {
  if (error) {
    logger.error('[onboarding-progress] Step resolution failed', { id, error });
  }

  return {
    id,
    status: 'blocked',
    blocker: message,
    lastUpdated: null,
  };
};

export async function getOnboardingProgressAction(): Promise<OnboardingProgressResponse> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    throw new Error('Tenant context is required to load onboarding progress');
  }

  const [identity, portalDomain, importStep, calendar, managedEmail] = await Promise.all([
    resolveIdentityStep(tenantId),
    resolvePortalDomainStep(),
    resolveImportStep(),
    resolveCalendarStep(),
    resolveManagedEmailStep(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    steps: [identity, portalDomain, importStep, calendar, managedEmail],
  };
}

async function resolveIdentityStep(tenantId: string): Promise<OnboardingStepServerState> {
  try {
    const { getSsoProviderOptions } = await import('@ee/lib/auth/providerConfig');
    const providerOptions = await getSsoProviderOptions();
    const configuredProviders = providerOptions.filter((option) => option.configured);

    if (configuredProviders.length === 0) {
      return {
        id: 'identity_sso',
        status: 'not_started',
        blocker: 'Add Google Workspace or Microsoft 365 credentials to enable SSO for your team.',
        lastUpdated: null,
        meta: {
          configuredProviders: [],
        },
      };
    }

    const adminDb = await getAdminConnection();
    type LinkAggregateRow = { total?: string | number | null; latest_updated?: Date | string | null };
    const aggregate = (await adminDb('user_auth_accounts')
      .where({ tenant: tenantId })
      .count('user_id as total')
      .max({ latest_updated: 'updated_at' })
      .first()) as LinkAggregateRow | undefined;

    const linkedCount = aggregate?.total ? Number(aggregate.total) : 0;
    const lastUpdated = dateToIso(aggregate?.latest_updated ?? null);

    return {
      id: 'identity_sso',
      status: linkedCount > 0 ? 'complete' : 'in_progress',
      lastUpdated,
      meta: {
        configuredProviders: configuredProviders.map((option) => option.id),
        linkedAccounts: linkedCount,
      },
      blocker: linkedCount > 0
        ? null
        : 'No users are linked to an identity provider yet. Ask an MSP admin to connect Google or Microsoft.',
    };
  } catch (error) {
    return buildErrorStep('identity_sso', 'Unable to load SSO configuration status.', error);
  }
}

async function resolvePortalDomainStep(): Promise<OnboardingStepServerState> {
  try {
    const status = await getPortalDomainStatusAction();
    const lastUpdated = dateToIso(status.updatedAt ?? status.lastCheckedAt);

    if (!status.domain || status.status === 'disabled') {
      return {
        id: 'client_portal_domain',
        status: 'not_started',
        lastUpdated,
        meta: {
          canonicalHost: status.canonicalHost,
        },
      };
    }

    if (status.status === 'active') {
      return {
        id: 'client_portal_domain',
        status: 'complete',
        lastUpdated,
        meta: {
          domain: status.domain,
          canonicalHost: status.canonicalHost,
          status: status.status,
        },
      };
    }

    const failedStates = new Set(['dns_failed', 'certificate_failed']);
    const isFailed = failedStates.has(status.status);

    return {
      id: 'client_portal_domain',
      status: isFailed ? 'blocked' : 'in_progress',
      lastUpdated,
      blocker: isFailed ? status.statusMessage : null,
      meta: {
        domain: status.domain,
        status: status.status,
        statusMessage: status.statusMessage,
      },
    };
  } catch (error) {
    return buildErrorStep('client_portal_domain', 'Unable to load client portal domain status.', error);
  }
}

async function resolveImportStep(): Promise<OnboardingStepServerState> {
  try {
    const history = await listImportJobs();
    const latestJob = history.at(0);

    if (!latestJob) {
      return {
        id: 'data_import',
        status: 'not_started',
        lastUpdated: null,
      };
    }

    const progressValue = computeImportProgress(latestJob);
    const lastUpdated = dateToIso(latestJob.completed_at ?? latestJob.updated_at ?? latestJob.created_at);
    const blocker = latestJob.status === 'failed'
      ? latestJob.error_summary?.topErrors?.[0]?.sampleMessage || 'Most recent import failed. Review the error log in Import & Export settings.'
      : latestJob.status === 'cancelled'
        ? 'Last import was cancelled before completion.'
        : null;

    const status = (() => {
      if (latestJob.status === 'completed') {
        return 'complete';
      }

      if (latestJob.status === 'failed' || latestJob.status === 'cancelled') {
        return 'blocked';
      }

      if (latestJob.status === 'preview' || latestJob.status === 'validating' || latestJob.status === 'processing') {
        return 'in_progress';
      }

      return 'not_started';
    })();

    return {
      id: 'data_import',
      status,
      lastUpdated,
      blocker,
      progressValue,
      meta: {
        importJobId: latestJob.import_job_id,
        fileName: latestJob.file_name,
        status: latestJob.status,
        totalRows: latestJob.total_rows,
        processedRows: latestJob.processed_rows,
      },
    };
  } catch (error) {
    return buildErrorStep('data_import', 'Unable to load import history.', error);
  }
}

function computeImportProgress(job: ImportJobRecord): number | null {
  if (job.total_rows && job.total_rows > 0) {
    const progress = Math.min(100, Math.round((job.processed_rows / job.total_rows) * 100));
    return Number.isNaN(progress) ? null : progress;
  }
  return null;
}

async function resolveCalendarStep(): Promise<OnboardingStepServerState> {
  try {
    const result = await getCalendarProviders();
    if (!result.success || !result.providers) {
      throw new Error(result.error || 'Unknown calendar provider error');
    }

    const providers = result.providers;
    if (providers.length === 0) {
      return {
        id: 'calendar_sync',
        status: 'not_started',
        lastUpdated: null,
      };
    }

    const connected = providers.filter((provider) => provider.active && provider.connection_status === 'connected');
    const errored = providers.find((provider) => provider.connection_status === 'error');
    const configuring = providers.find((provider) => provider.connection_status === 'configuring');

    const lastUpdated = dateToIso(
      connected[0]?.updated_at || providers[0]?.updated_at
    );

    if (connected.length > 0) {
      return {
        id: 'calendar_sync',
        status: 'complete',
        lastUpdated,
        meta: {
          providers: connected.map((provider) => ({ id: provider.id, name: provider.name, type: provider.provider_type })),
        },
      };
    }

    if (errored) {
      return {
        id: 'calendar_sync',
        status: 'blocked',
        lastUpdated,
        blocker: errored.error_message || `${errored.name} requires attention before syncing can resume.`,
        meta: {
          providers: providers.map((provider) => ({ id: provider.id, name: provider.name, status: provider.connection_status })),
        },
      };
    }

    return {
      id: 'calendar_sync',
      status: configuring ? 'in_progress' : 'in_progress',
      lastUpdated,
      meta: {
        providers: providers.map((provider) => ({ id: provider.id, name: provider.name, status: provider.connection_status })),
      },
    };
  } catch (error) {
    return buildErrorStep('calendar_sync', 'Unable to load calendar integrations.', error);
  }
}

async function resolveManagedEmailStep(): Promise<OnboardingStepServerState> {
  try {
    const { getManagedEmailDomains } = await import('@ee/lib/actions/email-actions/managedDomainActions');
    const domains = await getManagedEmailDomains();

    if (domains.length === 0) {
      return {
        id: 'managed_email',
        status: 'not_started',
        lastUpdated: null,
      };
    }

    const verified = domains.filter((domain) => domain.status === 'verified');
    const failed = domains.find((domain) => domain.status === 'failed');
    const pending = domains.find((domain) => domain.status === 'pending' || domain.status === 'pending_dns' || domain.status === 'verifying');

    const lastUpdated = dateToIso(
      verified[0]?.updatedAt || failed?.updatedAt || pending?.updatedAt || domains[0]?.updatedAt
    );

    if (verified.length > 0) {
      return {
        id: 'managed_email',
        status: 'complete',
        lastUpdated,
        meta: {
          domains: verified.map((domain) => domain.domain),
        },
      };
    }

    if (failed) {
      return {
        id: 'managed_email',
        status: 'blocked',
        lastUpdated,
        blocker: failed.failureReason || `Verification for ${failed.domain} failed.`,
        meta: {
          domains: domains.map((domain) => ({ domain: domain.domain, status: domain.status })),
        },
      };
    }

    return {
      id: 'managed_email',
      status: 'in_progress',
      lastUpdated,
      meta: {
        domains: domains.map((domain) => ({ domain: domain.domain, status: domain.status })),
      },
    };
  } catch (error: any) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      return {
        id: 'managed_email',
        status: 'blocked',
        lastUpdated: null,
        blocker: 'Managed email domains are only available in the Enterprise edition.',
      };
    }

    return buildErrorStep('managed_email', 'Unable to load managed email domains.', error);
  }
}
