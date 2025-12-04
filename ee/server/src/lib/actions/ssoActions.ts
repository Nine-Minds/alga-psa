'use server';

import type { Knex } from 'knex';

import { analytics } from '@/lib/analytics/posthog';
import { getAdminConnection } from '@shared/db/admin';
import { ensureSsoSettingsPermission } from '@ee/lib/actions/auth/ssoPermissions';
import type { OAuthLinkProvider } from '@ee/lib/auth/oauthAccountLinks';

const USER_TABLE = 'users';
const ACCOUNT_TABLE = 'user_auth_accounts';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export type SsoBulkAssignmentUserType = 'internal' | 'client';

export type SsoBulkAssignmentUserStatus =
  | 'linked'
  | 'would_link'
  | 'already_linked'
  | 'skipped_inactive'
  | 'unlinked'
  | 'would_unlink'
  | 'already_unlinked';

export type SsoBulkAssignmentMode = 'link' | 'unlink';

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
  selectedUserIds: string[];
  providers: OAuthLinkProvider[];
  userType: SsoBulkAssignmentUserType;
  preview: boolean;
  mode: SsoBulkAssignmentMode;
}

export interface SsoBulkAssignmentRequest {
  providers: OAuthLinkProvider[];
  userIds: string[];
  userType?: SsoBulkAssignmentUserType;
  mode?: SsoBulkAssignmentMode;
}

export interface SsoBulkAssignmentActionResponse {
  success: boolean;
  error?: string;
  result?: SsoBulkAssignmentResult;
}

export interface SsoAssignableUser {
  userId: string;
  email: string;
  displayName: string;
  inactive: boolean;
  lastLoginAt: string | null;
  linkedProviders: OAuthLinkProvider[];
}

export interface ListSsoAssignableUsersRequest {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListSsoAssignableUsersResponse {
  success: boolean;
  error?: string;
  users?: SsoAssignableUser[];
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
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
  userIds: string[];
  userType: SsoBulkAssignmentUserType;
  mode: SsoBulkAssignmentMode;
}

function normalizeInput(request: SsoBulkAssignmentRequest): NormalizedInput {
  const providers = Array.from(
    new Set(
      (request.providers ?? [])
        .map((provider) => provider?.toLowerCase().trim() as OAuthLinkProvider)
        .filter((provider): provider is OAuthLinkProvider => provider === 'google' || provider === 'microsoft'),
    ),
  );

  const userIds = Array.from(
    new Set(
      (request.userIds ?? [])
        .map((id) => `${id ?? ''}`.trim())
        .filter((id) => id.length > 0),
    ),
  );

  const userType: SsoBulkAssignmentUserType =
    request.userType === 'client' ? 'client' : 'internal';

  const mode: SsoBulkAssignmentMode = request.mode === 'unlink' ? 'unlink' : 'link';

  return { providers, userIds, userType, mode };
}


interface CandidateUser {
  tenant: string;
  user_id: string;
  email: string;
  is_inactive: boolean;
  user_type: SsoBulkAssignmentUserType;
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
  const { providers, userIds, userType, mode } = input;
  const preview = options.preview ?? false;

  if (providers.length === 0 || userIds.length === 0) {
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
      selectedUserIds: userIds,
      providers,
      userType,
      preview,
      mode,
    };
  }

  if (!options.tenant) {
    throw new Error('Tenant context is required for bulk SSO assignments.');
  }

  const adminDb = options.adminDb ?? (await getAdminConnection());

  const userQuery = adminDb<CandidateUser>(USER_TABLE)
    .select('tenant', 'user_id', 'email', 'is_inactive')
    .where({ user_type: userType })
    .whereIn('user_id', userIds);
  userQuery.andWhere({ tenant: options.tenant });

  const candidates = await userQuery;
  const candidateUserIds = candidates.map((candidate) => candidate.user_id);

  const existingLinks = candidateUserIds.length
    ? await adminDb(ACCOUNT_TABLE)
        .select('tenant', 'user_id', 'provider', 'provider_email')
        .whereIn('user_id', candidateUserIds)
        .andWhere({ tenant: options.tenant })
        .whereIn('provider', providers)
    : [];

  const existingLinkMap = new Set(
    existingLinks.map((link) => getLinkKey(link.tenant, link.user_id, link.provider as OAuthLinkProvider)),
  );

  const providerSummaries = buildProviderSummary(providers);
  const details: SsoBulkAssignmentDetail[] = [];
  const inserts: Record<string, unknown>[] = [];
  const deleteTuples: Array<[string, string, string]> = [];
  const matchedUserIds = new Set<string>();

