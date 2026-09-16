import axios from 'axios';
import { randomUUID } from 'crypto';
import type {
  DiagnosticsRecommendation,
  EntraClientAccessDiagnosticsInput,
  EntraClientDiagnosticsContinuation,
  EntraClientDiagnosticsResult,
  EntraClientOutcomeCategory,
  EntraDiagnosticsStep,
} from '@alga-psa/types';
import {
  buildTokenFingerprint,
  computeOverallStatus,
  decodeJwtPayload,
} from '@alga-psa/shared/services/diagnostics';
import { getMicrosoftGraphBaseUrl } from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getActiveEntraPartnerConnection } from '../connectionRepository';
import { refreshEntraDirectAccessTokenForTenant } from '../auth/refreshDirectToken';
import { resolveMicrosoftCredentialsForTenant } from '../auth/microsoftCredentialResolver';
import { DirectProviderAdapter } from '../providers/direct/directProviderAdapter';
import { CippProviderAdapter } from '../providers/cipp/cippProviderAdapter';
import { getEntraCippCredentials } from '../providers/cipp/cippSecretStore';
import {
  listConfirmedEntraMappings,
  type ConfirmedEntraMapping,
} from '../mapping/confirmedMappingsService';
import { filterEntraUsersForTenant } from '../settingsService';
import { classifyEntraOAuthFailure } from './oauthClassifier';
import { aggregateClientCategories, dedupeRecommendations } from './recommendations';
import { sanitizeClient, sanitizeRecommendations } from './redaction';
import { createEntraStepRunner } from './entraStepRunner';
import {
  DEFAULT_CONTINUATION_TTL_MS,
  DiagnosticsContinuationError,
  DiagnosticsSigningSecretUnavailableError,
  MAX_EMBEDDED_RESULTS,
  MAX_EMBEDDED_RECOMMENDATIONS,
  MAX_SELECTION,
  assertContinuationSigningAvailable,
  signContinuation,
  verifyContinuation,
  type EntraClientContinuationPayload,
  type EntraContinuationSelection,
  type EntraPendingYield,
} from './continuation';

/** Clients finalized per request. */
export const MAX_CLIENTS_PER_REQUEST = 3;
/** Wall-clock budget for one continuation request before we yield. */
const REQUEST_BUDGET_MS = 20_000;
/** Per-client cancellation budget (mint + reads + one paging slice). */
const CLIENT_BUDGET_MS = 15_000;
/** User-directory pages fetched per request for the optional preview. */
const MAX_PAGES_PER_REQUEST = 10;

interface MappingPortalConfig {
  entitlementGroupId: string | null;
  entitlementMembershipMode: string | null;
}

interface ClientRecommendationState {
  recommendations: DiagnosticsRecommendation[];
}

async function loadMappingPortalConfig(
  tenant: string,
  managedTenantId: string
): Promise<MappingPortalConfig> {
  const { knex } = await createTenantKnex();
  const row = (await tenantDb(knex, tenant)
    .table('entra_client_tenant_mappings')
    .where({ managed_tenant_id: managedTenantId, is_active: true })
    .first([
      'client_portal_entitlement_group_id',
      'client_portal_entitlement_membership_mode',
    ])) as
    | {
        client_portal_entitlement_group_id: string | null;
        client_portal_entitlement_membership_mode: string | null;
      }
    | undefined;
  return {
    entitlementGroupId: row?.client_portal_entitlement_group_id ?? null,
    entitlementMembershipMode: row?.client_portal_entitlement_membership_mode ?? null,
  };
}

