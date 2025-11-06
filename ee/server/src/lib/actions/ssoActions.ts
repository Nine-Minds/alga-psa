'use server';

import type { Knex } from 'knex';

import { createTenantKnex } from '@/lib/db';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { hasPermission } from '@/lib/auth/rbac';
import { analytics } from '@/lib/analytics/posthog';
import { getAdminConnection } from '@shared/db/admin';
import type { IUser } from 'server/src/interfaces/auth.interfaces';
import type { OAuthLinkProvider } from '@ee/lib/auth/oauthAccountLinks';

const USER_TABLE = 'users';
const ACCOUNT_TABLE = 'user_auth_accounts';
const REQUIRED_RESOURCE = 'settings';
const REQUIRED_ACTION = 'update';

export type SsoBulkAssignmentUserType = 'internal' | 'client';

export type SsoBulkAssignmentUserStatus =
  | 'linked'
  | 'would_link'
  | 'already_linked'
  | 'skipped_inactive';

export interface SsoBulkAssignmentDetail {
  tenant: string;
  userId: string;
  email: string;
  provider: OAuthLinkProvider;
  status: SsoBulkAssignmentUserStatus;
}

export interface SsoBulkAssignmentProviderSummary {
  provider: OAuthLinkProvider;
  candidates: number;
  linked: number;
  alreadyLinked: number;
  skippedInactive: number;
}

export interface SsoBulkAssignmentSummary {
  scannedUsers: number;
  matchedUsers: number;
  providers: SsoBulkAssignmentProviderSummary[];
}

export interface SsoBulkAssignmentResult {
  summary: SsoBulkAssignmentSummary;
  details: SsoBulkAssignmentDetail[];
  normalizedDomains: string[];
  providers: OAuthLinkProvider[];
  userType: SsoBulkAssignmentUserType;
  preview: boolean;
}

export interface SsoBulkAssignmentRequest {
  providers: OAuthLinkProvider[];
  domains: string[];
  userType: SsoBulkAssignmentUserType;
}

export interface SsoBulkAssignmentActionResponse {
  success: boolean;
  error?: string;
  result?: SsoBulkAssignmentResult;
}

interface ExecuteOptions {
  tenant?: string;
  actorUserId?: string;
  source?: 'ui' | 'script';
  adminDb?: Knex;
  preview?: boolean;
}

interface NormalizedInput {
  providers: OAuthLinkProvider[];
  domains: string[];
  userType: SsoBulkAssignmentUserType;
}

function normalizeInput(request: SsoBulkAssignmentRequest): NormalizedInput {
  const providers = Array.from(
    new Set(
      (request.providers ?? [])
        .map((provider) => provider?.toLowerCase().trim() as OAuthLinkProvider)
        .filter((provider): provider is OAuthLinkProvider => provider === 'google' || provider === 'microsoft'),
    ),
  );

  const domains = Array.from(
    new Set(
      (request.domains ?? [])
        .flatMap((domain) => domain.split(/[,\n]/g))
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
        .filter((domain) => domain.length > 0),
    ),
  );

  const userType: SsoBulkAssignmentUserType = request.userType === 'client' ? 'client' : 'internal';

  return { providers, domains, userType };
}

interface CandidateUser {
  tenant: string;
  user_id: string;
  email: string;
  is_inactive: boolean;
}

function buildProviderSummary(providers: OAuthLinkProvider[]): Map<OAuthLinkProvider, SsoBulkAssignmentProviderSummary> {
  return new Map(
    providers.map((provider) => [
      provider,
      {
        provider,
        candidates: 0,
        linked: 0,
        alreadyLinked: 0,
        skippedInactive: 0,
      },
    ]),
  );
}

function getLinkKey(tenant: string, userId: string, provider: OAuthLinkProvider): string {
  return `${tenant}:${userId}:${provider}`;
}

export async function previewBulkSsoAssignment(
  request: SsoBulkAssignmentRequest,
  options: ExecuteOptions = {},
): Promise<SsoBulkAssignmentResult> {
  const normalized = normalizeInput(request);
  return performBulkSsoAssignment(normalized, { ...options, preview: true });
}

export async function executeBulkSsoAssignment(
  request: SsoBulkAssignmentRequest,
  options: ExecuteOptions = {},
): Promise<SsoBulkAssignmentResult> {
  const normalized = normalizeInput(request);
  return performBulkSsoAssignment(normalized, { ...options, preview: false });
}

