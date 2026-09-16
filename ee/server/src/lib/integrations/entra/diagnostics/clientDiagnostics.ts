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
import { sanitizeClient } from './redaction';
import {
  DEFAULT_CONTINUATION_TTL_MS,
  DiagnosticsSigningSecretUnavailableError,
  signContinuation,
  verifyContinuation,
  type EntraClientContinuationPayload,
  type EntraContinuationSelection,
} from './continuation';

export const MAX_CLIENTS_IN_FLIGHT = 3;
/** Wall-clock budget for one continuation request before we yield. */
const REQUEST_BUDGET_MS = 20_000;
/** Page cap for the optional full-directory yield preview. */
const MAX_YIELD_PAGES = 8;

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

function directUsersRead(
  accessToken: string,
  path: string
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
    })
    .then((res) => ({
      status: res.status,
      requestId: res.headers?.['request-id'],
      clientRequestId: res.headers?.['client-request-id'] ?? clientRequestId,
      data: res.data,
    }));
}

async function runDirectClient(
  tenant: string,
  mapping: ConfirmedEntraMapping,
  boundClientId: string | null,
  includeUserYield: boolean
): Promise<{ result: EntraClientDiagnosticsResult; recommendations: DiagnosticsRecommendation[] }> {
  const steps: EntraDiagnosticsStep[] = [];
  const state: ClientMutableState = { category: 'ok', remedy: null, recommendations: [] };
  const portal = await loadMappingPortalConfig(tenant, mapping.managedTenantId);
  let accessToken: string | null = null;
  let firstUserId: string | null = null;
  let usersReadOk = false;
  let groupsTokenUsable = true;

  // 4.1 tenant_token_mint — customer context carries the mapped tenant and the
  // bound application so AADSTS65001 produces a real consent URL.
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
        entraTenantId: mapping.entraTenantId,
        tenant: claims?.tid,
        accessTokenFingerprint: buildTokenFingerprint(minted.accessToken),
        expiresAt: minted.expiresAt,
      },
    });
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
    steps.push({
      id: 'tenant_token_mint',
      title: 'Mint customer tenant token',
      status: 'fail',
      startedAt: new Date().toISOString(),
      durationMs: Date.now() - mintStarted,
      error: {
        message: classified.remedy,
        status: classified.httpStatus ?? undefined,
        oauthError: classified.oauthError ?? undefined,
        suberror: classified.suberror ?? undefined,
        aadstsCode: classified.aadstsCode ?? undefined,
        requestId: error?.requestId,
      },
      recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
    });
    applyClassification(state, classified);
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
      steps.push({
        id: 'users_read',
        title: 'Read directory users',
        status: 'fail',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - usersStarted,
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
      });
      applyClassification(state, classified);
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
      steps.push({
        id: 'groups_read',
        title: 'Read directory groups',
        status: 'fail',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - groupsStarted,
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
      });
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
        const rec: DiagnosticsRecommendation = {
          code: 'entitlement_group_not_security',
          severity: 'warn',
          text: 'The configured entitlement group is not a security group; membership may not be enforceable.',
          messageKey: 'entitlementGroupNotSecurity',
        };
        state.recommendations.push(rec);
        state.remedy = state.remedy ?? rec.text;
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
        const isMember =
          Array.isArray(res.data?.value) && res.data.value.includes(portal.entitlementGroupId);
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
    } catch (error: any) {
      if (error?.response?.status === 404) {
        const rec: DiagnosticsRecommendation = {
          code: 'entitlement_group_missing',
          severity: 'fail',
          text: 'The configured entitlement group no longer exists in this customer tenant.',
          messageKey: 'entitlementGroupMissing',
        };
        state.recommendations.push(rec);
        state.remedy = rec.text;
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
          message: error?.message,
          httpStatus: error?.response?.status,
          code: error?.code,
          responseBody: error?.response?.data,
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

  // 4.5 user_yield_preview — reuses provider normalization/paging through the
  // supplied-token seam, so realistic Graph rows are mapped correctly.
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
      const adapter = new DirectProviderAdapter();
      const { users, truncated } = await adapter.listUsersForTenantWithToken({
        tenant,
        managedTenantId: mapping.managedTenantId,
        accessToken,
        maxPages: MAX_YIELD_PAGES,
      });
      const filtered = await filterEntraUsersForTenant(tenant, users);
      const excluded = filtered.excluded.reduce<Record<string, number>>((acc, item) => {
        acc[item.reason] = (acc[item.reason] ?? 0) + 1;
        return acc;
      }, {});
      const allExcluded = users.length > 0 && filtered.included.length === 0;
      const recs: DiagnosticsRecommendation[] = [];
      if (allExcluded) {
        recs.push({
          code: 'all_users_excluded',
          severity: 'warn',
          text: 'Every user in this directory was excluded by the current filter rules; sync would create no contacts.',
          messageKey: 'allUsersExcluded',
        });
        state.remedy = state.remedy ?? recs[0].text;
        if (state.category === 'ok') state.category = 'other';
      }
      if (truncated) {
        recs.push({
          code: 'yield_truncated',
          severity: 'warn',
          text: `The yield preview stopped after ${MAX_YIELD_PAGES} pages because the directory is large. Counts are a lower bound, not the full directory.`,
          messageKey: 'yieldTruncated',
        });
        state.remedy = state.remedy ?? recs[0].text;
        if (state.category === 'ok') state.category = 'other';
      }
      state.recommendations.push(...recs);
      steps.push({
        id: 'user_yield_preview',
        title: 'User yield preview',
        status: allExcluded || truncated ? 'warn' : 'pass',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - yieldStart,
        data: {
          totalUsers: users.length,
          includedUsers: filtered.included.length,
          excludedUsers: filtered.excluded.length,
          excludedByReason: excluded,
          emptyDirectory: users.length === 0,
          truncated,
        },
        recommendations: recs,
      });
    } catch (error: any) {
      const classified = classifyEntraOAuthFailure({
        message: error?.message,
        httpStatus: error?.response?.status,
        code: error?.code,
        context: 'customer',
        customer: { entraTenantId: mapping.entraTenantId, operation: 'users' },
      });
      if (state.category === 'ok') applyClassification(state, classified);
      steps.push({
        id: 'user_yield_preview',
        title: 'User yield preview',
        status: 'fail',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - yieldStart,
        error: { message: classified.remedy },
        recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
      });
    }
  }

  const overallStatus = computeOverallStatus(steps);
  if (state.category === 'ok' && overallStatus !== 'pass') {
    state.category = 'other';
  }
  const isComplete = !steps.some(
    (step) => step.id === 'user_yield_preview' && (step.data as any)?.truncated === true
  );

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
      isComplete,
    },
    recommendations: state.recommendations,
  };
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
    let users: Awaited<ReturnType<CippProviderAdapter['listUsersForTenant']>> = [];
    let accessOk = false;
    try {
      users = await new CippProviderAdapter().listUsersForTenant({
        tenant,
        managedTenantId: mapping.entraTenantId,
      });
      accessOk = true;
      steps.push({
        id: 'per_tenant_users',
        title: 'CIPP per-tenant users',
        status: 'pass',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        http: { method: 'GET', path: '/api/listusers' },
        data: {
          sampledUserCount: users.length,
          sample: users.slice(0, 3).map((u) => ({ id: u.entraObjectId, upn: u.userPrincipalName })),
          bounded: true,
        },
      });
    } catch (error: any) {
      // CIPP failures use CIPP remedies (the API key), never a Microsoft GDAP role.
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
      state.recommendations.push(rec);
      state.remedy = rec.text;
      state.category = 'other';
      steps.push({
        id: 'per_tenant_users',
        title: 'CIPP per-tenant users',
        status: 'fail',
        startedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        error: { message: rec.text, code: error?.code },
        recommendations: [rec],
      });
    }

    // Yield is a separate step so its failure never contradicts the access read.
    if (!includeUserYield) {
      steps.push({
        id: 'user_yield_preview',
        title: 'User yield preview',
        status: 'skip',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        data: { reason: 'User yield preview is off.' },
      });
    } else if (!accessOk) {
      steps.push({
        id: 'user_yield_preview',
        title: 'User yield preview',
        status: 'skip',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        blockedBy: 'per_tenant_users',
      });
    } else {
      const yieldStart = Date.now();
      try {
        const filtered = await filterEntraUsersForTenant(tenant, users);
        const excluded = filtered.excluded.reduce<Record<string, number>>((acc, item) => {
          acc[item.reason] = (acc[item.reason] ?? 0) + 1;
          return acc;
        }, {});
        const allExcluded = users.length > 0 && filtered.included.length === 0;
        const recs: DiagnosticsRecommendation[] = [];
        if (allExcluded) {
          recs.push({
            code: 'all_users_excluded',
            severity: 'warn',
            text: 'Every user in this directory was excluded by the current filter rules; sync would create no contacts.',
            messageKey: 'allUsersExcluded',
          });
          state.remedy = state.remedy ?? recs[0].text;
          if (state.category === 'ok') state.category = 'other';
        }
        state.recommendations.push(...recs);
        steps.push({
          id: 'user_yield_preview',
          title: 'User yield preview',
          status: allExcluded ? 'warn' : 'pass',
          startedAt: new Date().toISOString(),
          durationMs: Date.now() - yieldStart,
          data: {
            totalUsers: users.length,
            includedUsers: filtered.included.length,
            excludedByReason: excluded,
            emptyDirectory: users.length === 0,
          },
          recommendations: recs,
        });
      } catch (error: any) {
        const rec: DiagnosticsRecommendation = {
          code: 'yield_failed',
          severity: 'warn',
          text: error?.message || 'The yield preview could not be computed.',
          messageKey: 'yieldFailed',
        };
        state.recommendations.push(rec);
        state.remedy = state.remedy ?? rec.text;
        if (state.category === 'ok') state.category = 'other';
        steps.push({
          id: 'user_yield_preview',
          title: 'User yield preview',
          status: 'warn',
          startedAt: new Date().toISOString(),
          durationMs: Date.now() - yieldStart,
          error: { message: rec.text },
          recommendations: [rec],
        });
      }
    }
  }

  const overallStatus = computeOverallStatus(steps);
  if (state.category === 'ok' && overallStatus !== 'pass') {
    state.category = 'other';
  }

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

