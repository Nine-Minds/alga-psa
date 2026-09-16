import axios from 'axios';
import { randomUUID } from 'crypto';
import type {
  DiagnosticsRecommendation,
  EntraConnectionDiagnosticsOptions,
  EntraConnectionType,
  EntraDiagnosticsReport,
  EntraDiagnosticsSummary,
} from '@alga-psa/types';
import {
  buildTokenFingerprint,
  classifyGraphFailure,
  decodeJwtPayload,
} from '@alga-psa/shared/services/diagnostics';
import { getMicrosoftGraphBaseUrl } from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import { resolveEntraCallbackUrl } from '@alga-psa/shared/services/entra/entraCallbackUrl';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getAdminConnection } from '@alga-psa/db/admin';
import { tenantDb, createTenantKnex } from '@alga-psa/db';
import { getActiveEntraPartnerConnection } from '../connectionRepository';
import { refreshEntraDirectToken } from '../auth/refreshDirectToken';
import { ENTRA_DIRECT_DELEGATED_SCOPES } from '../auth/directScopes';
import { ENTRA_DIRECT_SECRET_KEYS } from '../secrets';
import {
  entraDirectProbeEndpoint,
  probeEntraDirectAccess,
  isSuccessfulEntraDirectProbe,
  type EntraDirectProbeResult,
} from '../providers/direct/directProbe';
import { createDirectProviderAdapter } from '../providers/direct/directProviderAdapter';
import { getEntraCippCredentials } from '../providers/cipp/cippSecretStore';
import { probeCippWithDetail } from './cippDiagnosticsProbe';
import { listConfirmedEntraMappings } from '../mapping/confirmedMappingsService';
import { getEntraSyncSchedule } from '../scheduleService';
import { getEntraSyncRunHistory, getEntraSyncRunProgress } from '../entraWorkflowClient';
import { classifyEntraOAuthFailure } from './oauthClassifier';
import { dedupeRecommendations } from './recommendations';
import { applyReportRedaction, createSupportBundle } from './redaction';
import { createEntraStepRunner } from './entraStepRunner';
import { probeTemporalReadiness, describeEntraSchedule } from './temporalReadiness';

function isEeEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

interface BindingInspection {
  outcome:
    | 'ok'
    | 'missing_binding'
    | 'missing_profile'
    | 'archived_profile'
    | 'missing_capability'
    | 'missing_client_id'
    | 'missing_secret';
  profileDisplayName: string | null;
  clientId: string | null;
  clientSecret: string | null;
  clientSecretRef: string | null;
  tenantId: string | null;
}

async function inspectBinding(tenant: string): Promise<BindingInspection> {
  const db = await getAdminConnection();
  const scoped = tenantDb(db, tenant);
  const binding = (await scoped
    .table('microsoft_profile_consumer_bindings')
    .where({ consumer_type: 'entra' })
    .first()) as { profile_id: string } | undefined;

  if (!binding) {
    return {
      outcome: 'missing_binding',
      profileDisplayName: null,
      clientId: null,
      clientSecret: null,
      clientSecretRef: null,
      tenantId: null,
    };
  }

  const profile = (await scoped
    .table('microsoft_profiles')
    .where({ profile_id: binding.profile_id })
    .first()) as
    | {
        display_name: string;
        client_id: string;
        tenant_id: string;
        client_secret_ref: string;
        capabilities: string[] | string | null;
        is_archived: boolean;
      }
    | undefined;

  if (!profile) {
    return {
      outcome: 'missing_profile',
      profileDisplayName: null,
      clientId: null,
      clientSecret: null,
      clientSecretRef: null,
      tenantId: null,
    };
  }

  const base = {
    profileDisplayName: profile.display_name || binding.profile_id,
    clientId: profile.client_id?.trim() || null,
    tenantId: profile.tenant_id?.trim() || null,
    clientSecretRef: profile.client_secret_ref?.trim() || null,
  };

  if (profile.is_archived) {
    return { ...base, outcome: 'archived_profile', clientSecret: null };
  }

  let capabilities: string[] = [];
  if (Array.isArray(profile.capabilities)) capabilities = profile.capabilities;
  else if (typeof profile.capabilities === 'string') {
    try {
      const parsed = JSON.parse(profile.capabilities);
      if (Array.isArray(parsed)) capabilities = parsed;
    } catch {
      capabilities = [];
    }
  }
  if (!capabilities.includes('entra')) {
    return { ...base, outcome: 'missing_capability', clientSecret: null };
  }

  if (!base.clientId) {
    return { ...base, outcome: 'missing_client_id', clientSecret: null };
  }

  let clientSecret: string | null = null;
  if (base.clientSecretRef) {
    const secretProvider = await getSecretProviderInstance();
    clientSecret = (await secretProvider.getTenantSecret(tenant, base.clientSecretRef)) ?? null;
  }
  if (!clientSecret) {
    return { ...base, outcome: 'missing_secret', clientSecret: null };
  }

  return { ...base, outcome: 'ok', clientSecret };
}

