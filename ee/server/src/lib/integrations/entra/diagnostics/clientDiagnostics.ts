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
  decodeJwtPayload,
} from '@alga-psa/shared/services/diagnostics';
import { getMicrosoftGraphBaseUrl } from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getActiveEntraPartnerConnection } from '../connectionRepository';
import { refreshEntraDirectAccessTokenForTenant } from '../auth/refreshDirectToken';
import { getEntraCippCredentials } from '../providers/cipp/cippSecretStore';
import { listConfirmedEntraMappings, type ConfirmedEntraMapping } from '../mapping/confirmedMappingsService';
import { filterEntraUsersForTenant } from '../settingsService';
import { normalizeEntraSyncUser } from '../sync/types';
import { classifyEntraOAuthFailure } from './oauthClassifier';
import { aggregateClientCategories, dedupeRecommendations } from './recommendations';
import {
  DEFAULT_CONTINUATION_TTL_MS,
  signContinuation,
  verifyContinuation,
  type EntraClientContinuationPayload,
} from './continuation';

export const MAX_CLIENTS_IN_FLIGHT = 3;

interface MappingPortalConfig {
  entitlementGroupId: string | null;
  entitlementMembershipMode: string | null;
}

interface ClientMutableState {
  category: EntraClientOutcomeCategory;
  remedy: string | null;
  recommendations: DiagnosticsRecommendation[];
}