function emptyContinuation(message: string, total = 0): EntraClientDiagnosticsContinuation {
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
    if ((payload.connectionId ?? null) !== (connection.connection_id ?? null)) {
      return emptyContinuation('The Entra connection was reconnected since this run started. Restart the run.');
    }
    // Revalidate every selected mapping's identity; a removed or changed
    // mapping must be surfaced, never silently skipped into a green run.
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
  let accumulated: EntraClientDiagnosticsResult[];

  if (payload) {
    selection = payload.selection;
    includeUserYield = payload.includeUserYield;
    offset = payload.offset;
    total = payload.total;
    accumulated = payload.results;
  } else {
    includeUserYield = input.includeUserYield ?? false;
    let chosen: ConfirmedEntraMapping[];
    if (input.clientIds === undefined) {
      chosen = allMappings;
    } else if (Array.isArray(input.clientIds)) {
      const unique = Array.from(new Set(input.clientIds));
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
    accumulated = [];
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

  const boundClientId =
    connection.connection_type === 'direct'
      ? (await resolveMicrosoftCredentialsForTenant(tenant))?.clientId ?? null
      : null;

  const deadline = Date.now() + REQUEST_BUDGET_MS;
  let cursor = offset;
  const batchResults: EntraClientDiagnosticsResult[] = [];

  while (cursor < selection.length && Date.now() < deadline) {
    const batch = selection.slice(cursor, cursor + MAX_CLIENTS_IN_FLIGHT);
    const settled = await Promise.all(
      batch.map(async (entry) => {
        const mapping = mappingByClientId.get(entry.clientId);
        if (!mapping) return null;
        return connection.connection_type === 'cipp'
          ? runCippClient(tenant, mapping, includeUserYield)
          : runDirectClient(tenant, mapping, boundClientId, includeUserYield);
      })
    );
    for (const outcome of settled) {
      if (!outcome) continue;
      batchResults.push(outcome.result);
    }
    cursor += batch.length;
    if (Date.now() >= deadline) break;
  }

  batchResults.sort(
    (a, b) => selection.findIndex((s) => s.clientId === a.clientId) - selection.findIndex((s) => s.clientId === b.clientId)
  );
  accumulated = [...accumulated, ...batchResults];
  const isDone = cursor >= total;

  const aggregate = aggregateClientCategories(accumulated.map((r) => r.category));
  const overallStatus = computeOverallStatus(
    accumulated.map((r) => ({ status: r.overallStatus }))
  );

  const expiresAt = Date.now() + DEFAULT_CONTINUATION_TTL_MS;
  let jobId = '';
  if (!isDone) {
    try {
      jobId = signContinuation({
        v: 1,
        tenant,
        userId,
        scope: 'clients',
        connectionType: connection.connection_type,
        connectionId: connection.connection_id ?? null,
        selection,
        includeUserYield,
        offset: cursor,
        total,
        results: accumulated,
        exp: expiresAt,
      });
    } catch (error) {
      if (error instanceof DiagnosticsSigningSecretUnavailableError) {
        return emptyContinuation(error.message, total);
      }
      throw error;
    }
  }

  const safeBatch = batchResults.map((r) => sanitizeClient(r, true));
  const safeAccumulated = accumulated.map((r) => sanitizeClient(r, true));

  return {
    jobId,
    scope: 'clients',
    total,
    completed: cursor,
    isDone,
    expiresAt: new Date(expiresAt).toISOString(),
    clients: safeBatch,
    aggregate,
    overallStatus,
    steps: [],
    recommendations: dedupeRecommendations(
      safeAccumulated.flatMap((r) => r.steps.flatMap((s) => s.recommendations ?? []))
    ),
  };
}