function expectedScopes(): string[] {
  return ENTRA_DIRECT_DELEGATED_SCOPES.filter((s) => s !== 'offline_access');
}

export async function runEntraConnectionDiagnostics(
  tenant: string,
  options: EntraConnectionDiagnosticsOptions = {}
): Promise<EntraDiagnosticsReport> {
  const includeIdentifiers = options.includeIdentifiers ?? true;
  const createdAt = new Date().toISOString();
  const recommendations: DiagnosticsRecommendation[] = [];
  const runner = createEntraStepRunner();
  const { runStep } = runner;

  const collect = (recs?: DiagnosticsRecommendation[]) => {
    if (recs) recommendations.push(...recs);
  };

  const connection = await getActiveEntraPartnerConnection(tenant);
  const connectionType: EntraConnectionType | null = connection?.connection_type ?? null;
  const isDirect = connectionType === 'direct';
  const isCipp = connectionType === 'cipp';

  // Layer 1.1 readiness: the route gate already enforced edition/tier/RBAC.
  await runStep(
    'edition_tier_rbac',
    'Edition, tier, and access readiness',
    {},
    async () => ({
      status: 'pass' as const,
      data: {
        edition: isEeEdition() ? 'enterprise' : 'community',
        integrationsTierGranted: true,
        entraSyncTierGranted: true,
        systemSettingsReadGranted: true,
        note: 'Access was verified by the Entra guard before diagnostics ran.',
      },
    })
  );

  // Layer 1.2 active connection row.
  await runStep('connection_row', 'Active Entra connection', {}, async () => {
    if (!connection) {
      collect([
        {
          code: 'connect_entra',
          severity: 'fail',
          text: 'Connect Microsoft Entra from Settings > Integrations > Entra.',
          messageKey: 'connectEntra',
        },
      ]);
      return {
        status: 'fail' as const,
        error: { message: 'No active Entra connection is configured for this workspace.' },
      };
    }
    const snapshot = connection.last_validation_error || {};
    return {
      status: 'pass' as const,
      data: {
        connectionType: connection.connection_type,
        status: connection.status,
        connectedAt: connection.connected_at,
        lastValidatedAt: connection.last_validated_at,
        storedValidationMessage: (snapshot as any)?.message ?? null,
        storedValidationCode: (snapshot as any)?.code ?? null,
        storedValidationCheckedAt: (snapshot as any)?.checkedAt ?? null,
      },
    };
  });

  // Layer 1.3 app registration binding (Direct only).
  let binding: BindingInspection | null = null;
  await runStep(
    'app_registration_binding',
    'Microsoft app registration binding',
    { requires: ['connection_row'] },
    async () => {
      if (!isDirect) {
        return {
          status: 'skip' as const,
          data: { reason: 'Not applicable to CIPP connections.' },
        };
      }
      binding = await inspectBinding(tenant);
      switch (binding.outcome) {
        case 'missing_binding':
          collect([
            {
              code: 'select_app_registration',
              severity: 'fail',
              text: 'Select a Microsoft app registration for Entra, then reconnect.',
              messageKey: 'selectAppRegistration',
            },
          ]);
          return {
            status: 'fail' as const,
            error: { message: 'No Microsoft app registration is bound to Entra.' },
          };
        case 'missing_profile':
          collect([
            {
              code: 'select_existing_app',
              severity: 'fail',
              text: 'The bound Microsoft app no longer exists. Select an existing app registration, then reconnect.',
              messageKey: 'selectExistingApp',
            },
          ]);
          return {
            status: 'fail' as const,
            error: { message: 'The bound Microsoft app registration could not be found.' },
          };
        case 'archived_profile':
          collect([
            {
              code: 'choose_another_app',
              severity: 'fail',
              text: 'The bound Microsoft app registration is archived. Choose another app registration, then reconnect.',
              messageKey: 'chooseAnotherApp',
            },
          ]);
          return {
            status: 'fail' as const,
            error: { message: `The bound app registration "${binding.profileDisplayName}" is archived.` },
          };
        case 'missing_capability':
          collect([
            {
              code: 'add_entra_capability',
              severity: 'fail',
              text: 'Edit the app registration in Settings > Integrations > Microsoft and enable the Entra capability.',
              messageKey: 'addEntraCapability',
            },
          ]);
          return {
            status: 'fail' as const,
            error: { message: 'The bound app registration does not have the Entra capability enabled.' },
          };
        case 'missing_client_id':
          return {
            status: 'fail' as const,
            error: { message: 'The bound app registration has no client id.' },
          };
        default:
          return {
            status: 'pass' as const,
            data: {
              profileName: binding.profileDisplayName,
              clientId: binding.clientId,
              tenantId: binding.tenantId,
            },
          };
      }
    }
  );

  // Layer 1.4 client secret presence (Direct only).
  await runStep(
    'client_secret_present',
    'App registration client secret',
    { requires: ['app_registration_binding'] },
    async () => {
      if (!isDirect) {
        return {
          status: 'skip' as const,
          data: { reason: 'Not applicable to CIPP connections.' },
        };
      }
      if (!binding || binding.outcome !== 'ok') {
        return {
          status: 'skip' as const,
          data: { reason: 'No usable app registration is bound.' },
        };
      }
      const fingerprint = buildTokenFingerprint(binding.clientSecret ?? undefined);
      collect([
        {
          code: 'secret_expiry_unknown',
          severity: 'info',
          text: 'Client secret expiry is unknown. Microsoft client secrets expire in 6-24 months; rotate on schedule in Azure.',
          messageKey: 'secretExpiryUnknown',
        },
      ]);
      return {
        status: 'pass' as const,
        data: {
          secretFingerprint: fingerprint,
          lastFour: binding.clientSecret ? binding.clientSecret.slice(-4) : null,
          expiry: 'unknown',
          expiryGuidance: 'Microsoft client secrets expire in 6-24 months.',
        },
      };
    }
  );

  // Layer 1.5 expected app registration values (informational).
  const secretProvider = await getSecretProviderInstance();
  const callbackUrl = await resolveEntraCallbackUrl(secretProvider);
  await runStep('expected_app_registration_values', 'Expected app registration values', {}, async () => ({
    status: 'pass' as const,
    data: {
      manualComparisonOnly: true,
      callbackUrl,
      delegatedScopes: expectedScopes(),
      offlineAccess: true,
      accountTypeRequirement: 'AzureADMultipleOrgs (multi-tenant)',
      boundClientId: binding?.clientId ?? null,
      note: isCipp
        ? 'Direct-connection expectations are not applicable to CIPP.'
        : 'Compare these values manually in the Azure app registration; Alga does not verify them.',
    },
  }));

  // Layer 1.6 sync worker and schedule (read-only, independent).
  await runStep('sync_worker_and_schedule', 'Sync worker and schedule', {}, async () => {
    const schedule = await getEntraSyncSchedule(tenant);
    const temporal = await probeTemporalReadiness();
    const describe = await describeEntraSchedule(tenant);

    const data: Record<string, unknown> = {
      syncEnabled: schedule.syncEnabled,
      syncIntervalMinutes: schedule.syncIntervalMinutes,
      settingsUpdatedAt: schedule.updatedAt,
      temporalReachable: temporal.reachable,
      temporalAddress: temporal.address,
      temporalNamespace: temporal.namespace,
      temporalTaskQueue: temporal.taskQueue,
      workerPollerEvidence: temporal.workerEvidence,
      scheduleNextFireTime: describe.nextFireTime,
      scheduleConfigured: describe.configured,
    };

    if (!temporal.reachable) {
      collect([
        {
          code: 'temporal_unreachable',
          severity: 'warn',
          text: 'The Temporal frontend could not be reached. Automatic sync and sync-triggered workflows will not run until it is available.',
          messageKey: 'temporalUnreachable',
        },
      ]);
      return { status: 'warn' as const, data };
    }

    if (!schedule.syncEnabled) {
      collect([
        {
          code: 'sync_disabled',
          severity: 'warn',
          text: 'Automatic Entra sync is turned off for this workspace.',
          messageKey: 'syncDisabled',
        },
      ]);
      return { status: 'warn' as const, data };
    }

    if (!describe.configured) {
      collect([
        {
          code: 'schedule_missing',
          severity: 'warn',
          text: 'Automatic sync is enabled but no Temporal schedule was found. Save the schedule to apply it.',
          messageKey: 'scheduleMissing',
        },
      ]);
      return { status: 'warn' as const, data };
    }

    return { status: 'pass' as const, data };
  });

  // Direct token layers 2 & 3.
  let refreshedAccessToken: string | null = null;
  await runStep(
    'token_set_present',
    'Stored Direct OAuth tokens',
    { requires: ['app_registration_binding'] },
    async () => {
      if (!isDirect) {
        return { status: 'skip' as const, data: { reason: 'Not a Direct connection.' } };
      }
      const sp = await getSecretProviderInstance();
      const accessToken = (await sp.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.accessToken)) ?? null;
      const refreshToken = (await sp.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.refreshToken)) ?? null;
      const expiresAt = (await sp.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt)) ?? null;

      const data = {
        accessTokenFingerprint: buildTokenFingerprint(accessToken),
        refreshTokenFingerprint: buildTokenFingerprint(refreshToken),
        accessTokenExpiresAt: expiresAt,
      };

      if (!refreshToken) {
        collect([
          {
            code: 'reconnect_entra',
            severity: 'fail',
            text: 'No refresh token is stored. Reconnect Microsoft Entra.',
            messageKey: 'reconnectEntra',
          },
        ]);
        return {
          status: 'fail' as const,
          data,
          error: { message: 'No Direct refresh token is stored for this workspace.' },
        };
      }
      if (!accessToken || !expiresAt) {
        return {
          status: 'warn' as const,
          data,
          error: { message: 'The access token is missing or has no expiry; attempting a refresh.' },
        };
      }
      return { status: 'pass' as const, data };
    }
  );

  await runStep(
    'token_refresh',
    'Refresh the partner access token',
    { requires: ['token_set_present'] },
    async () => {
      if (!isDirect) {
        return { status: 'skip' as const, data: { reason: 'Not a Direct connection.' } };
      }
      try {
        const refreshed = await refreshEntraDirectToken(tenant);
        refreshedAccessToken = refreshed.accessToken;
        return {
          status: 'pass' as const,
          data: {
            expiresAt: refreshed.expiresAt,
            scopesGranted: refreshed.scope ? refreshed.scope.split(' ') : null,
            accessTokenFingerprint: buildTokenFingerprint(refreshed.accessToken),
          },
        };
      } catch (error: any) {
        const classified = classifyEntraOAuthFailure({
          message: error?.message,
          context: 'partner',
        });
        collect([classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[]);
        return {
          status: 'fail' as const,
          error: {
            message: classified.remedy,
            aadstsCode: classified.aadstsCode ?? undefined,
            oauthError: classified.oauthError ?? undefined,
            suberror: classified.suberror ?? undefined,
          },
          recommendations: [classified.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
        };
      }
    }
  );

  await runStep(
    'token_claims',
    'Decode access token claims and scopes',
    { requires: ['token_refresh'] },
    async () => {
      if (!isDirect || !refreshedAccessToken) {
        return { status: 'skip' as const, data: { reason: 'No refreshed Direct token available.' } };
      }
      const payload = decodeJwtPayload(refreshedAccessToken);
      if (!payload) {
        return {
          status: 'warn' as const,
          data: { opaque: true },
          error: { message: 'The access token claims could not be decoded; treating them as opaque.' },
        };
      }
      const scp = typeof payload.scp === 'string' ? payload.scp.split(' ').filter(Boolean) : [];
      const required = expectedScopes().map((s) => s.replace('https://graph.microsoft.com/', ''));
      const missing = required.filter((s) => !scp.includes(s));
      const recs: DiagnosticsRecommendation[] = [];
      for (const scope of missing) {
        recs.push({
          code: `missing_scope_${scope}`,
          severity: 'warn',
          text: `The token is missing ${scope}. Grant admin consent, then reconnect Microsoft Entra.`,
          messageKey: 'missingScope',
          params: { scope },
        });
      }
      if (binding?.clientId && payload.appid && payload.appid !== binding.clientId) {
        const rec: DiagnosticsRecommendation = {
          code: 'app_client_id_mismatch',
          severity: 'fail',
          text: 'The token was issued to a different application than the bound app registration. Reconnect Microsoft Entra with the correct app.',
          messageKey: 'appClientIdMismatch',
          params: { expected: binding.clientId, actual: String(payload.appid) },
        };
        collect([rec]);
        return {
          status: 'fail' as const,
          data: { tid: payload.tid, appid: payload.appid, aud: payload.aud, scp },
          error: { message: rec.text },
          recommendations: [rec],
        };
      }
      collect(recs);
      return {
        status: missing.length ? ('warn' as const) : ('pass' as const),
        data: {
          tid: payload.tid,
          upn: payload.upn,
          preferredUsername: payload.preferred_username,
          appid: payload.appid,
          aud: payload.aud,
          expiresAt: payload.exp,
          scopes: scp,
          missingScopes: missing,
        },
        recommendations: recs,
      };
    }
  );

  await runStep(
    'graph_me',
    'Microsoft Graph /me baseline',
    { requires: ['token_refresh'] },
    async () => {
      if (!isDirect || !refreshedAccessToken) {
        return { status: 'skip' as const, data: { reason: 'No refreshed Direct token available.' } };
      }
      const clientRequestId = randomUUID();
      const res = await axios.get(`${getMicrosoftGraphBaseUrl()}/me`, {
        params: { $select: 'id,userPrincipalName' },
        headers: {
          Authorization: `Bearer ${refreshedAccessToken}`,
          'client-request-id': clientRequestId,
          'return-client-request-id': 'true',
        },
        timeout: 15000,
      });
      return {
        status: 'pass' as const,
        http: {
          method: 'GET',
          path: '/me?$select=id,userPrincipalName',
          status: res.status,
          requestId: res.headers?.['request-id'],
          clientRequestId: res.headers?.['client-request-id'] ?? clientRequestId,
        },
        data: {
          id: res.data?.id,
          userPrincipalName: res.data?.userPrincipalName,
        },
      };
    }
  );

  await runStep(
    'managed_tenants_endpoint',
    'Managed tenants endpoint reachability',
    { requires: ['token_refresh'] },
    async () => {
      if (!isDirect || !refreshedAccessToken) {
        return { status: 'skip' as const, data: { reason: 'No refreshed Direct token available.' } };
      }
      const probe = await probeEntraDirectAccess(refreshedAccessToken);
      const endpoint = entraDirectProbeEndpoint();
      if (isSuccessfulEntraDirectProbe(probe)) {
        return {
          status: 'pass' as const,
          http: { method: 'GET', path: endpoint, status: 200 },
          data: { endpoint, managedTenantSampleCount: probe.managedTenantSampleCount },
        };
      }
      const failedProbe = probe as Extract<EntraDirectProbeResult, { valid: false }>;
      const rec = classifyEntraOAuthFailure({
        httpStatus: failedProbe.status,
        code: failedProbe.code,
        message: failedProbe.error,
        context: 'partner',
      });
      collect([rec.recommendation].filter(Boolean) as DiagnosticsRecommendation[]);
      return {
        status: 'fail' as const,
        http: { method: 'GET', path: endpoint, status: failedProbe.status },
        error: {
          message:
            failedProbe.code === 'validation_failed' && failedProbe.status === 400
              ? 'Graph rejected the managedTenants request; this is an Alga-side endpoint fault. Contact support with the request id.'
              : failedProbe.error,
        },
        recommendations: [rec.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
      };
    }
  );

  let discoveredTenants: Array<{ entraTenantId: string; displayName: string | null }> = [];
  await runStep(
    'managed_tenants_count',
    'Managed tenants discovery',
    { requires: ['managed_tenants_endpoint'] },
    async () => {
      if (!isDirect) {
        return { status: 'skip' as const, data: { reason: 'Not a Direct connection.' } };
      }
      const adapter = createDirectProviderAdapter();
      const tenants = await adapter.listManagedTenants({ tenant });
      discoveredTenants = tenants.map((t) => ({
        entraTenantId: t.entraTenantId,
        displayName: t.displayName,
      }));
      const sample = discoveredTenants.slice(0, 10);
      if (discoveredTenants.length === 0) {
        collect([
          {
            code: 'no_managed_tenants',
            severity: 'warn',
            text: 'No managed tenants were returned. The partner must be onboarded to Microsoft 365 Lighthouse with active GDAP relationships; an un-onboarded partner can return no tenants regardless of app configuration.',
            messageKey: 'noManagedTenants',
          },
        ]);
        return {
          status: 'warn' as const,
          data: { count: 0, sample: [] },
        };
      }
      return {
        status: 'pass' as const,
        data: { count: discoveredTenants.length, sample },
      };
    }
  );

  await runStep(
    'mappings_vs_discovery',
    'Confirmed mappings versus live discovery',
    { requires: ['managed_tenants_count'] },
    async () => {
      if (!isDirect) {
        return { status: 'skip' as const, data: { reason: 'Not a Direct connection.' } };
      }
      const mappings = await listConfirmedEntraMappings(tenant);
      const discoveredIds = new Set(discoveredTenants.map((t) => t.entraTenantId));
      const missingMapped = mappings.filter((m) => !discoveredIds.has(m.entraTenantId));
      const mappedIds = new Set(mappings.map((m) => m.entraTenantId));
      const unmappedCount = discoveredTenants.filter((t) => !mappedIds.has(t.entraTenantId)).length;

      const recs: DiagnosticsRecommendation[] = missingMapped.map((m) => ({
        code: 'mapped_tenant_missing',
        severity: 'warn',
        text: `Mapped tenant "${m.clientName || m.displayName || m.entraTenantId}" was not returned by discovery. GDAP may have expired or been terminated.`,
        messageKey: 'mappedTenantMissing',
        params: { client: m.clientName || m.displayName || m.entraTenantId },
        action: includeIdentifiers
          ? undefined
          : undefined,
      }));
      collect(recs);
      return {
        status: missingMapped.length ? ('warn' as const) : ('pass' as const),
        data: {
          mappedClientCount: mappings.length,
          missingMappedTenants: missingMapped.map((m) => ({
            clientName: m.clientName,
            displayName: m.displayName,
            entraTenantId: m.entraTenantId,
          })),
          unmappedDiscoveryCount: unmappedCount,
        },
        recommendations: recs,
      };
    }
  );

  // CIPP layers C.1-C.5.
  await runStep(
    'cipp_credentials_present',
    'CIPP credentials',
    {},
    async () => {
      if (!isCipp) {
        return { status: 'skip' as const, data: { reason: 'Not a CIPP connection.' } };
      }
      const credentials = await getEntraCippCredentials(tenant);
      if (!credentials?.baseUrl || !credentials?.apiToken) {
        collect([
          {
            code: 'cipp_credentials_missing',
            severity: 'fail',
            text: 'CIPP base URL and API token are required. Configure them on the Connection tab.',
            messageKey: 'cippCredentialsMissing',
          },
        ]);
        return {
          status: 'fail' as const,
          error: { message: 'CIPP credentials are not configured.' },
        };
      }
      return {
        status: 'pass' as const,
        data: {
          baseUrl: credentials.baseUrl,
          apiTokenFingerprint: buildTokenFingerprint(credentials.apiToken),
        },
      };
    }
  );

  let cippTenants: Array<{ entraTenantId: string; displayName: string | null }> = [];
  await runStep(
    'cipp_reachable',
    'CIPP API reachability',
    { requires: ['cipp_credentials_present'] },
    async () => {
      if (!isCipp) {
        return { status: 'skip' as const, data: { reason: 'Not a CIPP connection.' } };
      }
      const credentials = await getEntraCippCredentials(tenant);
      if (!credentials) {
        return { status: 'skip' as const, data: { reason: 'No CIPP credentials.' } };
      }
      const probe = await probeCippWithDetail(credentials);
      if (probe.reachable && !probe.authRejected) {
        return {
          status: 'pass' as const,
          data: {
            attemptedEndpoints: probe.attempted,
            answeringEndpoint: probe.endpoint,
            status: probe.status,
            tenantCount: probe.tenantCount,
          },
        };
      }
      if (probe.authRejected) {
        // Reachable but rejected: attributed to cipp_auth, not duplicated here.
        return {
          status: 'warn' as const,
          data: {
            attemptedEndpoints: probe.attempted,
            answeringEndpoint: probe.endpoint,
            status: probe.status,
            reachable: true,
            note: 'Reachability proven; the credential was rejected and is reported by CIPP authentication.',
          },
        };
      }
      const rec = classifyEntraOAuthFailure({
        message: probe.error ?? 'CIPP unreachable',
        code: probe.networkCode,
        httpStatus: probe.status,
        context: 'partner',
      });
      collect([rec.recommendation].filter(Boolean) as DiagnosticsRecommendation[]);
      return {
        status: 'fail' as const,
        data: { attemptedEndpoints: probe.attempted, answeringEndpoint: probe.endpoint },
        error: { message: rec.remedy },
        recommendations: [rec.recommendation].filter(Boolean) as DiagnosticsRecommendation[],
      };
    }
  );

  await runStep('cipp_auth', 'CIPP API credential', { requires: ['cipp_reachable'] }, async () => {
    if (!isCipp) {
      return { status: 'skip' as const, data: { reason: 'Not a CIPP connection.' } };
    }
    const credentials = await getEntraCippCredentials(tenant);
    if (!credentials) {
      return { status: 'skip' as const, data: { reason: 'No CIPP credentials.' } };
    }
    const probe = await probeCippWithDetail(credentials);
    if (probe.authRejected) {
      const rec: DiagnosticsRecommendation = {
        code: 'cipp_auth_rejected',
        severity: 'fail',
        text: 'CIPP rejected the API credential. Rotate it from the Connection tab. This is the CIPP API key from Settings > CIPP > API access in CIPP itself, not an Azure client secret.',
        messageKey: 'cippAuthRejected',
      };
      collect([rec]);
      return {
        status: 'fail' as const,
        error: { message: rec.text, status: probe.status },
        recommendations: [rec],
      };
    }
    return { status: 'pass' as const, data: { status: probe.status } };
  });

  await runStep(
    'cipp_tenant_list',
    'CIPP tenant list',
    { requires: ['cipp_auth'] },
    async () => {
      if (!isCipp) {
        return { status: 'skip' as const, data: { reason: 'Not a CIPP connection.' } };
      }
      const credentials = await getEntraCippCredentials(tenant);
      if (!credentials) {
        return { status: 'skip' as const, data: { reason: 'No CIPP credentials.' } };
      }
      const probe = await probeCippWithDetail(credentials);
      cippTenants = probe.tenants;
      if (cippTenants.length === 0) {
        collect([
          {
            code: 'cipp_empty_tenant_list',
            severity: 'warn',
            text: 'CIPP returned no tenants. Check CIPP customer visibility and configuration.',
            messageKey: 'cippEmptyTenantList',
          },
        ]);
        return { status: 'warn' as const, data: { count: 0, sample: [] } };
      }
      return {
        status: 'pass' as const,
        data: { count: cippTenants.length, sample: cippTenants.slice(0, 10) },
      };
    }
  );

  await runStep(
    'cipp_mappings_vs_list',
    'Confirmed mappings versus CIPP tenant list',
    { requires: ['cipp_tenant_list'] },
    async () => {
      if (!isCipp) {
        return { status: 'skip' as const, data: { reason: 'Not a CIPP connection.' } };
      }
      const mappings = await listConfirmedEntraMappings(tenant);
      const discoveredIds = new Set(cippTenants.map((t) => t.entraTenantId));
      const missingMapped = mappings.filter((m) => !discoveredIds.has(m.entraTenantId));
      const mappedIds = new Set(mappings.map((m) => m.entraTenantId));
      const unmappedCount = cippTenants.filter((t) => !mappedIds.has(t.entraTenantId)).length;
      const recs: DiagnosticsRecommendation[] = missingMapped.map((m) => ({
        code: 'mapped_tenant_missing',
        severity: 'warn',
        text: `Mapped tenant "${m.clientName || m.displayName || m.entraTenantId}" was not returned by CIPP.`,
        messageKey: 'mappedTenantMissing',
        params: { client: m.clientName || m.displayName || m.entraTenantId },
      }));
      collect(recs);
      return {
        status: missingMapped.length ? ('warn' as const) : ('pass' as const),
        data: {
          mappedClientCount: mappings.length,
          missingMappedTenants: missingMapped.map((m) => ({
            clientName: m.clientName,
            displayName: m.displayName,
            entraTenantId: m.entraTenantId,
          })),
          unmappedDiscoveryCount: unmappedCount,
        },
        recommendations: recs,
      };
    }
  );

  // Layer 5 sync pipeline health (always runs).
  let latestRealRunId: string | null = null;
  await runStep('last_runs', 'Recent sync runs', {}, async () => {
    const history = await getEntraSyncRunHistory(tenant, 5);
    const runs = history.map((run) => ({
      runId: run.runId,
      status: run.status,
      trigger: run.isDryRun ? 'preflight' : run.runType,
      isDryRun: run.isDryRun,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs:
        run.completedAt && run.startedAt
          ? Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt))
          : null,
      totalTenants: run.totalTenants,
      succeededTenants: run.succeededTenants,
      failedTenants: run.failedTenants,
    }));

    latestRealRunId = history.find((r) => !r.isDryRun)?.runId ?? null;

    const realRuns = history.filter((r) => !r.isDryRun);
    const isUnsuccessful = (status: string) => status === 'failed' || status === 'partial';
    const twoConsecutive =
      realRuns.length >= 2 &&
      isUnsuccessful(realRuns[0]?.status ?? '') &&
      isUnsuccessful(realRuns[1]?.status ?? '');

    if (twoConsecutive) {
      collect([
        {
          code: 'consecutive_sync_failures',
          severity: 'warn',
          text: 'The last two syncs did not complete successfully. Review the sync history and per-tenant errors.',
          messageKey: 'consecutiveSyncFailures',
        },
      ]);
      return { status: 'warn' as const, data: { runs } };
    }
    if (runs.length === 0) {
      return { status: 'pass' as const, data: { runs: [], noRuns: true } };
    }
    return { status: 'pass' as const, data: { runs } };
  });

  await runStep('per_tenant_last_result', 'Per-tenant result of the latest sync', {}, async () => {
    if (!latestRealRunId) {
      return { status: 'pass' as const, data: { tenants: [], noRun: true } };
    }
    const progress = await getEntraSyncRunProgress(tenant, latestRealRunId);
    const failed = progress.tenantResults.filter((t) => t.status === 'failed' || t.status === 'partial');
    return {
      status: failed.length ? ('warn' as const) : ('pass' as const),
      data: {
        runId: latestRealRunId,
        failedTenants: failed.map((t) => ({
          managedTenantId: t.managedTenantId,
          clientId: t.clientId,
          status: t.status,
          errorMessage: t.errorMessage,
          completedAt: t.completedAt,
        })),
      },
    };
  });

  await runStep('reconciliation_queue', 'Reconciliation queue', {}, async () => {
    const { knex } = await createTenantKnex();
    const row = (await tenantDb(knex, tenant)
      .table('entra_contact_reconciliation_queue')
      .where({ status: 'open' })
      .count({ count: '*' })
      .min({ oldest: 'created_at' })
      .first()) as { count?: string | number; oldest?: string | Date | null } | undefined;

    const openCount = Number(row?.count ?? 0);
    const oldest = row?.oldest
      ? row.oldest instanceof Date
        ? row.oldest.toISOString()
        : String(row.oldest)
      : null;

    if (openCount > 0) {
      collect([
        {
          code: 'reconciliation_open_items',
          severity: 'warn',
          text: `Review queue has ${openCount} item(s) waiting; ambiguous matches are never auto-linked.`,
          messageKey: 'reconciliationOpenItems',
          params: { count: openCount },
        },
      ]);
      return {
        status: 'warn' as const,
        data: { openCount, oldestCreatedAt: oldest },
      };
    }
    return { status: 'pass' as const, data: { openCount: 0, oldestCreatedAt: null } };
  });

  const summary = buildSummary(runner.steps, connection, connectionType, binding);
  const dedupedRecommendations = dedupeRecommendations(recommendations);

  const report: EntraDiagnosticsReport = {
    createdAt,
    scope: 'connection',
    summary,
    steps: runner.steps,
    clients: [],
    recommendations: dedupedRecommendations,
    supportBundle: {},
  };

  const redactedReport = applyReportRedaction(report, includeIdentifiers);
  // Support exports are always identifier-redacted by default; an operator can
  // opt into identifiers through the export control in the dialog. Tokens and
  // secrets are never present regardless.
  const supportBundle = createSupportBundle(report, false);
  return { ...redactedReport, supportBundle };
}