function applyClassification(
  state: ClientMutableState,
  classification: ReturnType<typeof classifyEntraOAuthFailure>
): void {
  state.category = classification.category;
  state.remedy = classification.remedy;
  if (classification.recommendation) state.recommendations.push(classification.recommendation);
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

function errorOutcome(
  id: string,
  title: string,
  error: unknown
): { step: EntraDiagnosticsStep; classification: ReturnType<typeof classifyEntraOAuthFailure> } {
  const classified = classifyEntraOAuthFailure({
    message: (error as any)?.message ?? String(error),
    code: (error as any)?.code,
    httpStatus: (error as any)?.response?.status,
    responseBody: (error as any)?.response?.data,
    context: 'customer',
  });
  return {
    step: {
      id,
      title,
      status: 'fail',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      error: {
        message: classified.remedy,
        status: (error as any)?.response?.status,
        code: (error as any)?.code,
        aadstsCode: classified.aadstsCode ?? undefined,
        requestId: (error as any)?.response?.headers?.['request-id'],
      },
      recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
    },
    classification: classified,
  };
}

async function directUsersRead(
  accessToken: string,
  path: string
): Promise<{ status: number; requestId?: string; data: any; clientRequestId: string }> {
  const clientRequestId = randomUUID();
  const res = await axios.get(`${getMicrosoftGraphBaseUrl()}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'client-request-id': clientRequestId,
      'return-client-request-id': 'true',
    },
    timeout: 15000,
  });
  return {
    status: res.status,
    requestId: res.headers?.['request-id'],
    clientRequestId: res.headers?.['client-request-id'] ?? clientRequestId,
    data: res.data,
  };
}

async function runDirectClient(
  tenant: string,
  mapping: ConfirmedEntraMapping,
  includeUserYield: boolean
): Promise<{ result: EntraClientDiagnosticsResult; recommendations: DiagnosticsRecommendation[] }> {
  const steps: EntraDiagnosticsStep[] = [];
  const state: ClientMutableState = { category: 'ok', remedy: null, recommendations: [] };
  const portal = await loadMappingPortalConfig(tenant, mapping.managedTenantId);
  let accessToken: string | null = null;
  let firstUserId: string | null = null;
  let usersReadOk = false;
  let groupsTokenUsable = true;

  // 4.1 tenant_token_mint
  const mintStarted = Date.now();
  try {
    const minted = await refreshEntraDirectAccessTokenForTenant(tenant, mapping.entraTenantId);
    accessToken = minted.accessToken;
    const claims = decodeJwtPayload(minted.accessToken);
    steps.push({
      id: 'tenant_token_mint',
      title: 'Mint customer tenant token',
      status: 'pass',
      startedAt: new Date().toISOString(),
      durationMs: Date.now() - mintStarted,
      data: {
        tenantId: mapping.entraTenantId,
        tenant: claims?.tid,
        accessTokenFingerprint: buildTokenFingerprint(minted.accessToken),
        expiresAt: minted.expiresAt,
      },
    });
  } catch (error) {
    const { step, classification } = errorOutcome('tenant_token_mint', 'Mint customer tenant token', error);
    step.durationMs = Date.now() - mintStarted;
    steps.push(step);
    applyClassification(state, classification);
  }

  // 4.2 users_read
  if (accessToken) {
    const usersStarted = Date.now();
    try {
      const read = await directUsersRead(accessToken, `/users?$select=id&$top=1`);
      firstUserId = read.data?.value?.[0]?.id ?? null;
      usersReadOk = true;
      steps.push({
        id: 'users_read',
        title: 'Read directory users',
        status: 'pass',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - usersStarted,
        http: {
          method: 'GET',
          path: '/users?$select=id&$top=1',
          status: read.status,
          requestId: read.requestId,
          clientRequestId: read.clientRequestId,
        },
        data: { userFound: Boolean(firstUserId), emptyDirectory: !firstUserId },
      });
    } catch (error) {
      const classified = classifyEntraOAuthFailure({
        message: (error as any)?.message,
        httpStatus: (error as any)?.response?.status,
        code: (error as any)?.code,
        responseBody: (error as any)?.response?.data,
        context: 'customer',
        customer: {
          entraTenantId: mapping.entraTenantId,
          applicationClientId: null,
          operation: 'users',
        },
      });
      const step: EntraDiagnosticsStep = {
        id: 'users_read',
        title: 'Read directory users',
        status: 'fail',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - usersStarted,
        http: {
          method: 'GET',
          path: '/users?$select=id&$top=1',
          status: (error as any)?.response?.status,
          requestId: (error as any)?.response?.headers?.['request-id'],
        },
        error: { message: classified.remedy },
        recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
      };
      steps.push(step);
      applyClassification(state, classified);
      // A users denial does not necessarily invalidate the token for groups.
      groupsTokenUsable = true;
    }
  } else {
    steps.push({
      id: 'users_read',
      title: 'Read directory users',
      status: 'skip',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      blockedBy: 'tenant_token_mint',
    });
    groupsTokenUsable = false;
  }

  // 4.3 groups_read
  if (accessToken && groupsTokenUsable) {
    const groupsStarted = Date.now();
    try {
      const read = await directUsersRead(accessToken, `/groups?$select=id&$top=1`);
      steps.push({
        id: 'groups_read',
        title: 'Read directory groups',
        status: 'pass',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - groupsStarted,
        http: {
          method: 'GET',
          path: '/groups?$select=id&$top=1',
          status: read.status,
          requestId: read.requestId,
          clientRequestId: read.clientRequestId,
        },
        data: { groupFound: Boolean(read.data?.value?.[0]?.id) },
      });
    } catch (error) {
      const classified = classifyEntraOAuthFailure({
        message: (error as any)?.message,
        httpStatus: (error as any)?.response?.status,
        code: (error as any)?.code,
        responseBody: (error as any)?.response?.data,
        context: 'customer',
        customer: {
          entraTenantId: mapping.entraTenantId,
          applicationClientId: null,
          operation: 'groups',
        },
      });
      steps.push({
        id: 'groups_read',
        title: 'Read directory groups',
        status: 'fail',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - groupsStarted,
        http: {
          method: 'GET',
          path: '/groups?$select=id&$top=1',
          status: (error as any)?.response?.status,
          requestId: (error as any)?.response?.headers?.['request-id'],
        },
        error: { message: classified.remedy },
        recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
      });
      // Keep the primary failure deterministic: only override if not already set.
      if (state.category === 'ok') applyClassification(state, classified);
    }
  } else {
    steps.push({
      id: 'groups_read',
      title: 'Read directory groups',
      status: 'skip',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      blockedBy: accessToken ? 'users_read' : 'tenant_token_mint',
    });
  }

  // 4.4 entitlement_group_resolves
  const entStarted = Date.now();
  if (!portal.entitlementGroupId) {
    steps.push({
      id: 'entitlement_group_resolves',
      title: 'Resolve entitlement group',
      status: 'skip',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      data: { reason: 'No entitlement group is configured for this client.' },
    });
  } else if (!accessToken) {
    steps.push({
      id: 'entitlement_group_resolves',
      title: 'Resolve entitlement group',
      status: 'skip',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      blockedBy: 'tenant_token_mint',
    });
  } else {
    try {
      const group = await directUsersRead(
        accessToken,
        `/groups/${encodeURIComponent(portal.entitlementGroupId)}?$select=id,displayName,securityEnabled`
      );
      const groupData = group.data;
      const stepData: Record<string, unknown> = {
        groupId: groupData?.id,
        displayName: groupData?.displayName,
        securityEnabled: groupData?.securityEnabled,
      };
      if (groupData?.securityEnabled === false) {
        state.recommendations.push({
          code: 'entitlement_group_not_security',
          severity: 'warn',
          text: 'The configured entitlement group is not a security group; membership may not be enforceable.',
          messageKey: 'entitlementGroupNotSecurity',
        });
        if (state.category === 'ok') state.category = 'other';
      }
      if (!firstUserId) {
        steps.push({
          id: 'entitlement_group_resolves',
          title: 'Resolve entitlement group',
          status: 'pass',
          startedAt: new Date().toISOString(),
          durationMs: Date.now() - entStarted,
          data: { ...stepData, membershipSkipped: 'No user is available to test membership.' },
        });
      } else {
        const membershipStart = Date.now();
        const res = await axios.post(
          `${getMicrosoftGraphBaseUrl()}/users/${encodeURIComponent(firstUserId)}/checkMemberGroups`,
          { groupIds: [portal.entitlementGroupId] },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'client-request-id': randomUUID(),
            },
            timeout: 15000,
          }
        );
        const isMember = Array.isArray(res.data?.value) && res.data.value.includes(portal.entitlementGroupId);
        steps.push({
          id: 'entitlement_group_resolves',
          title: 'Resolve entitlement group',
          status: 'pass',
          startedAt: new Date().toISOString(),
          durationMs: Date.now() - entStarted,
          data: {
            ...stepData,
            membershipTested: true,
            membershipDurationMs: Date.now() - membershipStart,
            sampledUserIsMember: isMember,
          },
        });
      }
    } catch (error) {
      if ((error as any)?.response?.status === 404) {
        const rec: DiagnosticsRecommendation = {
          code: 'entitlement_group_missing',
          severity: 'fail',
          text: 'The configured entitlement group no longer exists in this customer tenant.',
          messageKey: 'entitlementGroupMissing',
        };
        state.recommendations.push(rec);
        if (state.category === 'ok') state.category = 'other';
        steps.push({
          id: 'entitlement_group_resolves',
          title: 'Resolve entitlement group',
          status: 'fail',
          startedAt: new Date().toISOString(),
          durationMs: Date.now() - entStarted,
          error: { message: rec.text, status: 404 },
          recommendations: [rec],
        });
      } else {
        const classified = classifyEntraOAuthFailure({
          message: (error as any)?.message,
          httpStatus: (error as any)?.response?.status,
          code: (error as any)?.code,
          responseBody: (error as any)?.response?.data,
          context: 'customer',
          customer: { entraTenantId: mapping.entraTenantId, operation: 'membership' },
        });
        if (state.category === 'ok') applyClassification(state, classified);
        steps.push({
          id: 'entitlement_group_resolves',
          title: 'Resolve entitlement group',
          status: 'fail',
          startedAt: new Date().toISOString(),
          durationMs: Date.now() - entStarted,
          error: { message: classified.remedy },
          recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
        });
      }
    }
  }

  // 4.5 user_yield_preview
  if (!includeUserYield) {
    steps.push({
      id: 'user_yield_preview',
      title: 'User yield preview',
      status: 'skip',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      data: { reason: 'User yield preview is off.' },
    });
  } else if (!accessToken) {
    steps.push({
      id: 'user_yield_preview',
      title: 'User yield preview',
      status: 'skip',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      blockedBy: 'tenant_token_mint',
    });
  } else if (!usersReadOk) {
    steps.push({
      id: 'user_yield_preview',
      title: 'User yield preview',
      status: 'skip',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      blockedBy: 'users_read',
    });
  } else {
    const yieldStart = Date.now();
    try {
      const users = await fetchAllDirectUsers(accessToken);
      const filtered = await filterEntraUsersForTenant(tenant, users);
      const excluded = filtered.excluded.reduce<Record<string, number>>((acc, item) => {
        acc[item.reason] = (acc[item.reason] ?? 0) + 1;
        return acc;
      }, {});
      const allExcluded = users.length > 0 && filtered.included.length === 0;
      if (allExcluded) {
        state.recommendations.push({
          code: 'all_users_excluded',
          severity: 'warn',
          text: 'Every user in this directory was excluded by the current filter rules; sync would create no contacts.',
          messageKey: 'allUsersExcluded',
        });
        if (state.category === 'ok') state.category = 'other';
      }
      steps.push({
        id: 'user_yield_preview',
        title: 'User yield preview',
        status: allExcluded ? 'warn' : 'pass',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - yieldStart,
        data: {
          totalUsers: users.length,
          includedUsers: filtered.included.length,
          excludedUsers: filtered.excluded.length,
          excludedByReason: excluded,
          emptyDirectory: users.length === 0,
        },
      });
    } catch (error) {
      const { step, classification } = errorOutcome('user_yield_preview', 'User yield preview', error);
      steps.push(step);
      if (state.category === 'ok') applyClassification(state, classification);
    }
  }

  const overallStatus = steps.some((s) => s.status === 'fail')
    ? 'fail'
    : steps.some((s) => s.status === 'warn')
      ? 'warn'
      : 'pass';

  return {
    result: {
      clientId: mapping.clientId,
      clientName: mapping.clientName,
      entraTenantId: mapping.entraTenantId,
      entraTenantDisplayName: mapping.displayName,
      overallStatus,
      category: state.category,
      remedy: state.remedy,
      steps,
      isComplete: true,
    },
    recommendations: state.recommendations,
  };
}

async function fetchAllDirectUsers(accessToken: string) {
  const base = getMicrosoftGraphBaseUrl();
  const select =
    'id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled,jobTitle,mobilePhone,businessPhones';
  let url: string | null = `${base}/users?$select=${select}&$top=999`;
  const users: ReturnType<typeof normalizeEntraSyncUser>[] = [];
  const seen = new Set<string>();
  let pages = 0;
  while (url && pages < 50) {
    const res: any = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20000,
    });
    for (const raw of res.data?.value ?? []) {
      const normalized = normalizeEntraSyncUser(raw);
      if (normalized?.entraObjectId && !seen.has(normalized.entraObjectId)) {
        seen.add(normalized.entraObjectId);
        users.push(normalized);
      }
    }
    url = res.data?.['@odata.nextLink'] ?? null;
    pages += 1;
  }
  return users;
}

async function runCippClient(
  tenant: string,
  mapping: ConfirmedEntraMapping,
  includeUserYield: boolean
): Promise<{ result: EntraClientDiagnosticsResult; recommendations: DiagnosticsRecommendation[] }> {
  const steps: EntraDiagnosticsStep[] = [];
  const state: ClientMutableState = { category: 'ok', remedy: null, recommendations: [] };
  const started = Date.now();
  const credentials = await getEntraCippCredentials(tenant);
  if (!credentials) {
    steps.push({
      id: 'per_tenant_users',
      title: 'CIPP per-tenant users',
      status: 'fail',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      error: { message: 'CIPP credentials are not configured.' },
    });
    state.category = 'other';
    state.remedy = 'Configure CIPP credentials on the Connection tab.';
  } else {
    const base = credentials.baseUrl.replace(/\/+$/, '');
    const headers = {
      Authorization: `Bearer ${credentials.apiToken}`,
      'X-API-KEY': credentials.apiToken,
    };
    try {
      const res = await axios.get(
        `${base}/api/listusers?tenantFilter=${encodeURIComponent(mapping.entraTenantId)}`,
        { headers, timeout: 20000 }
      );
      const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? res.data?.value ?? []);
      steps.push({
        id: 'per_tenant_users',
        title: 'CIPP per-tenant users',
        status: 'pass',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        http: { method: 'GET', path: '/api/listusers', status: res.status },
        data: { sampledUserCount: Array.isArray(rows) ? rows.length : 0, bounded: true },
      });
      if (includeUserYield) {
        const yieldStart = Date.now();
        const all = await fetchAllCippUsers(base, headers, mapping.entraTenantId);
        const filtered = await filterEntraUsersForTenant(tenant, all);
        const excluded = filtered.excluded.reduce<Record<string, number>>((acc, item) => {
          acc[item.reason] = (acc[item.reason] ?? 0) + 1;
          return acc;
        }, {});
        const allExcluded = all.length > 0 && filtered.included.length === 0;
        if (allExcluded) {
          state.recommendations.push({
            code: 'all_users_excluded',
            severity: 'warn',
            text: 'Every user in this directory was excluded by the current filter rules; sync would create no contacts.',
            messageKey: 'allUsersExcluded',
          });
          state.category = 'other';
        }
        steps.push({
          id: 'user_yield_preview',
          title: 'User yield preview',
          status: allExcluded ? 'warn' : 'pass',
          startedAt: new Date().toISOString(),
          durationMs: Date.now() - yieldStart,
          data: {
            totalUsers: all.length,
            includedUsers: filtered.included.length,
            excludedByReason: excluded,
            emptyDirectory: all.length === 0,
          },
        });
      } else {
        steps.push({
          id: 'user_yield_preview',
          title: 'User yield preview',
          status: 'skip',
          startedAt: new Date().toISOString(),
          durationMs: 0,
          data: { reason: 'User yield preview is off.' },
        });
      }
    } catch (error) {
      const classified = classifyEntraOAuthFailure({
        message: (error as any)?.message,
        httpStatus: (error as any)?.response?.status,
        code: (error as any)?.code,
        responseBody: (error as any)?.response?.data,
        context: 'customer',
        customer: { entraTenantId: mapping.entraTenantId, operation: 'users' },
      });
      steps.push({
        id: 'per_tenant_users',
        title: 'CIPP per-tenant users',
        status: 'fail',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        error: { message: classified.remedy },
        recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
      });
      applyClassification(state, classified);
    }
  }

  const overallStatus = steps.some((s) => s.status === 'fail') ? 'fail' : 'pass';
  return {
    result: {
      clientId: mapping.clientId,
      clientName: mapping.clientName,
      entraTenantId: mapping.entraTenantId,
      entraTenantDisplayName: mapping.displayName,
      overallStatus,
      category: state.category,
      remedy: state.remedy,
      steps,
      isComplete: true,
    },
    recommendations: state.recommendations,
  };
}

async function fetchAllCippUsers(
  base: string,
  headers: Record<string, string>,
  tenantFilter: string
) {
  const res: any = await axios.get(
    `${base}/api/listusers?tenantFilter=${encodeURIComponent(tenantFilter)}`,
    { headers, timeout: 30000 }
  );
  const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? res.data?.value ?? []);
  return (Array.isArray(rows) ? rows : []).map((raw: any) => normalizeEntraSyncUser(raw));
}

function emptyContinuation(
  message: string,
  total = 0
): EntraClientDiagnosticsContinuation {
  return {
    jobId: '',
    scope: 'clients',
    total,
    completed: 0,
    isDone: true,
    expiresAt: new Date().toISOString(),
    clients: [],
    aggregate: aggregateClientCategories([]),
    overallStatus: 'fail',
    error: message,
    steps: [],
    recommendations: [],
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
  }

  let clientIds: string[];
  let includeUserYield: boolean;
  let offset: number;
  let total: number;
  let accumulated: EntraClientDiagnosticsResult[];
  let accumulatedRecs: DiagnosticsRecommendation[];

  if (payload) {
    clientIds = payload.clientIds;
    includeUserYield = payload.includeUserYield;
    offset = payload.offset;
    total = payload.total;
    accumulated = payload.results;
    accumulatedRecs = payload.results.flatMap((r) =>
      r.steps.flatMap((s) => s.recommendations ?? [])
    );
  } else {
    includeUserYield = input.includeUserYield ?? false;
    if (input.clientIds === undefined) {
      clientIds = allMappings.map((m) => m.clientId);
    } else if (Array.isArray(input.clientIds)) {
      const unique = Array.from(new Set(input.clientIds));
      const foreign = unique.filter((id) => !mappingByClientId.has(id));
      if (foreign.length > 0) {
        return emptyContinuation(
          'The selection included clients that are not mapped in this workspace.',
          unique.length
        );
      }
      clientIds = unique;
    } else {
      return emptyContinuation('clientIds must be an array of client ids.');
    }
    offset = 0;
    total = clientIds.length;
    accumulated = [];
    accumulatedRecs = [];
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
      aggregate: aggregateClientCategories([]),
      overallStatus: 'pass',
      steps: [],
      recommendations: [],
    };
  }

  const batch = clientIds.slice(offset, offset + MAX_CLIENTS_IN_FLIGHT);
  const batchResults: EntraClientDiagnosticsResult[] = [];

  await Promise.all(
    batch.map(async (clientId) => {
      const mapping = mappingByClientId.get(clientId);
      if (!mapping) return;
      const outcome =
        connection.connection_type === 'cipp'
          ? await runCippClient(tenant, mapping, includeUserYield)
          : await runDirectClient(tenant, mapping, includeUserYield);
      batchResults.push(outcome.result);
      accumulatedRecs.push(...outcome.recommendations);
    })
  );

  // Preserve deterministic ordering within the batch.
  batchResults.sort((a, b) => clientIds.indexOf(a.clientId) - clientIds.indexOf(b.clientId));
  accumulated = [...accumulated, ...batchResults];
  const nextOffset = offset + batch.length;
  const isDone = nextOffset >= total;

  const aggregate = aggregateClientCategories(accumulated.map((r) => r.category));
  const overallStatus = accumulated.some((r) => r.overallStatus === 'fail')
    ? 'fail'
    : accumulated.some((r) => r.overallStatus === 'warn')
      ? 'warn'
      : 'pass';

  const expiresAt = Date.now() + DEFAULT_CONTINUATION_TTL_MS;
  const jobId = isDone
    ? ''
    : signContinuation({
        v: 1,
        tenant,
        userId,
        scope: 'clients',
        connectionType: connection.connection_type,
        clientIds,
        includeUserYield,
        offset: nextOffset,
        total,
        results: accumulated,
        exp: expiresAt,
      });

  return {
    jobId,
    scope: 'clients',
    total,
    completed: nextOffset,
    isDone,
    expiresAt: new Date(expiresAt).toISOString(),
    clients: batchResults,
    aggregate,
    overallStatus,
    steps: [],
    recommendations: dedupeRecommendations(accumulatedRecs),
  };
}