async function performBulkSsoAssignment(
  input: NormalizedInput,
  options: ExecuteOptions,
): Promise<SsoBulkAssignmentResult> {
  const { providers, domains, userType } = input;
  const preview = options.preview ?? false;

  if (providers.length === 0 || domains.length === 0) {
    return {
      summary: {
        scannedUsers: 0,
        matchedUsers: 0,
        providers: providers.map((provider) => ({
          provider,
          candidates: 0,
          linked: 0,
          alreadyLinked: 0,
          skippedInactive: 0,
        })),
      },
      details: [],
      normalizedDomains: domains,
      providers,
      userType,
      preview,
    };
  }

  const adminDb = options.adminDb ?? (await getAdminConnection());

  const domainPatterns = domains.map((domain) => `%@${domain}`);

  const userQuery = adminDb<CandidateUser>(USER_TABLE)
    .select('tenant', 'user_id', 'email', 'is_inactive')
    .where({ user_type: userType });

  if (options.tenant) {
    userQuery.andWhere({ tenant: options.tenant });
  }

  userQuery.andWhere((builder) => {
    domainPatterns.forEach((pattern, index) => {
      if (index === 0) {
        builder.whereRaw('lower(email) like ?', [pattern]);
        return;
      }
      builder.orWhereRaw('lower(email) like ?', [pattern]);
    });
  });

  const candidates = await userQuery;
  const candidateUserIds = candidates.map((candidate) => candidate.user_id);

  const existingLinks = candidateUserIds.length
    ? await adminDb(ACCOUNT_TABLE)
        .select('tenant', 'user_id', 'provider')
        .whereIn('user_id', candidateUserIds)
        .modify((builder) => {
          if (options.tenant) {
            builder.andWhere({ tenant: options.tenant });
          }
        })
        .whereIn('provider', providers)
    : [];

  const existingLinkMap = new Set(
    existingLinks.map((link) => getLinkKey(link.tenant, link.user_id, link.provider as OAuthLinkProvider)),
  );

  const providerSummaries = buildProviderSummary(providers);
  const details: SsoBulkAssignmentDetail[] = [];
  const inserts: Record<string, unknown>[] = [];
  const matchedUserIds = new Set<string>();

  const metadataBase = {
    source: options.source ?? (preview ? 'bulk-assignment-preview' : 'bulk-assignment'),
    domains,
    userType,
  };

  for (const candidate of candidates) {
    const lowerEmail = candidate.email?.toLowerCase() ?? '';
    const isInactive = Boolean(candidate.is_inactive);

    for (const provider of providers) {
      const summary = providerSummaries.get(provider);
      if (!summary) {
        continue;
      }

      summary.candidates += 1;

      if (isInactive) {
        summary.skippedInactive += 1;
        details.push({
          tenant: candidate.tenant,
          userId: candidate.user_id,
          email: lowerEmail,
          provider,
          status: 'skipped_inactive',
        });
        continue;
      }

      const linkKey = getLinkKey(candidate.tenant, candidate.user_id, provider);
      if (existingLinkMap.has(linkKey)) {
        summary.alreadyLinked += 1;
        matchedUserIds.add(candidate.user_id);
        details.push({
          tenant: candidate.tenant,
          userId: candidate.user_id,
          email: lowerEmail,
          provider,
          status: 'already_linked',
        });
        continue;
      }

      summary.linked += 1;
      details.push({
        tenant: candidate.tenant,
        userId: candidate.user_id,
        email: lowerEmail,
        provider,
        status: preview ? 'would_link' : 'linked',
      });

      matchedUserIds.add(candidate.user_id);

      if (!preview) {
        inserts.push({
          tenant: candidate.tenant,
          user_id: candidate.user_id,
          provider,
          provider_account_id: lowerEmail,
          provider_email: lowerEmail,
          metadata: {
            ...metadataBase,
            executedBy: options.actorUserId ?? null,
          },
          last_used_at: adminDb.fn.now(),
        });
      }
    }
  }

  if (!preview && inserts.length > 0) {
    await adminDb(ACCOUNT_TABLE)
      .insert(inserts)
      .onConflict(['tenant', 'user_id', 'provider'])
      .merge({
        provider_account_id: adminDb.raw('excluded.provider_account_id'),
        provider_email: adminDb.raw('excluded.provider_email'),
        metadata: adminDb.raw('excluded.metadata'),
        last_used_at: adminDb.raw('excluded.last_used_at'),
        updated_at: adminDb.fn.now(),
      });
  }

  const summary: SsoBulkAssignmentSummary = {
    scannedUsers: candidates.length,
    matchedUsers: matchedUserIds.size,
    providers: Array.from(providerSummaries.values()),
  };

  return {
    summary,
    details,
    normalizedDomains: domains,
    providers,
    userType,
    preview,
  };
}

async function ensureSsoPermission(): Promise<{ user: IUser; tenant: string; knex: Knex }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Authentication is required to manage SSO assignments.');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  const allowed = await hasPermission(user, REQUIRED_RESOURCE, REQUIRED_ACTION, knex);
  if (!allowed) {
    throw new Error('You do not have permission to manage security settings.');
  }

  return { user, tenant, knex };
}

export async function previewBulkSsoAssignmentAction(
  request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentActionResponse> {
  try {
    const { user, tenant } = await ensureSsoPermission();
    const result = await previewBulkSsoAssignment(request, {
      tenant,
      actorUserId: user.user_id,
      source: 'ui',
      preview: true,
    });

    return { success: true, result };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? 'Unable to preview SSO assignments.',
    };
  }
}

export async function executeBulkSsoAssignmentAction(
  request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentActionResponse> {
  try {
    const { user, tenant } = await ensureSsoPermission();
    const result = await executeBulkSsoAssignment(request, {
      tenant,
      actorUserId: user.user_id,
      source: 'ui',
      preview: false,
    });

    analytics.capture('sso.bulk_assignment.executed', {
      tenant_id: tenant,
      user_id: user.user_id,
      providers: result.providers,
      domains: result.normalizedDomains,
      linked: result.summary.providers.reduce((total, provider) => total + provider.linked, 0),
    });

    return { success: true, result };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? 'Unable to execute SSO assignments.',
    };
  }
}