  const metadataBase = {
    source: options.source ?? (preview ? 'bulk-assignment-preview' : 'bulk-assignment'),
    userType,
    selectionSize: userIds.length,
    mode,
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

      if (mode === 'link') {
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
      } else {
        const linkKey = getLinkKey(candidate.tenant, candidate.user_id, provider);
        if (existingLinkMap.has(linkKey)) {
          summary.linked += 1;
          matchedUserIds.add(candidate.user_id);
          details.push({
            tenant: candidate.tenant,
            userId: candidate.user_id,
            email: lowerEmail,
            provider,
            status: preview ? 'would_unlink' : 'unlinked',
          });

          if (!preview) {
            deleteTuples.push([candidate.tenant, candidate.user_id, provider]);
          }
        } else {
          summary.alreadyLinked += 1;
          matchedUserIds.add(candidate.user_id);
          details.push({
            tenant: candidate.tenant,
            userId: candidate.user_id,
            email: lowerEmail,
            provider,
            status: 'already_unlinked',
          });
        }
      }
    }
  }

  if (!preview) {
    if (mode === 'link' && inserts.length > 0) {
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
    } else if (mode === 'unlink' && deleteTuples.length > 0) {
      await adminDb(ACCOUNT_TABLE)
        .whereIn(['tenant', 'user_id', 'provider'], deleteTuples)
        .delete();
    }
  }

  const summary: SsoBulkAssignmentSummary = {
    scannedUsers: candidates.length,
    matchedUsers: matchedUserIds.size,
    providers: Array.from(providerSummaries.values()),
  };

  return {
    summary,
    details,
    selectedUserIds: userIds,
    providers,
    userType,
    preview,
    mode,
  };
}

interface ListAssignableUsersInternalRequest {
  tenant: string;
  search?: string;
  page: number;
  pageSize: number;
}

async function listSsoAssignableUsersForTenant(
  params: ListAssignableUsersInternalRequest,
): Promise<{ users: SsoAssignableUser[]; pagination: NonNullable<ListSsoAssignableUsersResponse['pagination']> }> {
  const adminDb = await getAdminConnection();
  const pageSize = Math.min(Math.max(params.pageSize, 1), MAX_PAGE_SIZE);
  const page = Math.max(params.page, 1);
  const searchTerm = params.search?.trim();

  const baseQuery = adminDb(USER_TABLE)
    .where({ tenant: params.tenant, user_type: 'internal', is_inactive: false });

  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    baseQuery.andWhere((builder) => {
      builder
        .whereRaw('lower(email) like ?', [pattern])
        .orWhereRaw('lower(first_name) like ?', [pattern])
        .orWhereRaw('lower(last_name) like ?', [pattern]);
    });
  }

  const totalResult = await baseQuery.clone().count<{ count: string }[]>({ count: '*' });
  const totalItems = Number(totalResult?.[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  const rows = await baseQuery
    .clone()
    .select('user_id', 'email', 'first_name', 'last_name', 'is_inactive', 'last_login_at')
    .orderBy('email', 'asc')
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const userIds = rows.map((row) => row.user_id);
  const links = userIds.length
    ? await adminDb(ACCOUNT_TABLE)
        .select('user_id', 'provider')
        .whereIn('user_id', userIds)
        .andWhere({ tenant: params.tenant })
    : [];

  const linkMap = new Map<string, OAuthLinkProvider[]>();
  for (const link of links) {
    const provider = link.provider as OAuthLinkProvider;
    if (provider !== 'google' && provider !== 'microsoft') {
      continue;
    }
    const existing = linkMap.get(link.user_id) ?? [];
    existing.push(provider);
    linkMap.set(link.user_id, existing);
  }

  const users: SsoAssignableUser[] = rows.map((row) => {
    const displayName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    return {
      userId: row.user_id,
      email: (row.email ?? '').toLowerCase(),
      displayName: displayName || row.email || row.user_id,
      inactive: Boolean(row.is_inactive),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      linkedProviders: linkMap.get(row.user_id) ?? [],
    };
  });

  return {
    users,
    pagination: {
      page: safePage,
      pageSize,
      totalItems,
      totalPages,
    },
  };
}


export async function listSsoAssignableUsersAction(
  params: ListSsoAssignableUsersRequest = {},
): Promise<ListSsoAssignableUsersResponse> {
  try {
    const { tenant } = await ensureSsoSettingsPermission();
    const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = Math.max(params.page ?? 1, 1);
    const search = params.search?.trim();
    const normalizedSearch = search?.length ? search.toLowerCase() : undefined;

    const { users, pagination } = await listSsoAssignableUsersForTenant({
      tenant,
      search: normalizedSearch,
      page,
      pageSize,
    });

    return {
      success: true,
      users,
      pagination,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? 'Unable to load assignable users.',
    };
  }
}

export async function previewBulkSsoAssignmentAction(
  request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentActionResponse> {
  try {
    const { user, tenant } = await ensureSsoSettingsPermission();
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
    const { user, tenant } = await ensureSsoSettingsPermission();
    const result = await executeBulkSsoAssignment(request, {
      tenant,
      actorUserId: user.user_id,
      source: 'ui',
      preview: false,
    });

    const affectedCount = result.summary.providers.reduce((total, provider) => total + provider.linked, 0);

    analytics.capture('sso.bulk_assignment.executed', {
      tenant_id: tenant,
      user_id: user.user_id,
      providers: result.providers,
      selection_size: result.selectedUserIds.length,
      affected_count: affectedCount,
      mode: result.mode,
    });

    return { success: true, result };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? 'Unable to execute SSO assignments.',
    };
  }
}
