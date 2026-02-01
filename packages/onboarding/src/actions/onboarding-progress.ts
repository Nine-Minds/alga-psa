'use server';

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getPortalDomainStatusForTenant } from '@alga-psa/tenancy/server';
import { createTenantKnex, getConnection } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { CalendarProviderConfig } from '@alga-psa/types';
import {
  deriveParentStepFromSubsteps,
  type OnboardingProgressSubstep,
} from '../lib/deriveParentStepFromSubsteps';

export type OnboardingStepId =
  | 'identity_sso'
  | 'client_portal_domain'
  | 'data_import'
  | 'calendar_sync'
  | 'managed_email';

export type OnboardingStepStatus = 'not_started' | 'in_progress' | 'blocked' | 'complete';

export interface OnboardingSubstepServerState extends OnboardingProgressSubstep {}

export interface OnboardingStepServerState {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
  lastUpdated: string | null;
  blocker?: string | null;
  progressValue?: number | null;
  meta?: Record<string, unknown>;
  substeps?: OnboardingSubstepServerState[];
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('[onboarding-progress] Step resolution failed', { id, errorMessage, errorStack });
  }

  return {
    id,
    status: 'blocked',
    blocker: message,
    lastUpdated: null,
  };
};

export const getOnboardingProgressAction = withAuth(async (
  _user,
  { tenant }
): Promise<OnboardingProgressResponse> => {
  const [identity, customerPortal, importStep, calendar, email] = await Promise.all([
    resolveIdentityStep(tenant),
    resolveCustomerPortalStep(tenant),
    resolveImportStep(tenant),
    resolveCalendarStep(tenant),
    resolveEmailStep(tenant),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    steps: [identity, customerPortal, importStep, calendar, email],
  };
});

async function resolveIdentityStep(tenantId: string): Promise<OnboardingStepServerState> {
  try {
    const { getSsoProviderOptions } = await import('@enterprise/lib/auth/providerConfig');
    const providerOptions = await getSsoProviderOptions();
    const configuredProviders = providerOptions.filter((option) => option.configured);

    const adminDb = await getAdminConnection();
    type LinkAggregateRow = { total?: string | number | null; latest_updated?: Date | string | null };
    const aggregate = (await adminDb('user_auth_accounts')
      .where({ tenant: tenantId })
      .count('user_id as total')
      .max({ latest_updated: 'updated_at' })
      .first()) as LinkAggregateRow | undefined;

    const linkedCount = aggregate?.total ? Number(aggregate.total) : 0;
    const lastUpdated = dateToIso(aggregate?.latest_updated ?? null);
    const hasProvider = configuredProviders.length > 0;
    const hasLinkedAccount = linkedCount > 0;

    const substeps: OnboardingSubstepServerState[] = [
      {
        id: 'identity_provider_configured',
        title: 'Add an SSO provider',
        status: hasProvider ? 'complete' : 'not_started',
        lastUpdated,
      },
      {
        id: 'identity_user_linked',
        title: 'Link the first team member',
        status: hasLinkedAccount ? 'complete' : hasProvider ? 'in_progress' : 'not_started',
        lastUpdated,
      },
    ];
    const derived = deriveParentStepFromSubsteps(substeps as OnboardingProgressSubstep[], lastUpdated);

    return {
      id: 'identity_sso',
      status: derived.status as OnboardingStepStatus,
      lastUpdated: derived.lastUpdated,
      progressValue: derived.progressValue,
      substeps,
      meta: {
        configuredProviders: configuredProviders.map((option) => option.id),
        linkedAccounts: linkedCount,
      },
      blocker: hasProvider
        ? hasLinkedAccount
          ? null
          : 'No users are linked to an identity provider yet. Ask an MSP admin to connect Google or Microsoft.'
        : 'Add Google Workspace or Microsoft 365 credentials to enable SSO for your team.',
    };
  } catch (error) {
    return buildErrorStep('identity_sso', 'Unable to load SSO configuration status.', error);
  }
}

async function resolveCustomerPortalStep(tenantId: string): Promise<OnboardingStepServerState> {
  try {
    const [domainSubstep, brandingSubstep, inviteSubstep] = await Promise.all([
      resolvePortalCustomDomainSubstep(tenantId),
      resolvePortalBrandingSubstep(tenantId),
      resolvePortalInviteSubstep(tenantId),
    ]);

    const substeps: OnboardingSubstepServerState[] = [domainSubstep, brandingSubstep, inviteSubstep];
    const derived = deriveParentStepFromSubsteps(substeps as OnboardingProgressSubstep[]);

    return {
      id: 'client_portal_domain',
      status: derived.status as OnboardingStepStatus,
      blocker: derived.blocker,
      lastUpdated: derived.lastUpdated,
      progressValue: derived.progressValue,
      substeps,
      meta: {
        completedSubsteps: substeps.filter((substep) => substep.status === 'complete').length,
        totalSubsteps: substeps.length,
      },
    };
  } catch (error) {
    return buildErrorStep('client_portal_domain', 'Unable to load client portal domain status.', error);
  }
}

async function resolvePortalCustomDomainSubstep(tenantId: string): Promise<OnboardingSubstepServerState> {
  const status = await getPortalDomainStatusForTenant(tenantId);
  const lastUpdated = dateToIso(status.updatedAt ?? status.lastCheckedAt);

  if (!status.domain || status.status === 'disabled') {
    return {
      id: 'portal_custom_domain',
      title: 'Portal custom domain',
      status: 'not_started',
      lastUpdated,
      meta: {
        canonicalHost: status.canonicalHost,
      },
    };
  }

  if (status.status === 'active') {
    return {
      id: 'portal_custom_domain',
      title: 'Portal custom domain',
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
    id: 'portal_custom_domain',
    title: 'Portal custom domain',
    status: isFailed ? 'blocked' : 'in_progress',
    lastUpdated,
    blocker: isFailed ? status.statusMessage : null,
    meta: {
      domain: status.domain,
      status: status.status,
      statusMessage: status.statusMessage,
    },
  };
}

async function resolvePortalBrandingSubstep(tenantId: string): Promise<OnboardingSubstepServerState> {
  const knex = await getConnection(tenantId);
  const row = await knex('tenant_settings')
    .where({ tenant: tenantId })
    .select('settings', 'updated_at', 'created_at')
    .first();

  const lastUpdated = dateToIso(row?.updated_at ?? row?.created_at ?? null);
  const settings = row?.settings ?? {};

  const hasPortalConfig = Boolean(settings?.branding) || Boolean(settings?.clientPortal) || settings?.defaultLocale || settings?.enabledLocales;

  return {
    id: 'portal_branding',
    title: 'Portal color and logo customizations',
    status: hasPortalConfig ? 'complete' : 'not_started',
    lastUpdated,
  };
}

async function resolvePortalInviteSubstep(tenantId: string): Promise<OnboardingSubstepServerState> {
  const knex = await getConnection(tenantId);

  type InviteAggregateRow = { total?: string | number | null; latest_created?: Date | string | null };
  const aggregate = (await knex('portal_invitations')
    .where({ tenant: tenantId })
    .count('* as total')
    .max({ latest_created: 'created_at' })
    .first()) as InviteAggregateRow | undefined;

  const total = aggregate?.total ? Number(aggregate.total) : 0;
  const lastUpdated = dateToIso(aggregate?.latest_created ?? null);

  return {
    id: 'portal_invite_first_contact',
    title: 'Invite your first contact to the portal',
    status: total > 0 ? 'complete' : 'not_started',
    lastUpdated,
    meta: {
      invites: total,
    },
  };
}

async function resolveImportStep(tenantId: string): Promise<OnboardingStepServerState> {
  try {
    const knex = await getConnection(tenantId);
    type ContactAggregateRow = { total?: string | number | null; latest_created?: Date | string | null };
    const contactAggregate = (await knex('contacts')
      .where({ tenant: tenantId })
      .count('* as total')
      .max({ latest_created: 'created_at' })
      .first()) as ContactAggregateRow | undefined;

    const contactTotal = contactAggregate?.total ? Number(contactAggregate.total) : 0;
    const contactLastUpdated = dateToIso(contactAggregate?.latest_created ?? null);

    const contactStatus: OnboardingStepStatus =
      contactTotal >= 5 ? 'complete' : contactTotal > 0 ? 'in_progress' : 'not_started';

    const substeps: OnboardingSubstepServerState[] = [
      {
        id: 'contacts_created',
        title: 'Create your first 5 contacts',
        status: contactStatus,
        lastUpdated: contactLastUpdated,
        meta: {
          contactCount: contactTotal,
        },
      },
    ];

    const derived = deriveParentStepFromSubsteps(substeps as OnboardingProgressSubstep[], contactLastUpdated);

    return {
      id: 'data_import',
      status: derived.status as OnboardingStepStatus,
      lastUpdated: derived.lastUpdated,
      blocker: derived.blocker,
      progressValue: derived.progressValue,
      substeps,
      meta: {
        contactCount: contactTotal,
      },
    };
  } catch (error) {
    return buildErrorStep('data_import', 'Unable to load import history.', error);
  }
}
async function resolveCalendarStep(tenantId: string): Promise<OnboardingStepServerState> {
  try {
    const knex = await getConnection(tenantId);

    // Query calendar providers directly to avoid permission checks
    // The onboarding progress should be visible regardless of specific permissions
    const providers = await knex('calendar_providers')
      .where({ tenant: tenantId })
      .orderBy('created_at', 'desc') as CalendarProviderConfig[];

    const connected = providers.filter((provider) => provider.active && provider.connection_status === 'connected');
    const errored = providers.find((provider) => provider.connection_status === 'error');

    const lastUpdated = dateToIso(
      connected[0]?.updated_at || providers[0]?.updated_at
    );

    const hasProvider = providers.length > 0;

    const substeps: OnboardingSubstepServerState[] = [
      {
        id: 'calendar_provider_added',
        title: 'Add a calendar provider',
        status: hasProvider ? 'complete' : 'not_started',
        lastUpdated,
      },
      {
        id: 'calendar_provider_connected',
        title: 'Connect and authorize the provider',
        status: connected.length > 0
          ? 'complete'
          : errored
            ? 'blocked'
            : hasProvider
              ? 'in_progress'
              : 'not_started',
        lastUpdated,
        blocker: errored?.error_message || (errored ? `${errored.name} requires attention before syncing can resume.` : null),
      },
    ];

    const derived = deriveParentStepFromSubsteps(substeps as OnboardingProgressSubstep[], lastUpdated);

    return {
      id: 'calendar_sync',
      status: derived.status as OnboardingStepStatus,
      lastUpdated: derived.lastUpdated,
      blocker: derived.blocker,
      progressValue: derived.progressValue,
      substeps,
      meta: {
        providers: providers.map((provider) => ({ id: provider.id, name: provider.name, status: provider.connection_status })),
      },
    };
  } catch (error) {
    return buildErrorStep('calendar_sync', 'Unable to load calendar integrations.', error);
  }
}

async function resolveManagedEmailStep(tenant: string): Promise<OnboardingStepServerState> {
  const { tenant: tenantId } = await createTenantKnex(tenant);
  if (!tenantId) {
    return buildErrorStep('managed_email', 'Tenant context is required to load email onboarding status.');
  }
  return resolveEmailStep(tenantId);
}

async function resolveEmailStep(tenantId: string): Promise<OnboardingStepServerState> {
  try {
    const [inboundSubstep, outboundDomainSubstep] = await Promise.all([
      resolveInboundEmailProviderSubstep(tenantId),
      resolveOutboundCustomEmailDomainSubstep(),
    ]);

    const substeps: OnboardingSubstepServerState[] = [inboundSubstep, outboundDomainSubstep];
    const derived = deriveParentStepFromSubsteps(substeps as OnboardingProgressSubstep[]);

    return {
      id: 'managed_email',
      status: derived.status as OnboardingStepStatus,
      blocker: derived.blocker,
      lastUpdated: derived.lastUpdated,
      progressValue: derived.progressValue,
      substeps,
      meta: {
        completedSubsteps: substeps.filter((substep) => substep.status === 'complete').length,
        totalSubsteps: substeps.length,
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

async function resolveInboundEmailProviderSubstep(tenantId: string): Promise<OnboardingSubstepServerState> {
  const knex = await getConnection(tenantId);

  type ProviderAggregateRow = { total?: string | number | null; latest_updated?: Date | string | null };
  const aggregate = (await knex('email_providers')
    .where({ tenant: tenantId })
    .count('* as total')
    .max({ latest_updated: 'updated_at' })
    .first()) as ProviderAggregateRow | undefined;

  const total = aggregate?.total ? Number(aggregate.total) : 0;
  const lastUpdated = dateToIso(aggregate?.latest_updated ?? null);

  return {
    id: 'email_inbound_provider',
    title: 'Configure inbound email',
    status: total > 0 ? 'complete' : 'not_started',
    lastUpdated,
    meta: {
      providers: total,
    },
  };
}

async function resolveOutboundCustomEmailDomainSubstep(): Promise<OnboardingSubstepServerState> {
  const { getManagedEmailDomains } = await import(
    '@enterprise/lib/actions/email-actions/managedDomainActions'
  );
  const domains = await getManagedEmailDomains();

  if (domains.length === 0) {
    return {
      id: 'email_outbound_custom_domain',
      title: 'Configure outbound custom email domain',
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
      id: 'email_outbound_custom_domain',
      title: 'Configure outbound custom email domain',
      status: 'complete',
      lastUpdated,
      meta: {
        domains: verified.map((domain) => domain.domain),
      },
    };
  }

  if (failed) {
    return {
      id: 'email_outbound_custom_domain',
      title: 'Configure outbound custom email domain',
      status: 'blocked',
      lastUpdated,
      blocker: failed.failureReason || `Verification for ${failed.domain} failed.`,
      meta: {
        domains: domains.map((domain) => ({ domain: domain.domain, status: domain.status })),
      },
    };
  }

  return {
    id: 'email_outbound_custom_domain',
    title: 'Configure outbound custom email domain',
    status: 'in_progress',
    lastUpdated,
    meta: {
      domains: domains.map((domain) => ({ domain: domain.domain, status: domain.status })),
    },
  };
}