function directGraphGet(
  accessToken: string,
  path: string,
  signal?: AbortSignal
): Promise<{ status: number; requestId?: string; clientRequestId: string; data: any }> {
  const clientRequestId = randomUUID();
  return axios
    .get(`${getMicrosoftGraphBaseUrl()}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'client-request-id': clientRequestId,
        'return-client-request-id': 'true',
      },
      timeout: 15000,
      signal,
    })
    .then((res) => ({
      status: res.status,
      requestId: res.headers?.['request-id'],
      clientRequestId: res.headers?.['client-request-id'] ?? clientRequestId,
      data: res.data,
    }));
}

function collectStepRecommendations(steps: EntraDiagnosticsStep[]): DiagnosticsRecommendation[] {
  return steps.flatMap((step) => step.recommendations ?? []);
}

interface DirectClientOptions {
  tenant: string;
  mapping: ConfirmedEntraMapping;
  boundClientId: string | null;
  includeUserYield: boolean;
  signal: AbortSignal;
  deadline: number;
  resumeYield?: EntraPendingYield | null;
}

interface ClientRunOutput {
  result?: EntraClientDiagnosticsResult;
  pending?: EntraPendingYield;
}

async function pageUserYield(options: {
  tenant: string;
  mapping: ConfirmedEntraMapping;
  accessToken: string;
  signal: AbortSignal;
  deadline: number;
  startNextLink: string | null;
  startCounts: EntraPendingYield['counts'];
}): Promise<{ done: true; counts: EntraPendingYield['counts'] } | { done: false; nextLink: string; counts: EntraPendingYield['counts'] }> {
  const adapter = new DirectProviderAdapter();
  const counts = {
    totalUsers: options.startCounts.totalUsers,
    includedUsers: options.startCounts.includedUsers,
    excluded: { ...options.startCounts.excluded },
  };
  let nextLink: string | null = options.startNextLink;
  let pages = 0;

  while (pages < MAX_PAGES_PER_REQUEST && Date.now() < options.deadline) {
    const page = await adapter.listUsersPageWithToken({
      tenant: options.tenant,
      managedTenantId: options.mapping.managedTenantId,
      accessToken: options.accessToken,
      url: nextLink ?? undefined,
      signal: options.signal,
    });
    const filtered = await filterEntraUsersForTenant(options.tenant, page.users);
    counts.totalUsers += page.users.length;
    counts.includedUsers += filtered.included.length;
    for (const excluded of filtered.excluded) {
      counts.excluded[excluded.reason] = (counts.excluded[excluded.reason] ?? 0) + 1;
    }
    nextLink = page.nextLink;
    pages += 1;
    if (!nextLink) return { done: true, counts };
  }

  if (!nextLink) return { done: true, counts };
  return { done: false, nextLink, counts };
}

async function runDirectClient(options: DirectClientOptions): Promise<ClientRunOutput> {
  const { tenant, mapping, boundClientId, includeUserYield, signal, deadline } = options;
  const runner = createEntraStepRunner();
  const recState: ClientRecommendationState = { recommendations: [] };
  const portal = await loadMappingPortalConfig(tenant, mapping.managedTenantId);
  let accessToken: string | null = null;
  let firstUserId: string | null = null;
  let usersReadOk = false;

  await runner.runStep('tenant_token_mint', 'Mint customer tenant token', {}, async () => {
    try {
      const minted = await refreshEntraDirectAccessTokenForTenant(tenant, mapping.entraTenantId, {
        signal,
        timeoutMs: CLIENT_BUDGET_MS,
      });
      accessToken = minted.accessToken;
      const claims = decodeJwtPayload(minted.accessToken);
      return {
        status: 'pass' as const,
        data: {
          entraTenantId: mapping.entraTenantId,
          tenant: claims?.tid,
          accessTokenFingerprint: buildTokenFingerprint(minted.accessToken),
          expiresAt: minted.expiresAt,
        },
      };
    } catch (error: any) {
      const classified = classifyEntraOAuthFailure({
        message: error?.message,
        httpStatus: error?.status ?? error?.response?.status,
        code: error?.code,
        oauthError: error?.oauthError,
        suberror: error?.suberror,
        aadstsCode: error?.aadstsCode,
        responseBody: error?.responseBody ?? error?.response?.data,
        context: 'customer',
        customer: {
          entraTenantId: mapping.entraTenantId,
          applicationClientId: boundClientId,
          operation: 'token',
        },
      });
      recState.recommendations.push(...[classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[]);
      return {
        status: 'fail' as const,
        error: {
          message: classified.remedy,
          status: classified.httpStatus ?? undefined,
          oauthError: classified.oauthError ?? undefined,
          suberror: classified.suberror ?? undefined,
          aadstsCode: classified.aadstsCode ?? undefined,
          requestId: error?.requestId,
        },
        recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
      };
    }
  });

  await runner.runStep(
    'users_read',
    'Read directory users',
    { requires: ['tenant_token_mint'] },
    async () => {
      if (!accessToken) return { status: 'skip' as const, data: { reason: 'No tenant token.' } };
      try {
        const read = await directGraphGet(accessToken, '/users?$select=id&$top=1', signal);
        firstUserId = read.data?.value?.[0]?.id ?? null;
        usersReadOk = true;
        return {
          status: 'pass' as const,
          http: {
            method: 'GET',
            path: '/users?$select=id&$top=1',
            status: read.status,
            requestId: read.requestId,
            clientRequestId: read.clientRequestId,
          },
          data: { userFound: Boolean(firstUserId), emptyDirectory: !firstUserId },
        };
      } catch (error: any) {
        const classified = classifyEntraOAuthFailure({
          message: error?.message,
          httpStatus: error?.response?.status,
          code: error?.code,
          responseBody: error?.response?.data,
          context: 'customer',
          customer: {
            entraTenantId: mapping.entraTenantId,
            applicationClientId: boundClientId,
            operation: 'users',
          },
        });
        recState.recommendations.push(...[classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[]);
        return {
          status: 'fail' as const,
          http: {
            method: 'GET',
            path: '/users?$select=id&$top=1',
            status: error?.response?.status,
            requestId: error?.response?.headers?.['request-id'],
          },
          error: {
            message: classified.remedy,
            status: error?.response?.status,
            requestId: error?.response?.headers?.['request-id'],
          },
          recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
        };
      }
    }
  );

  await runner.runStep(
    'groups_read',
    'Read directory groups',
    { requires: ['tenant_token_mint'] },
    async () => {
      if (!accessToken) return { status: 'skip' as const, data: { reason: 'No tenant token.' } };
      try {
        const read = await directGraphGet(accessToken, '/groups?$select=id&$top=1', signal);
        return {
          status: 'pass' as const,
          http: {
            method: 'GET',
            path: '/groups?$select=id&$top=1',
            status: read.status,
            requestId: read.requestId,
            clientRequestId: read.clientRequestId,
          },
          data: { groupFound: Boolean(read.data?.value?.[0]?.id) },
        };
      } catch (error: any) {
        const classified = classifyEntraOAuthFailure({
          message: error?.message,
          httpStatus: error?.response?.status,
          code: error?.code,
          responseBody: error?.response?.data,
          context: 'customer',
          customer: {
            entraTenantId: mapping.entraTenantId,
            applicationClientId: boundClientId,
            operation: 'groups',
          },
        });
        recState.recommendations.push(...[classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[]);
        return {
          status: 'fail' as const,
          http: {
            method: 'GET',
            path: '/groups?$select=id&$top=1',
            status: error?.response?.status,
            requestId: error?.response?.headers?.['request-id'],
          },
          error: {
            message: classified.remedy,
            status: error?.response?.status,
            requestId: error?.response?.headers?.['request-id'],
          },
          recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
        };
      }
    }
  );

  await runner.runStep(
    'entitlement_group_resolves',
    'Resolve entitlement group',
    { requires: ['tenant_token_mint'] },
    async () => {
      if (!portal.entitlementGroupId) {
        return {
          status: 'skip' as const,
          data: { reason: 'No entitlement group is configured for this client.' },
        };
      }
      if (!accessToken) return { status: 'skip' as const, data: { reason: 'No tenant token.' } };

      try {
        const group = await directGraphGet(
          accessToken,
          `/groups/${encodeURIComponent(portal.entitlementGroupId)}?$select=id,displayName,securityEnabled`,
          signal
        );
        const groupData = group.data;
        const recommendations: DiagnosticsRecommendation[] = [];
        if (groupData?.securityEnabled === false) {
          recommendations.push({
            code: 'entitlement_group_not_security',
            severity: 'warn',
            text: 'The configured entitlement group is not a security group; membership may not be enforceable.',
            messageKey: 'entitlementGroupNotSecurity',
          });
        }
        const data: Record<string, unknown> = {
          groupId: groupData?.id,
          displayName: groupData?.displayName,
          securityEnabled: groupData?.securityEnabled,
        };
        if (!firstUserId) {
          return {
            status: recommendations.length ? ('warn' as const) : ('pass' as const),
            http: {
              method: 'GET',
              path: '/groups/{id}',
              status: group.status,
              requestId: group.requestId,
              clientRequestId: group.clientRequestId,
            },
            data: { ...data, membershipSkipped: 'No user is available to test membership.' },
            recommendations,
          };
        }
        const membership = await axios.post(
          `${getMicrosoftGraphBaseUrl()}/users/${encodeURIComponent(firstUserId)}/checkMemberGroups`,
          { groupIds: [portal.entitlementGroupId] },
          {
            headers: { Authorization: `Bearer ${accessToken}`, 'client-request-id': randomUUID() },
            timeout: 15000,
            signal,
          }
        );
        const isMember =
          Array.isArray(membership.data?.value) &&
          membership.data.value.includes(portal.entitlementGroupId);
        return {
          status: recommendations.length ? ('warn' as const) : ('pass' as const),
          http: {
            method: 'POST',
            path: '/users/{id}/checkMemberGroups',
            status: membership.status,
            requestId: membership.headers?.['request-id'],
          },
          data: { ...data, membershipTested: true, sampledUserIsMember: isMember },
          recommendations,
        };
      } catch (error: any) {
        if (error?.response?.status === 404) {
          const rec: DiagnosticsRecommendation = {
            code: 'entitlement_group_missing',
            severity: 'fail',
            text: 'The configured entitlement group no longer exists in this customer tenant.',
            messageKey: 'entitlementGroupMissing',
          };
          recState.recommendations.push(rec);
          return {
            status: 'fail' as const,
            http: {
              method: 'GET',
              path: '/groups/{id}',
              status: 404,
              requestId: error?.response?.headers?.['request-id'],
            },
            error: { message: rec.text, status: 404, requestId: error?.response?.headers?.['request-id'] },
            recommendations: [rec],
          };
        }
        const classified = classifyEntraOAuthFailure({
          message: error?.message,
          httpStatus: error?.response?.status,
          code: error?.code,
          responseBody: error?.response?.data,
          context: 'customer',
          customer: { entraTenantId: mapping.entraTenantId, applicationClientId: boundClientId, operation: 'membership' },
        });
        recState.recommendations.push(...[classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[]);
        return {
          status: 'fail' as const,
          http: {
            method: 'POST',
            path: '/users/{id}/checkMemberGroups',
            status: error?.response?.status,
            requestId: error?.response?.headers?.['request-id'],
          },
          error: {
            message: classified.remedy,
            status: error?.response?.status,
            requestId: error?.response?.headers?.['request-id'],
          },
          recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
        };
      }
    }
  );

  // Optional user yield preview, resumable across requests via its nextLink.
  if (!includeUserYield) {
    await runner.runStep('user_yield_preview', 'User yield preview', {}, async () => ({
      status: 'skip' as const,
      data: { reason: 'User yield preview is off.' },
    }));
  } else if (!accessToken || !usersReadOk) {
    await runner.runStep('user_yield_preview', 'User yield preview', {}, async () => ({
      status: 'skip' as const,
      data: { reason: 'No usable tenant token/directory read.' },
    }));
  } else {
    const startCounts = options.resumeYield?.counts ?? {
      totalUsers: 0,
      includedUsers: 0,
      excluded: {} as Record<string, number>,
    };
    try {
      const outcome = await pageUserYield({
        tenant,
        mapping,
        accessToken,
        signal,
        deadline,
        startNextLink: options.resumeYield?.nextLink ?? null,
        startCounts,
      });
      if (!outcome.done) {
        const pendingOutcome = outcome as {
          done: false;
          nextLink: string;
          counts: EntraPendingYield['counts'];
        };
        return {
          pending: {
            clientId: mapping.clientId,
            managedTenantId: mapping.managedTenantId,
            entraTenantId: mapping.entraTenantId,
            nextLink: pendingOutcome.nextLink,
            counts: pendingOutcome.counts,
          },
        };
      }
      const counts = outcome.counts;
      const recommendations: DiagnosticsRecommendation[] = [];
      const allExcluded = counts.totalUsers > 0 && counts.includedUsers === 0;
      if (allExcluded) {
        recommendations.push({
          code: 'all_users_excluded',
          severity: 'warn',
          text: 'Every user in this directory was excluded by the current filter rules; sync would create no contacts.',
          messageKey: 'allUsersExcluded',
        });
      }
      await runner.runStep('user_yield_preview', 'User yield preview', {}, async () => ({
        status: recommendations.length ? ('warn' as const) : ('pass' as const),
        data: {
          totalUsers: counts.totalUsers,
          includedUsers: counts.includedUsers,
          excludedByReason: counts.excluded,
          emptyDirectory: counts.totalUsers === 0,
        },
        recommendations,
      }));
      recState.recommendations.push(...recommendations);
    } catch (error: any) {
      const classified = classifyEntraOAuthFailure({
        message: error?.message,
        httpStatus: error?.response?.status,
        code: error?.code,
        context: 'customer',
        customer: { entraTenantId: mapping.entraTenantId, applicationClientId: boundClientId, operation: 'users' },
      });
      const rec: DiagnosticsRecommendation = classified.recommendation ?? {
        code: 'yield_failed',
        severity: 'warn',
        text: error?.message || 'The yield preview could not be computed.',
        messageKey: 'yieldFailed',
      };
      recState.recommendations.push(rec);
      await runner.runStep('user_yield_preview', 'User yield preview', {}, async () => ({
        status: 'warn' as const,
        error: { message: rec.text },
        recommendations: [rec],
      }));
    }
  }

  const steps = runner.steps;
  let overallStatus = computeOverallStatus(steps);
  const categories = classifyClientCategory(steps);
  if (categories === 'ok' && overallStatus !== 'pass') {
    overallStatus = overallStatus;
  }
  const recommendationList = dedupeRecommendations([
    ...recState.recommendations,
    ...collectStepRecommendations(steps),
  ]);

  return {
    result: {
      clientId: mapping.clientId,
      clientName: mapping.clientName,
      entraTenantId: mapping.entraTenantId,
      entraTenantDisplayName: mapping.displayName,
      overallStatus,
      category: categories,
      remedy: recommendationList[0]?.text ?? null,
      steps,
      isComplete: true,
    },
  };
}

/**
 * Deterministic primary-failure precedence for a client result. A warning that
 * needs attention (including all-users-excluded) belongs to `other`, not `ok`.
 */
function classifyClientCategory(steps: EntraDiagnosticsStep[]): EntraClientOutcomeCategory {
  const has = (code: string) =>
    steps.some((step) => (step.recommendations ?? []).some((rec) => rec.code === code));
  if (has('customer_consent_required') || has('partner_consent_required')) return 'need_consent';
  if (has('conditional_access')) return 'conditional_access';
  if (has('customer_directory_role_missing')) return 'missing_role';
  const failed = steps.some((step) => step.status === 'fail');
  const warned = steps.some((step) => step.status === 'warn');
  if (failed) return 'other';
  if (warned) return 'other';
  return 'ok';
}

async function runCippClient(options: {
  tenant: string;
  mapping: ConfirmedEntraMapping;
  includeUserYield: boolean;
}): Promise<ClientRunOutput> {
  const { tenant, mapping, includeUserYield } = options;
  const runner = createEntraStepRunner();
  const recState: ClientRecommendationState = { recommendations: [] };
  const credentials = await getEntraCippCredentials(tenant);

  if (!credentials) {
    await runner.runStep('per_tenant_users', 'CIPP per-tenant users', {}, async () => {
      const rec: DiagnosticsRecommendation = {
        code: 'cipp_credentials_missing',
        severity: 'fail',
        text: 'CIPP credentials are not configured.',
        messageKey: 'cippCredentialsMissing',
      };
      recState.recommendations.push(rec);
      return { status: 'fail' as const, error: { message: rec.text }, recommendations: [rec] };
    });
  } else {
    let users: Awaited<ReturnType<CippProviderAdapter['listUsersForTenant']>> = [];
    let accessOk = false;
    await runner.runStep('per_tenant_users', 'CIPP per-tenant users', {}, async () => {
      try {
        users = await new CippProviderAdapter().listUsersForTenant({
          tenant,
          managedTenantId: mapping.entraTenantId,
        });
        accessOk = true;
        return {
          status: 'pass' as const,
          http: { method: 'GET', path: '/api/listusers' },
          data: { sampledUserCount: users.length, bounded: true },
        };
      } catch (error: any) {
        const isCredential = error?.code === 'credential-rejected';
        const rec: DiagnosticsRecommendation = isCredential
          ? {
              code: 'cipp_auth_rejected',
              severity: 'fail',
              text: 'CIPP rejected the API credential for this tenant. Rotate the CIPP API key from Settings > CIPP > API access; this is not an Azure client secret.',
              messageKey: 'cippAuthRejected',
            }
          : {
              code: 'cipp_per_tenant_failed',
              severity: 'fail',
              text: error?.message || 'CIPP could not read this tenant directory.',
              messageKey: 'cippPerTenantFailed',
            };
        recState.recommendations.push(rec);
        return { status: 'fail' as const, error: { message: rec.text, code: error?.code }, recommendations: [rec] };
      }
    });

    await runner.runStep(
      'user_yield_preview',
      'User yield preview',
      { requires: ['per_tenant_users'] },
      async () => {
        if (!includeUserYield) {
          return { status: 'skip' as const, data: { reason: 'User yield preview is off.' } };
        }
        if (!accessOk) {
          return { status: 'skip' as const, data: { reason: 'No usable CIPP directory read.' } };
        }
        try {
          const filtered = await filterEntraUsersForTenant(tenant, users);
          const excluded = filtered.excluded.reduce<Record<string, number>>((acc, item) => {
            acc[item.reason] = (acc[item.reason] ?? 0) + 1;
            return acc;
          }, {});
          const allExcluded = users.length > 0 && filtered.included.length === 0;
          const recommendations: DiagnosticsRecommendation[] = allExcluded
            ? [
                {
                  code: 'all_users_excluded',
                  severity: 'warn',
                  text: 'Every user in this directory was excluded by the current filter rules; sync would create no contacts.',
                  messageKey: 'allUsersExcluded',
                },
              ]
            : [];
          recState.recommendations.push(...recommendations);
          return {
            status: allExcluded ? ('warn' as const) : ('pass' as const),
            data: {
              totalUsers: users.length,
              includedUsers: filtered.included.length,
              excludedByReason: excluded,
              emptyDirectory: users.length === 0,
            },
            recommendations,
          };
        } catch (error: any) {
          const rec: DiagnosticsRecommendation = {
            code: 'yield_failed',
            severity: 'warn',
            text: error?.message || 'The yield preview could not be computed.',
            messageKey: 'yieldFailed',
          };
          recState.recommendations.push(rec);
          return { status: 'warn' as const, error: { message: rec.text }, recommendations: [rec] };
        }
      }
    );
  }

  const steps = runner.steps;
  const overallStatus = computeOverallStatus(steps);
  return {
    result: {
      clientId: mapping.clientId,
      clientName: mapping.clientName,
      entraTenantId: mapping.entraTenantId,
      entraTenantDisplayName: mapping.displayName,
      overallStatus,
      category: classifyClientCategory(steps),
      remedy: dedupeRecommendations(recState.recommendations)[0]?.text ?? null,
      steps,
      isComplete: true,
    },
  };
}

function zeroAggregate(): Record<EntraClientOutcomeCategory, number> {
  return { ok: 0, need_consent: 0, conditional_access: 0, missing_role: 0, other: 0 };
}

function partialContinuation(
  base: {
    total: number;
    completed: number;
    clients: EntraClientDiagnosticsResult[];
    aggregate: Record<EntraClientOutcomeCategory, number>;
    recommendations: DiagnosticsRecommendation[];
    startedAt: number;
  },
  error: string
): EntraClientDiagnosticsContinuation {
  return {
    jobId: '',
    scope: 'clients',
    total: base.total,
    completed: base.completed,
    isDone: false,
    expiresAt: new Date().toISOString(),
    clients: base.clients,
    aggregate: base.aggregate,
    overallStatus: computeOverallStatus(base.clients.map((c) => ({ status: c.overallStatus }))),
    error,
    steps: [],
    recommendations: base.recommendations,
    startedAt: new Date(base.startedAt).toISOString(),
    completedAt: null,
  };
}

function emptyContinuation(message: string, total = 0): EntraClientDiagnosticsContinuation {
  return {
    jobId: '',
    scope: 'clients',
    total,
    completed: 0,
    isDone: true,
    expiresAt: new Date().toISOString(),
    clients: [],
    aggregate: zeroAggregate(),
    overallStatus: 'fail',
    error: message,
    steps: [],
    recommendations: [],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

export async function runEntraClientAccessDiagnostics(
  tenant: string,
  userId: string,
  input: EntraClientAccessDiagnosticsInput & { continuation?: string }
): Promise<EntraClientDiagnosticsContinuation> {
  const connection = await getActiveEntraPartnerConnection(tenant);
  if (!connection) {
    return emptyContinuation('No active Entra connection is configured for this workspace.');
  }
  if (connection.connection_type !== 'direct' && connection.connection_type !== 'cipp') {
    return emptyContinuation('The active Entra connection type is not supported.');
  }

  const allMappings = await listConfirmedEntraMappings(tenant);
  const mappingByClientId = new Map(allMappings.map((m) => [m.clientId, m]));

  let payload: EntraClientContinuationPayload | null = null;
  if (input.continuation) {
    payload = verifyContinuation(input.continuation);
    if (!payload || payload.tenant !== tenant || payload.userId !== userId) {
      return emptyContinuation('The diagnostics continuation is invalid or has expired. Restart the run.');
    }
    if (payload.connectionType !== connection.connection_type) {
      return emptyContinuation('The Entra connection changed since this run started. Restart the run.');
    }
    if ((payload.connectionId ?? null) !== (connection.connection_id ?? null)) {
      return emptyContinuation('The Entra connection was reconnected since this run started. Restart the run.');
    }
    const changed: string[] = [];
    for (const selection of payload.selection) {
      const current = mappingByClientId.get(selection.clientId);
      if (
        !current ||
        current.managedTenantId !== selection.managedTenantId ||
        current.entraTenantId !== selection.entraTenantId
      ) {
        changed.push(selection.clientId);
      }
    }
    if (changed.length > 0) {
      return emptyContinuation(
        `${changed.length} selected client mapping(s) changed or were removed since this run started. Restart the run.`,
        payload.total
      );
    }
  }

  let selection: EntraContinuationSelection[];
  let includeUserYield: boolean;
  let offset: number;
  let total: number;
  let recentResults: EntraClientDiagnosticsResult[];
  let aggregate: Record<EntraClientOutcomeCategory, number>;
  let accumulatedRecs: DiagnosticsRecommendation[];
  let pending: EntraPendingYield | null;
  let startedAt: number;
  let failedCount: number;
  let warnCount: number;

  if (payload) {
    selection = payload.selection;
    includeUserYield = payload.includeUserYield;
    offset = payload.offset;
    total = payload.total;
    recentResults = payload.recentResults;
    aggregate = payload.aggregate;
    accumulatedRecs = payload.recommendations;
    pending = payload.pending;
    startedAt = payload.startedAt;
    failedCount = payload.failedCount;
    warnCount = payload.warnCount;
  } else {
    includeUserYield = input.includeUserYield ?? false;
    let chosen: ConfirmedEntraMapping[];
    if (input.clientIds === undefined) {
      chosen = allMappings;
    } else if (Array.isArray(input.clientIds)) {
      const unique = Array.from(new Set(input.clientIds));
      if (unique.length > MAX_SELECTION) {
        return emptyContinuation(
          `Too many selected clients (${unique.length}); the maximum is ${MAX_SELECTION}.`,
          unique.length
        );
      }
      const foreign = unique.filter((id) => !mappingByClientId.has(id));
      if (foreign.length > 0) {
        return emptyContinuation(
          'The selection included clients that are not mapped in this workspace.',
          unique.length
        );
      }
      chosen = unique.map((id) => mappingByClientId.get(id)!);
    } else {
      return emptyContinuation('clientIds must be an array of client ids.');
    }
    selection = chosen.map((m) => ({
      clientId: m.clientId,
      managedTenantId: m.managedTenantId,
      entraTenantId: m.entraTenantId,
    }));
    offset = 0;
    total = selection.length;
    recentResults = [];
    aggregate = zeroAggregate();
    accumulatedRecs = [];
    pending = null;
    startedAt = Date.now();
    failedCount = 0;
    warnCount = 0;
  }

  if (total === 0) {
    return {
      jobId: '',
      scope: 'clients',
      total: 0,
      completed: 0,
      isDone: true,
      expiresAt: new Date().toISOString(),
      clients: [],
      aggregate: zeroAggregate(),
      overallStatus: 'pass',
      steps: [],
      recommendations: [],
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  // Validate signing capability before doing expensive work when more than one
  // request will be required.
  if (total > MAX_CLIENTS_PER_REQUEST) {
    try {
      assertContinuationSigningAvailable();
    } catch (error) {
      return partialContinuation(
        { total, completed: offset, clients: [], aggregate, recommendations: accumulatedRecs, startedAt },
        error instanceof DiagnosticsSigningSecretUnavailableError
          ? error.message
          : 'Entra diagnostics cannot continue because signing is misconfigured.'
      );
    }
  }

  const boundClientId =
    connection.connection_type === 'direct'
      ? (await resolveMicrosoftCredentialsForTenant(tenant))?.clientId ?? null
      : null;

  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const newResults: EntraClientDiagnosticsResult[] = [];
  const newRecs: DiagnosticsRecommendation[] = [];

  const recordResult = (result: EntraClientDiagnosticsResult) => {
    newResults.push(result);
    recentResults = [...recentResults, result].slice(-MAX_EMBEDDED_RESULTS);
    aggregate = addCategory(aggregate, result.category);
    newRecs.push(...collectStepRecommendations(result.steps));
    if (result.overallStatus === 'fail') failedCount += 1;
    else if (result.overallStatus === 'warn') warnCount += 1;
  };

  const base = {
    tenant,
    userId,
    connection,
    selection,
    includeUserYield,
    total,
    accumulatedRecs,
    newResults,
    newRecs,
    startedAt,
    get failedCount() {
      return failedCount;
    },
    get warnCount() {
      return warnCount;
    },
  };

  // Resume a pending yield first, else start at the next finalized offset.
  let cursor = offset;
  if (pending) {
    const mapping = mappingByClientId.get(pending.clientId);
    if (!mapping) {
      return emptyContinuation('The pending client mapping no longer exists. Restart the run.', total);
    }
    const outcome = await runClientWithBudget({
      connection,
      tenant,
      mapping,
      boundClientId,
      includeUserYield,
      deadline,
      resumeYield: pending,
    });
    if (outcome.pending) {
      return finalizeOrContinue({
        ...base,
        offset,
        recentResults,
        aggregate,
        pending: outcome.pending,
      });
    }
    if (outcome.result) {
      recordResult(outcome.result);
      cursor = offset + 1;
      pending = null;
    }
  }

  while (cursor < selection.length && newResults.length < MAX_CLIENTS_PER_REQUEST && Date.now() < deadline) {
    const entry = selection[cursor];
    const mapping = mappingByClientId.get(entry.clientId);
    if (!mapping) {
      cursor += 1;
      continue;
    }
    const outcome = await runClientWithBudget({
      connection,
      tenant,
      mapping,
      boundClientId,
      includeUserYield,
      deadline,
      resumeYield: null,
    });
    if (outcome.pending) {
      return finalizeOrContinue({
        ...base,
        offset: cursor,
        recentResults,
        aggregate,
        pending: outcome.pending,
      });
    }
    if (outcome.result) {
      recordResult(outcome.result);
    }
    cursor += 1;
  }

  const isDone = cursor >= total;
  return finalizeOrContinue({
    ...base,
    offset: cursor,
    recentResults,
    aggregate,
    pending: null,
    forceDone: isDone,
  });
}

async function runClientWithBudget(params: {
  connection: any;
  tenant: string;
  mapping: ConfirmedEntraMapping;
  boundClientId: string | null;
  includeUserYield: boolean;
  deadline: number;
  resumeYield: EntraPendingYield | null;
}): Promise<ClientRunOutput> {
  const remaining = params.deadline - Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(CLIENT_BUDGET_MS, remaining))
  );
  try {
    if (params.connection.connection_type === 'cipp') {
      return await runCippClient({
        tenant: params.tenant,
        mapping: params.mapping,
        includeUserYield: params.includeUserYield,
      });
    }
    return await runDirectClient({
      tenant: params.tenant,
      mapping: params.mapping,
      boundClientId: params.boundClientId,
      includeUserYield: params.includeUserYield,
      signal: controller.signal,
      deadline: params.deadline,
      resumeYield: params.resumeYield,
    });
  } finally {
    clearTimeout(timer);
  }
}

function addCategory(
  aggregate: Record<EntraClientOutcomeCategory, number>,
  category: EntraClientOutcomeCategory
): Record<EntraClientOutcomeCategory, number> {
  return { ...aggregate, [category]: aggregate[category] + 1 };
}

function finalizeOrContinue(params: {
  tenant: string;
  userId: string;
  connection: any;
  selection: EntraContinuationSelection[];
  includeUserYield: boolean;
  offset: number;
  total: number;
  recentResults: EntraClientDiagnosticsResult[];
  aggregate: Record<EntraClientOutcomeCategory, number>;
  accumulatedRecs: DiagnosticsRecommendation[];
  pending: EntraPendingYield | null;
  newResults: EntraClientDiagnosticsResult[];
  newRecs: DiagnosticsRecommendation[];
  startedAt: number;
  failedCount: number;
  warnCount: number;
  forceDone?: boolean;
}): EntraClientDiagnosticsContinuation {
  const isDone = params.forceDone ?? (params.offset >= params.total && !params.pending);
  const recommendations = dedupeRecommendations([
    ...params.accumulatedRecs,
    ...params.newRecs,
  ]).slice(-MAX_EMBEDDED_RECOMMENDATIONS);

  const safeNew = params.newResults.map((r) => sanitizeClient(r, true));
  const safeRecommendations = sanitizeRecommendations(recommendations, true);
  const overallStatus =
    params.failedCount > 0 ? 'fail' : params.warnCount > 0 ? 'warn' : 'pass';

  let jobId = '';
  let error: string | undefined;
  if (!isDone) {
    try {
      jobId = signContinuation({
        v: 1,
        tenant: params.tenant,
        userId: params.userId,
        scope: 'clients',
        connectionType: params.connection.connection_type,
        connectionId: params.connection.connection_id ?? null,
        selection: params.selection,
        includeUserYield: params.includeUserYield,
        offset: params.offset,
        total: params.total,
        recentResults: params.recentResults,
        aggregate: params.aggregate,
        failedCount: params.failedCount,
        warnCount: params.warnCount,
        recommendations,
        pending: params.pending,
        startedAt: params.startedAt,
        exp: Date.now() + DEFAULT_CONTINUATION_TTL_MS,
      });
    } catch (signError) {
      error =
        signError instanceof DiagnosticsContinuationError ||
        signError instanceof DiagnosticsSigningSecretUnavailableError
          ? signError.message
          : 'Entra diagnostics could not continue.';
    }
  }

  return {
    jobId,
    scope: 'clients',
    total: params.total,
    completed: params.offset,
    isDone: isDone && !error,
    expiresAt: new Date(Date.now() + DEFAULT_CONTINUATION_TTL_MS).toISOString(),
    clients: safeNew,
    aggregate: params.aggregate,
    overallStatus,
    error,
    steps: [],
    recommendations: safeRecommendations,
    startedAt: new Date(params.startedAt).toISOString(),
    completedAt: isDone && !error ? new Date().toISOString() : null,
  };
}