function buildSummary(
  steps: ReturnType<typeof createEntraStepRunner>['steps'],
  connection: Awaited<ReturnType<typeof getActiveEntraPartnerConnection>>,
  connectionType: EntraConnectionType | null,
  binding: BindingInspection | null
): EntraDiagnosticsSummary {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const discovery = byId.get('managed_tenants_count')?.data as
    | { count?: number }
    | undefined;
  const mappings = byId.get('mappings_vs_discovery')?.data as
    | { mappedClientCount?: number }
    | undefined;
  const cippMappings = byId.get('cipp_mappings_vs_list')?.data as
    | { mappedClientCount?: number }
    | undefined;
  const overall: EntraDiagnosticsSummary['overallStatus'] = steps.some((s) => s.status === 'fail')
    ? 'fail'
    : steps.some((s) => s.status === 'warn')
      ? 'warn'
      : 'pass';

  return {
    connectionType,
    connectionStatus: connection?.status ?? null,
    profileName: binding?.profileDisplayName ?? null,
    partnerTenantId: connection?.connection_type === 'direct' ? (binding?.tenantId ?? null) : null,
    authenticatedUpn:
      (byId.get('token_claims')?.data as any)?.preferredUsername ??
      (byId.get('token_claims')?.data as any)?.upn ??
      (byId.get('graph_me')?.data as any)?.userPrincipalName ??
      null,
    tokenExpiresAt: (byId.get('token_refresh')?.data as any)?.expiresAt ?? null,
    managedTenantCount: discovery?.count ?? null,
    mappedClientCount: mappings?.mappedClientCount ?? cippMappings?.mappedClientCount ?? null,
    overallStatus: overall,
  };
}
