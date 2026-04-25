'use server';

import { randomUUID } from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import {
  getMicrosoftProfileReadiness,
  type ProviderReadinessResult,
} from './providerReadiness';
import {
  getVisibleMicrosoftConsumerTypes,
  isMicrosoftConsumerEnterpriseEdition,
  isVisibleMicrosoftConsumerType,
} from '../../lib/microsoftConsumerVisibility';
import {
  MICROSOFT_PROFILE_CONSUMERS,
  type MicrosoftProfileConsumer,
} from './microsoftShared';
import { resolveMicrosoftBindingCandidateProfile } from '../../lib/microsoftConsumerProfileResolution';

const MICROSOFT_CLIENT_ID_SECRET = 'microsoft_client_id';
const MICROSOFT_CLIENT_SECRET_SECRET = 'microsoft_client_secret';
const MICROSOFT_TENANT_ID_SECRET = 'microsoft_tenant_id';
const DEFAULT_MICROSOFT_PROFILE_NAME = 'Default Microsoft Profile';

interface MicrosoftProfileRow {
  tenant: string;
  profile_id: string;
  display_name: string;
  display_name_normalized: string;
  client_id: string;
  tenant_id: string;
  client_secret_ref: string;
  is_default: boolean;
  is_archived: boolean;
  archived_at: string | Date | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface MicrosoftConsumerBindingRow {
  tenant: string;
  consumer_type: MicrosoftProfileConsumer;
  profile_id: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface TeamsIntegrationSelectionRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: 'not_configured' | 'install_pending' | 'active' | 'error';
  app_id?: string | null;
  bot_id?: string | null;
  package_metadata?: Record<string, unknown> | null;
  last_error?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface MicrosoftProfileSummary {
  profileId: string;
  displayName: string;
  clientId?: string;
  tenantId: string;
  clientSecretMasked?: string;
  clientSecretConfigured: boolean;
  clientSecretRef: string;
  isDefault: boolean;
  isArchived: boolean;
  readiness: ProviderReadinessResult;
  status: 'ready' | 'incomplete' | 'archived';
  archivedAt?: string | null;
  consumers: string[];
}

export interface MicrosoftConsumerBindingSummary {
  consumerType: MicrosoftProfileConsumer;
  consumerLabel: string;
  profileId?: string | null;
  profileDisplayName?: string;
  isArchived: boolean;
}

export interface MicrosoftConsumerSetupStatusResponse {
  success: boolean;
  error?: string;
  consumerType?: MicrosoftProfileConsumer;
  consumerLabel?: string;
  visible?: boolean;
  ready?: boolean;
  profileId?: string | null;
  profileDisplayName?: string;
  message?: string;
}

export interface MicrosoftProfileStatusResponse {
  success: boolean;
  error?: string;
  baseUrl?: string;
  redirectUris?: {
    sso: string;
    email?: string;
    calendar?: string;
    teamsTab?: string;
    teamsBot?: string;
    teamsMessageExtension?: string;
  };
  scopes?: { sso: string[]; email?: string[]; calendar?: string[]; teams?: string[] };
  config?: {
    clientId?: string;
    clientSecretMasked?: string;
    tenantId: string;
    ready: boolean;
  };
  profiles?: MicrosoftProfileSummary[];
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function computeBaseUrl(envValue?: string | null): string {
  const raw = (envValue || '').trim();
  if (!raw) return 'http://localhost:3000';

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return 'http://localhost:3000';
  }
}

async function getDeploymentBaseUrl(): Promise<string> {
  const secretProvider = await getSecretProviderInstance();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';

  return computeBaseUrl(base);
}

function normalizeMicrosoftClientId(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function normalizeTenantId(value?: string | null): string {
  const normalized = (value || '').trim();
  return normalized || 'common';
}

function normalizeDisplayName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDisplayNameKey(value: string): string {
  return normalizeDisplayName(value).toLocaleLowerCase();
}

function isSupportedMicrosoftProfileConsumer(value: string): value is MicrosoftProfileConsumer {
  return (MICROSOFT_PROFILE_CONSUMERS as readonly string[]).includes(value);
}

function getMicrosoftConsumerLabel(consumer: MicrosoftProfileConsumer): string {
  switch (consumer) {
    case 'msp_sso':
      return 'MSP SSO';
    case 'email':
      return 'Email';
    case 'calendar':
      return 'Calendar';
    case 'teams':
      return 'Teams';
  }
}

function getMicrosoftProfileSecretRef(profileId: string): string {
  return `microsoft_profile_${profileId}_client_secret`;
}

function formatConsumerLabels(labels: string[]): string {
  if (labels.length === 0) {
    return '';
  }
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function buildMicrosoftProfileInUseError(
  operation: 'archived' | 'deleted',
  consumerLabels: string[]
): string {
  const action =
    consumerLabels.length === 1 && consumerLabels[0] === 'Teams'
      ? 'until Teams is rebound or deactivated'
      : 'until those bindings are changed';

  return `Microsoft profile is still bound to ${formatConsumerLabels(consumerLabels)} and cannot be ${operation} ${action}`;
}

function isClientPortalUser(user: any): boolean {
  return user?.user_type === 'client';
}

async function canManageMicrosoftSettings(user: any): Promise<boolean> {
  return hasPermission(user as any, 'system_settings', 'update');
}

async function getTenantMicrosoftProfiles(knex: any, tenant: string): Promise<MicrosoftProfileRow[]> {
  const rows = await knex('microsoft_profiles').where({ tenant }).select('*');
  return [...rows].sort((left: MicrosoftProfileRow, right: MicrosoftProfileRow) => {
    if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
    if (left.is_archived !== right.is_archived) return left.is_archived ? 1 : -1;
    return left.display_name.localeCompare(right.display_name);
  });
}

async function getMicrosoftProfileRow(
  knex: any,
  tenant: string,
  profileId: string
): Promise<MicrosoftProfileRow | undefined> {
  const row = await knex('microsoft_profiles').where({ tenant, profile_id: profileId }).first();
  return row || undefined;
}

async function getTenantMicrosoftConsumerBindings(
  knex: any,
  tenant: string
): Promise<MicrosoftConsumerBindingRow[]> {
  const rows = await knex('microsoft_profile_consumer_bindings').where({ tenant }).select('*');
  return rows as MicrosoftConsumerBindingRow[];
}

async function getMicrosoftConsumerBindingRow(
  knex: any,
  tenant: string,
  consumerType: MicrosoftProfileConsumer
): Promise<MicrosoftConsumerBindingRow | undefined> {
  const row = await knex('microsoft_profile_consumer_bindings')
    .where({ tenant, consumer_type: consumerType })
    .first();

  return row || undefined;
}

async function getTeamsIntegrationSelectionRow(
  knex: any,
  tenant: string,
  profileId: string
): Promise<TeamsIntegrationSelectionRow | undefined> {
  const row = await knex('teams_integrations')
    .where({ tenant, selected_profile_id: profileId })
    .first();

  return row || undefined;
}

async function listBlockingMicrosoftProfileConsumers(
  knex: any,
  tenant: string,
  profileId: string
): Promise<string[]> {
  const labels = new Set<string>();
  const visibleConsumers = new Set(getVisibleMicrosoftConsumerTypes());
  const bindings = await knex('microsoft_profile_consumer_bindings')
    .where({ tenant, profile_id: profileId })
    .select('*');

  for (const binding of bindings as MicrosoftConsumerBindingRow[]) {
    if (!visibleConsumers.has(binding.consumer_type)) {
      continue;
    }
    labels.add(getMicrosoftConsumerLabel(binding.consumer_type));
  }

  const teamsIntegration = await getTeamsIntegrationSelectionRow(knex, tenant, profileId);
  if (teamsIntegration && teamsIntegration.install_status !== 'not_configured') {
    labels.add('Teams');
  }

  return [...labels].sort((left, right) => left.localeCompare(right));
}

async function clearInactiveTeamsProfileSelection(
  knex: any,
  tenant: string,
  profileId: string,
  userId?: string | null
): Promise<void> {
  const teamsIntegration = await getTeamsIntegrationSelectionRow(knex, tenant, profileId);
  if (!teamsIntegration || teamsIntegration.install_status !== 'not_configured') {
    return;
  }

  await knex('teams_integrations')
    .where({ tenant, selected_profile_id: profileId })
    .update({
      selected_profile_id: null,
      app_id: null,
      bot_id: null,
      package_metadata: null,
      last_error: null,
      updated_by: userId || null,
      updated_at: new Date(),
    });
}

async function syncTeamsIntegrationBinding(
  knex: any,
  tenant: string,
  profileId: string,
  userId?: string | null
): Promise<void> {
  const existing = await knex('teams_integrations').where({ tenant }).first();
  if (!existing) {
    return;
  }

  const currentSelection = existing.selected_profile_id || null;
  if (currentSelection === profileId) {
    return;
  }

  const selectedProfileChanged = Boolean(currentSelection) && currentSelection !== profileId;
  const nextInstallStatus =
    selectedProfileChanged && existing.install_status !== 'not_configured'
      ? 'install_pending'
      : existing.install_status;

  await knex('teams_integrations')
    .where({ tenant })
    .update({
      selected_profile_id: profileId,
      install_status: nextInstallStatus,
      app_id: selectedProfileChanged ? null : existing.app_id ?? null,
      bot_id: selectedProfileChanged ? null : existing.bot_id ?? null,
      package_metadata: selectedProfileChanged ? null : existing.package_metadata ?? null,
      last_error: selectedProfileChanged ? null : existing.last_error ?? null,
      updated_by: userId || null,
      updated_at: new Date(),
    });
}

function hasLegacyMicrosoftConfig(values: {
  clientId?: string | null;
  clientSecret?: string | null;
  tenantId?: string | null;
}): boolean {
  return Boolean(
    (values.clientId || '').trim() ||
    (values.clientSecret || '').trim() ||
    (values.tenantId || '').trim()
  );
}

async function mirrorLegacyMicrosoftSecrets(
  tenant: string,
  row: Pick<MicrosoftProfileRow, 'client_id' | 'tenant_id' | 'client_secret_ref'>,
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>
): Promise<void> {
  const clientSecret = await secretProvider.getTenantSecret(tenant, row.client_secret_ref);

  await secretProvider.setTenantSecret(tenant, MICROSOFT_CLIENT_ID_SECRET, row.client_id || null);
  await secretProvider.setTenantSecret(tenant, MICROSOFT_TENANT_ID_SECRET, normalizeTenantId(row.tenant_id));
  await secretProvider.setTenantSecret(tenant, MICROSOFT_CLIENT_SECRET_SECRET, (clientSecret || '').trim() || null);
}

async function ensureLegacyMicrosoftProfileBackfill(
  knex: any,
  tenant: string,
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>,
  userId?: string | null
): Promise<void> {
  const existing = await getTenantMicrosoftProfiles(knex, tenant);
  if (existing.length > 0) {
    return;
  }

  const [legacyClientId, legacyClientSecret, legacyTenantId] = await Promise.all([
    secretProvider.getTenantSecret(tenant, MICROSOFT_CLIENT_ID_SECRET),
    secretProvider.getTenantSecret(tenant, MICROSOFT_CLIENT_SECRET_SECRET),
    secretProvider.getTenantSecret(tenant, MICROSOFT_TENANT_ID_SECRET),
  ]);

  if (!hasLegacyMicrosoftConfig({
    clientId: legacyClientId,
    clientSecret: legacyClientSecret,
    tenantId: legacyTenantId,
  })) {
    return;
  }

  const profileId = randomUUID();
  const clientSecretRef = getMicrosoftProfileSecretRef(profileId);
  const row: MicrosoftProfileRow = {
    tenant,
    profile_id: profileId,
    display_name: DEFAULT_MICROSOFT_PROFILE_NAME,
    display_name_normalized: normalizeDisplayNameKey(DEFAULT_MICROSOFT_PROFILE_NAME),
    client_id: normalizeMicrosoftClientId(legacyClientId || ''),
    tenant_id: normalizeTenantId(legacyTenantId),
    client_secret_ref: clientSecretRef,
    is_default: true,
    is_archived: false,
    archived_at: null,
    created_by: userId || null,
    updated_by: userId || null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  await knex('microsoft_profiles').insert(row);

  if ((legacyClientSecret || '').trim()) {
    await secretProvider.setTenantSecret(tenant, clientSecretRef, legacyClientSecret || null);
  }

  await mirrorLegacyMicrosoftSecrets(tenant, row, secretProvider);
}

async function tenantHasLegacyMspSsoUsage(knex: any, tenant: string): Promise<boolean> {
  const activeDomain = await knex('msp_sso_tenant_login_domains')
    .where({ tenant, is_active: true })
    .first();

  return Boolean(activeDomain);
}

async function tenantHasLegacyMicrosoftEmailUsage(knex: any, tenant: string): Promise<boolean> {
  const provider = await knex('email_providers')
    .where({ tenant, provider_type: 'microsoft' })
    .first();

  return Boolean(provider);
}

async function tenantHasLegacyMicrosoftEmailClientCredentials(
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>,
  tenant: string
): Promise<boolean> {
  const [clientId, clientSecret] = await Promise.all([
    secretProvider.getTenantSecret(tenant, MICROSOFT_CLIENT_ID_SECRET),
    secretProvider.getTenantSecret(tenant, MICROSOFT_CLIENT_SECRET_SECRET),
  ]);

  return Boolean((clientId || '').trim() && (clientSecret || '').trim());
}

async function tenantHasLegacyMicrosoftCalendarUsage(knex: any, tenant: string): Promise<boolean> {
  const provider = await knex('calendar_providers')
    .where({ tenant, provider_type: 'microsoft' })
    .first();

  return Boolean(provider);
}

async function ensureMicrosoftConsumerBindingMigration(
  knex: any,
  tenant: string,
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>,
  userId?: string | null
): Promise<MicrosoftConsumerBindingRow[]> {
  await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, userId);

  const candidateProfile = await resolveMicrosoftBindingCandidateProfile(knex, tenant, secretProvider);
  if (!candidateProfile) {
    return [];
  }

  const existingBindings = await getTenantMicrosoftConsumerBindings(knex, tenant);
  const now = new Date();
  const visibleConsumers = new Set(getVisibleMicrosoftConsumerTypes());
  const missingConsumers = new Set(
    MICROSOFT_PROFILE_CONSUMERS.filter(
      (consumerType) =>
        visibleConsumers.has(consumerType) &&
        !existingBindings.some((row) => row.consumer_type === consumerType)
    )
  );

  if (missingConsumers.size === 0) {
    return existingBindings;
  }

  const [shouldBackfillMspSso, hasLegacyEmailUsage, hasLegacyEmailClientCredentials, shouldBackfillCalendar] = await Promise.all([
    missingConsumers.has('msp_sso') ? tenantHasLegacyMspSsoUsage(knex, tenant) : false,
    missingConsumers.has('email') ? tenantHasLegacyMicrosoftEmailUsage(knex, tenant) : false,
    missingConsumers.has('email') ? tenantHasLegacyMicrosoftEmailClientCredentials(secretProvider, tenant) : false,
    missingConsumers.has('calendar') ? tenantHasLegacyMicrosoftCalendarUsage(knex, tenant) : false,
  ]);
  const shouldBackfillEmail = hasLegacyEmailUsage && hasLegacyEmailClientCredentials;

  const consumersToBackfill: MicrosoftProfileConsumer[] = [];

  if (shouldBackfillMspSso) {
    consumersToBackfill.push('msp_sso');
  }
  if (shouldBackfillEmail) {
    consumersToBackfill.push('email');
  }
  if (shouldBackfillCalendar) {
    consumersToBackfill.push('calendar');
  }

  for (const consumerType of consumersToBackfill) {
    const binding: MicrosoftConsumerBindingRow = {
      tenant,
      consumer_type: consumerType,
      profile_id: candidateProfile.profile_id,
      created_by: userId || null,
      updated_by: userId || null,
      created_at: now,
      updated_at: now,
    };

    await knex('microsoft_profile_consumer_bindings').insert(binding);
    existingBindings.push(binding);
  }

  return existingBindings;
}

function getVisibleConsumerLabels(
  consumerLabels: string[],
  isEnterpriseEdition = isMicrosoftConsumerEnterpriseEdition()
): string[] {
  const visibleConsumers = new Set(getVisibleMicrosoftConsumerTypes(isEnterpriseEdition));

  return consumerLabels.filter((label) => {
    if (label === 'MSP SSO') {
      return visibleConsumers.has('msp_sso');
    }
    if (label === 'Email') {
      return visibleConsumers.has('email');
    }
    if (label === 'Calendar') {
      return visibleConsumers.has('calendar');
    }
    if (label === 'Teams') {
      return visibleConsumers.has('teams');
    }

    return false;
  });
}

function getDuplicateProfileName(
  rows: MicrosoftProfileRow[],
  displayName: string,
  ignoreProfileId?: string
): MicrosoftProfileRow | undefined {
  const normalized = normalizeDisplayNameKey(displayName);
  return rows.find((row) =>
    !row.is_archived &&
    row.display_name_normalized === normalized &&
    row.profile_id !== ignoreProfileId
  );
}

function getMicrosoftIntegrationMetadata(baseUrl: string): NonNullable<
  Pick<MicrosoftProfileStatusResponse, 'redirectUris' | 'scopes'>
> {
  return {
    redirectUris: {
      email: `${baseUrl}/api/auth/microsoft/callback`,
      calendar: `${baseUrl}/api/auth/microsoft/calendar/callback`,
      sso: `${baseUrl}/api/auth/callback/azure-ad`,
      teamsTab: `${baseUrl}/api/teams/auth/callback/tab`,
      teamsBot: `${baseUrl}/api/teams/auth/callback/bot`,
      teamsMessageExtension: `${baseUrl}/api/teams/auth/callback/message-extension`,
    },
    scopes: {
      email: [
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/Mail.ReadWrite',
        'https://graph.microsoft.com/Mail.Send',
        'offline_access',
        'openid',
        'profile',
        'email',
      ],
      calendar: [
        'https://graph.microsoft.com/Calendars.ReadWrite',
        'https://graph.microsoft.com/Mail.Read',
        'offline_access',
      ],
      sso: ['openid', 'profile', 'email'],
      teams: ['openid', 'profile', 'email', 'offline_access'],
    },
  };
}

function getVisibleMicrosoftIntegrationMetadata(
  baseUrl: string,
  isEnterpriseEdition = isMicrosoftConsumerEnterpriseEdition()
): NonNullable<Pick<MicrosoftProfileStatusResponse, 'redirectUris' | 'scopes'>> {
  const metadata = getMicrosoftIntegrationMetadata(baseUrl);
  const redirectUris = metadata.redirectUris!;
  const scopes = metadata.scopes!;
  const visibleConsumers = new Set(getVisibleMicrosoftConsumerTypes(isEnterpriseEdition));

  return {
    redirectUris: {
      sso: redirectUris.sso,
      ...(visibleConsumers.has('email') ? { email: redirectUris.email } : {}),
      ...(visibleConsumers.has('calendar') ? { calendar: redirectUris.calendar } : {}),
      ...(visibleConsumers.has('teams')
        ? {
            teamsTab: redirectUris.teamsTab,
            teamsBot: redirectUris.teamsBot,
            teamsMessageExtension: redirectUris.teamsMessageExtension,
          }
        : {}),
    },
    scopes: {
      sso: scopes.sso,
      ...(visibleConsumers.has('email') ? { email: scopes.email } : {}),
      ...(visibleConsumers.has('calendar') ? { calendar: scopes.calendar } : {}),
      ...(visibleConsumers.has('teams') ? { teams: scopes.teams } : {}),
    },
  };
}

async function buildMicrosoftProfileSummary(
  tenant: string,
  row: MicrosoftProfileRow,
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>,
  consumerLabels: string[] = []
): Promise<MicrosoftProfileSummary> {
  const [clientSecret, readiness] = await Promise.all([
    secretProvider.getTenantSecret(tenant, row.client_secret_ref),
    getMicrosoftProfileReadiness(tenant, {
      clientId: row.client_id,
      tenantId: row.tenant_id,
      clientSecretRef: row.client_secret_ref,
      isArchived: row.is_archived,
    }),
  ]);

  return {
    profileId: row.profile_id,
    displayName: row.display_name,
    clientId: row.client_id || undefined,
    tenantId: normalizeTenantId(row.tenant_id),
    clientSecretMasked: clientSecret ? maskSecret(clientSecret) : undefined,
    clientSecretConfigured: readiness.clientSecretConfigured,
    clientSecretRef: row.client_secret_ref,
    isDefault: row.is_default,
    isArchived: row.is_archived,
    readiness,
    status: row.is_archived ? 'archived' : readiness.ready ? 'ready' : 'incomplete',
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    consumers: consumerLabels,
  };
}

async function listMicrosoftProfilesForTenant(
  tenant: string,
  userId?: string | null
): Promise<MicrosoftProfileSummary[]> {
  const { knex } = await createTenantKnex();
  const secretProvider = await getSecretProviderInstance();

  await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, userId);

  const rows = await getTenantMicrosoftProfiles(knex, tenant);
  const bindings = await ensureMicrosoftConsumerBindingMigration(knex, tenant, secretProvider, userId);

  return Promise.all(rows.map((row) => {
    const consumerLabels = bindings
      .filter((binding) => binding.profile_id === row.profile_id)
      .map((binding) => getMicrosoftConsumerLabel(binding.consumer_type));

    return buildMicrosoftProfileSummary(tenant, row, secretProvider, consumerLabels);
  }));
}

async function resolveDefaultMicrosoftProfileRow(
  tenant: string,
  userId?: string | null
): Promise<MicrosoftProfileRow | undefined> {
  const { knex } = await createTenantKnex();
  const secretProvider = await getSecretProviderInstance();

  await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, userId);

  const rows = await getTenantMicrosoftProfiles(knex, tenant);
  return rows.find((row) => row.is_default && !row.is_archived) || rows.find((row) => !row.is_archived);
}

async function createMicrosoftProfileInternal(
  user: any,
  tenant: string,
  input: {
    displayName: string;
    clientId: string;
    clientSecret: string;
    tenantId?: string;
    setAsDefault?: boolean;
  }
): Promise<{ success: boolean; error?: string; profile?: MicrosoftProfileSummary }> {
  if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };

  const displayName = normalizeDisplayName(input.displayName || '');
  const clientId = normalizeMicrosoftClientId(input.clientId || '');
  const clientSecret = (input.clientSecret || '').trim();
  const tenantId = normalizeTenantId(input.tenantId);
  const tenantIdProvided = Boolean((input.tenantId || '').trim());

  if (!displayName) return { success: false, error: 'Microsoft profile display name is required' };
  if (!clientId) return { success: false, error: 'Microsoft OAuth Client ID is required' };
  if (!clientSecret) return { success: false, error: 'Microsoft OAuth Client Secret is required' };
  if (!tenantIdProvided) return { success: false, error: 'Microsoft Tenant ID is required' };

  try {
    const { knex } = await createTenantKnex();
    const secretProvider = await getSecretProviderInstance();

    await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, user?.user_id);

    const existing = await getTenantMicrosoftProfiles(knex, tenant);
    if (getDuplicateProfileName(existing, displayName)) {
      return { success: false, error: 'A Microsoft profile with this display name already exists' };
    }

    const profileId = randomUUID();
    const clientSecretRef = getMicrosoftProfileSecretRef(profileId);
    const shouldBeDefault = input.setAsDefault === true || !existing.some((row) => row.is_default && !row.is_archived);
    const now = new Date();

    const row: MicrosoftProfileRow = {
      tenant,
      profile_id: profileId,
      display_name: displayName,
      display_name_normalized: normalizeDisplayNameKey(displayName),
      client_id: clientId,
      tenant_id: tenantId,
      client_secret_ref: clientSecretRef,
      is_default: shouldBeDefault,
      is_archived: false,
      archived_at: null,
      created_by: user?.user_id || null,
      updated_by: user?.user_id || null,
      created_at: now,
      updated_at: now,
    };

    await knex.transaction(async (trx: any) => {
      if (shouldBeDefault) {
        await trx('microsoft_profiles').where({ tenant, is_default: true }).update({
          is_default: false,
          updated_by: user?.user_id || null,
          updated_at: now,
        });
      }

      await trx('microsoft_profiles').insert(row);
    });

    await secretProvider.setTenantSecret(tenant, clientSecretRef, clientSecret);
    if (shouldBeDefault) {
      await mirrorLegacyMicrosoftSecrets(tenant, row, secretProvider);
    }

    return {
      success: true,
      profile: await buildMicrosoftProfileSummary(tenant, row, secretProvider),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to create Microsoft profile' };
  }
}

async function updateMicrosoftProfileInternal(
  user: any,
  tenant: string,
  input: {
    profileId: string;
    displayName?: string;
    clientId?: string;
    clientSecret?: string;
    tenantId?: string;
  }
): Promise<{ success: boolean; error?: string; profile?: MicrosoftProfileSummary }> {
  if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };

  if (!input.profileId) return { success: false, error: 'Microsoft profile ID is required' };

  try {
    const { knex } = await createTenantKnex();
    const secretProvider = await getSecretProviderInstance();

    await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, user?.user_id);

    const existing = await getMicrosoftProfileRow(knex, tenant, input.profileId);
    if (!existing) return { success: false, error: 'Microsoft profile not found' };

    const nextDisplayName = input.displayName === undefined
      ? existing.display_name
      : normalizeDisplayName(input.displayName);
    const nextClientId = input.clientId === undefined
      ? existing.client_id
      : normalizeMicrosoftClientId(input.clientId);
    const nextTenantId = input.tenantId === undefined
      ? normalizeTenantId(existing.tenant_id)
      : normalizeTenantId(input.tenantId);
    const nextClientSecret = input.clientSecret === undefined ? undefined : (input.clientSecret || '').trim();

    if (!nextDisplayName) return { success: false, error: 'Microsoft profile display name is required' };
    if (!nextClientId) return { success: false, error: 'Microsoft OAuth Client ID is required' };
    if (!nextTenantId) return { success: false, error: 'Microsoft Tenant ID is required' };

    const allRows = await getTenantMicrosoftProfiles(knex, tenant);
    if (getDuplicateProfileName(allRows, nextDisplayName, existing.profile_id)) {
      return { success: false, error: 'A Microsoft profile with this display name already exists' };
    }

    const now = new Date();
    await knex('microsoft_profiles')
      .where({ tenant, profile_id: existing.profile_id })
      .update({
        display_name: nextDisplayName,
        display_name_normalized: normalizeDisplayNameKey(nextDisplayName),
        client_id: nextClientId,
        tenant_id: nextTenantId,
        updated_by: user?.user_id || null,
        updated_at: now,
      });

    if (nextClientSecret !== undefined && nextClientSecret) {
      await secretProvider.setTenantSecret(tenant, existing.client_secret_ref, nextClientSecret);
    }

    const updated = await getMicrosoftProfileRow(knex, tenant, existing.profile_id);
    if (!updated) return { success: false, error: 'Microsoft profile not found after update' };

    if (updated.is_default && !updated.is_archived) {
      await mirrorLegacyMicrosoftSecrets(tenant, updated, secretProvider);
    }

    return {
      success: true,
      profile: await buildMicrosoftProfileSummary(tenant, updated, secretProvider),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to update Microsoft profile' };
  }
}

async function archiveMicrosoftProfileInternal(
  user: any,
  tenant: string,
  profileId: string
): Promise<{ success: boolean; error?: string }> {
  if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };
  if (!profileId) return { success: false, error: 'Microsoft profile ID is required' };

  try {
    const { knex } = await createTenantKnex();
    const secretProvider = await getSecretProviderInstance();

    await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, user?.user_id);
    await ensureMicrosoftConsumerBindingMigration(knex, tenant, secretProvider, user?.user_id);

    const existing = await getMicrosoftProfileRow(knex, tenant, profileId);
    if (!existing) return { success: false, error: 'Microsoft profile not found' };
    if (existing.is_default) {
      return { success: false, error: 'Default Microsoft profile cannot be archived until another profile is default' };
    }
    const blockingConsumers = await listBlockingMicrosoftProfileConsumers(knex, tenant, profileId);
    if (blockingConsumers.length > 0) {
      return {
        success: false,
        error: buildMicrosoftProfileInUseError('archived', blockingConsumers),
      };
    }

    await knex('microsoft_profiles')
      .where({ tenant, profile_id: profileId })
      .update({
        is_archived: true,
        archived_at: new Date(),
        updated_by: user?.user_id || null,
        updated_at: new Date(),
      });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to archive Microsoft profile' };
  }
}

async function deleteMicrosoftProfileInternal(
  user: any,
  tenant: string,
  profileId: string
): Promise<{ success: boolean; error?: string }> {
  if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };
  if (!profileId) return { success: false, error: 'Microsoft profile ID is required' };

  try {
    const { knex } = await createTenantKnex();
    const secretProvider = await getSecretProviderInstance();

    await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, user?.user_id);
    await ensureMicrosoftConsumerBindingMigration(knex, tenant, secretProvider, user?.user_id);

    const existing = await getMicrosoftProfileRow(knex, tenant, profileId);
    if (!existing) return { success: false, error: 'Microsoft profile not found' };
    if (existing.is_default) {
      return { success: false, error: 'Default Microsoft profile cannot be deleted until another profile is default' };
    }

    const blockingConsumers = await listBlockingMicrosoftProfileConsumers(knex, tenant, profileId);
    if (blockingConsumers.length > 0) {
      return {
        success: false,
        error: buildMicrosoftProfileInUseError('deleted', blockingConsumers),
      };
    }

    await clearInactiveTeamsProfileSelection(knex, tenant, profileId, user?.user_id);

    await knex('microsoft_profiles')
      .where({ tenant, profile_id: profileId })
      .delete();

    await secretProvider.setTenantSecret(tenant, existing.client_secret_ref, null);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete Microsoft profile' };
  }
}

async function setDefaultMicrosoftProfileInternal(
  user: any,
  tenant: string,
  profileId: string
): Promise<{ success: boolean; error?: string; profile?: MicrosoftProfileSummary }> {
  if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };
  if (!profileId) return { success: false, error: 'Microsoft profile ID is required' };

  try {
    const { knex } = await createTenantKnex();
    const secretProvider = await getSecretProviderInstance();

    await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, user?.user_id);

    const existing = await getMicrosoftProfileRow(knex, tenant, profileId);
    if (!existing) return { success: false, error: 'Microsoft profile not found' };
    if (existing.is_archived) return { success: false, error: 'Archived Microsoft profiles cannot be set as default' };

    const now = new Date();
    await knex.transaction(async (trx: any) => {
      await trx('microsoft_profiles').where({ tenant, is_default: true }).update({
        is_default: false,
        updated_by: user?.user_id || null,
        updated_at: now,
      });

      await trx('microsoft_profiles').where({ tenant, profile_id: profileId }).update({
        is_default: true,
        updated_by: user?.user_id || null,
        updated_at: now,
      });
    });

    const updated = await getMicrosoftProfileRow(knex, tenant, profileId);
    if (!updated) return { success: false, error: 'Microsoft profile not found after update' };

    await mirrorLegacyMicrosoftSecrets(tenant, updated, secretProvider);

    return {
      success: true,
      profile: await buildMicrosoftProfileSummary(tenant, updated, secretProvider),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to set default Microsoft profile' };
  }
}

export const listMicrosoftProfiles = withAuth(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string; profiles?: MicrosoftProfileSummary[] }> => {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };

    return {
      success: true,
      profiles: await listMicrosoftProfilesForTenant(tenant, (user as any)?.user_id),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to list Microsoft profiles' };
  }
});

export const createMicrosoftProfile = withAuth(async (user, { tenant }, input: {
  displayName: string;
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  setAsDefault?: boolean;
}) => createMicrosoftProfileInternal(user, tenant, input));

export const updateMicrosoftProfile = withAuth(async (user, { tenant }, input: {
  profileId: string;
  displayName?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
}) => updateMicrosoftProfileInternal(user, tenant, input));

export const archiveMicrosoftProfile = withAuth(async (user, { tenant }, profileId: string) =>
  archiveMicrosoftProfileInternal(user, tenant, profileId)
);

export const deleteMicrosoftProfile = withAuth(async (user, { tenant }, profileId: string) =>
  deleteMicrosoftProfileInternal(user, tenant, profileId)
);

export const setDefaultMicrosoftProfile = withAuth(async (user, { tenant }, profileId: string) =>
  setDefaultMicrosoftProfileInternal(user, tenant, profileId)
);

export const listMicrosoftConsumerBindings = withAuth(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string; bindings?: MicrosoftConsumerBindingSummary[] }> => {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };

    const { knex } = await createTenantKnex();
    const secretProvider = await getSecretProviderInstance();
    const visibleConsumers = getVisibleMicrosoftConsumerTypes();

    await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, (user as any)?.user_id);
    const bindings = await ensureMicrosoftConsumerBindingMigration(knex, tenant, secretProvider, (user as any)?.user_id);
    const profiles = await getTenantMicrosoftProfiles(knex, tenant);
    const bindingByConsumer = new Map(bindings.map((binding) => [binding.consumer_type, binding]));

    return {
      success: true,
      bindings: visibleConsumers.map((consumerType) => {
        const binding = bindingByConsumer.get(consumerType);
        const profile = binding ? profiles.find((row) => row.profile_id === binding.profile_id) : undefined;
        return {
          consumerType,
          consumerLabel: getMicrosoftConsumerLabel(consumerType),
          profileId: binding?.profile_id ?? null,
          profileDisplayName: profile?.display_name,
          isArchived: Boolean(profile?.is_archived),
        };
      }),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to list Microsoft consumer bindings' };
  }
});

export const setMicrosoftConsumerBinding = withAuth(async (
  user,
  { tenant },
  input: {
    consumerType: MicrosoftProfileConsumer;
    profileId: string;
  }
): Promise<{ success: boolean; error?: string; binding?: MicrosoftConsumerBindingSummary }> => {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };

    if (!isSupportedMicrosoftProfileConsumer(input.consumerType)) {
      return { success: false, error: 'Unsupported Microsoft consumer type' };
    }
    if (!isVisibleMicrosoftConsumerType(input.consumerType)) {
      return { success: false, error: 'Microsoft consumer type is unavailable in this edition' };
    }
    if (!input.profileId) {
      return { success: false, error: 'Microsoft profile ID is required' };
    }

    const { knex } = await createTenantKnex();
    const secretProvider = await getSecretProviderInstance();

    await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider, (user as any)?.user_id);

    const profile = await getMicrosoftProfileRow(knex, tenant, input.profileId);
    if (!profile) {
      return { success: false, error: 'Microsoft profile not found' };
    }
    if (profile.is_archived) {
      return { success: false, error: 'Archived Microsoft profiles cannot be bound to consumers' };
    }

    const existing = await getMicrosoftConsumerBindingRow(knex, tenant, input.consumerType);
    const now = new Date();

    if (existing) {
      await knex('microsoft_profile_consumer_bindings')
        .where({ tenant, consumer_type: input.consumerType })
        .update({
          profile_id: input.profileId,
          updated_by: (user as any)?.user_id || null,
          updated_at: now,
        });
    } else {
      const binding: MicrosoftConsumerBindingRow = {
        tenant,
        consumer_type: input.consumerType,
        profile_id: input.profileId,
        created_by: (user as any)?.user_id || null,
        updated_by: (user as any)?.user_id || null,
        created_at: now,
        updated_at: now,
      };

      await knex('microsoft_profile_consumer_bindings').insert(binding);
    }

    if (input.consumerType === 'teams') {
      await syncTeamsIntegrationBinding(knex, tenant, input.profileId, (user as any)?.user_id);
    }

    return {
      success: true,
      binding: {
        consumerType: input.consumerType,
        consumerLabel: getMicrosoftConsumerLabel(input.consumerType),
        profileId: input.profileId,
        profileDisplayName: profile.display_name,
        isArchived: false,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to save Microsoft consumer binding' };
  }
});

export const resolveMicrosoftProfileForConsumer = async (
  tenant: string,
  consumerType: string
): Promise<MicrosoftProfileSummary | null> => {
  if (!isSupportedMicrosoftProfileConsumer(consumerType)) {
    return null;
  }

  const { knex } = await createTenantKnex();
  const secretProvider = await getSecretProviderInstance();

  await ensureLegacyMicrosoftProfileBackfill(knex, tenant, secretProvider);
  const bindings = await ensureMicrosoftConsumerBindingMigration(knex, tenant, secretProvider);
  const binding = bindings.find((row) => row.consumer_type === consumerType);

  if (binding) {
    const row = await getMicrosoftProfileRow(knex, tenant, binding.profile_id);
    if (row && !row.is_archived) {
      return buildMicrosoftProfileSummary(tenant, row, secretProvider, [getMicrosoftConsumerLabel(consumerType)]);
    }
  }

  return null;
};

export const getMicrosoftConsumerSetupStatus = withAuth(async (
  user,
  { tenant },
  consumerType: MicrosoftProfileConsumer
): Promise<MicrosoftConsumerSetupStatusResponse> => {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };

    if (!isSupportedMicrosoftProfileConsumer(consumerType)) {
      return { success: false, error: 'Unsupported Microsoft consumer type' };
    }

    const consumerLabel = getMicrosoftConsumerLabel(consumerType);
    if (!isVisibleMicrosoftConsumerType(consumerType)) {
      return {
        success: true,
        consumerType,
        consumerLabel,
        visible: false,
        ready: false,
        message: `${consumerLabel} is only available in Enterprise Edition.`,
      };
    }

    const profile = await resolveMicrosoftProfileForConsumer(tenant, consumerType);
    if (!profile) {
      return {
        success: true,
        consumerType,
        consumerLabel,
        visible: true,
        ready: false,
        message: `No Microsoft profile is currently bound to ${consumerLabel}.`,
      };
    }

    const ready = profile.readiness.ready;
    return {
      success: true,
      consumerType,
      consumerLabel,
      visible: true,
      ready,
      profileId: profile.profileId,
      profileDisplayName: profile.displayName,
      message: ready
        ? undefined
        : `${consumerLabel} is bound to ${profile.displayName}, but that profile still needs configuration.`,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load Microsoft consumer setup status' };
  }
});

export const getMicrosoftIntegrationStatus = withAuth(async (
  user,
  { tenant }
): Promise<MicrosoftProfileStatusResponse> => {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };

    const profiles = await listMicrosoftProfilesForTenant(tenant, (user as any)?.user_id);
    const baseUrl = await getDeploymentBaseUrl();
    const metadata = getVisibleMicrosoftIntegrationMetadata(baseUrl);
    const mspSsoProfile = await resolveMicrosoftProfileForConsumer(tenant, 'msp_sso');
    const visibleProfiles = profiles.map((profile) => ({
      ...profile,
      consumers: getVisibleConsumerLabels(profile.consumers),
    }));

    return {
      success: true,
      baseUrl,
      redirectUris: metadata.redirectUris,
      scopes: metadata.scopes,
      config: {
        clientId: mspSsoProfile?.clientId,
        clientSecretMasked: mspSsoProfile?.clientSecretMasked,
        tenantId: mspSsoProfile?.tenantId || 'common',
        ready: mspSsoProfile?.readiness.ready || false,
      },
      profiles: visibleProfiles,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load Microsoft integration status' };
  }
});

export const saveMicrosoftIntegrationSettings = withAuth(async (
  user,
  { tenant },
  input: {
    clientId: string;
    clientSecret: string;
    tenantId?: string;
  }
): Promise<{ success: boolean; error?: string }> => {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };

    const clientId = normalizeMicrosoftClientId(input.clientId ?? '');
    if (!clientId) return { success: false, error: 'Microsoft OAuth Client ID is required' };

    const clientSecret = (input.clientSecret || '').trim();
    if (!clientSecret) return { success: false, error: 'Microsoft OAuth Client Secret is required' };

    const tenantId = normalizeTenantId(input.tenantId);

    const existingDefault = await resolveDefaultMicrosoftProfileRow(tenant, (user as any)?.user_id);

    if (existingDefault) {
      const result = await updateMicrosoftProfileInternal(user, tenant, {
        profileId: existingDefault.profile_id,
        clientId,
        clientSecret,
        tenantId,
      });

      return result.success ? { success: true } : { success: false, error: result.error };
    }

    const result = await createMicrosoftProfileInternal(user, tenant, {
      displayName: DEFAULT_MICROSOFT_PROFILE_NAME,
      clientId,
      clientSecret,
      tenantId,
      setAsDefault: true,
    });

    return result.success ? { success: true } : { success: false, error: result.error };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to save Microsoft integration settings' };
  }
});

export const resetMicrosoftProvidersToDisconnected = withAuth(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string }> => {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };

    const permitted = await hasPermission(user as any, 'system_settings', 'update');
    if (!permitted) return { success: false, error: 'Forbidden' };

    const { knex } = await createTenantKnex();

    await knex('email_providers')
      .where({ tenant, provider_type: 'microsoft' })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    await knex('microsoft_email_provider_config')
      .where({ tenant })
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        webhook_subscription_id: null,
        webhook_verification_token: null,
        webhook_expires_at: null,
        last_subscription_renewal: null,
        updated_at: knex.fn.now(),
      });

    await knex('calendar_providers')
      .where({ tenant, provider_type: 'microsoft' })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    await knex('microsoft_calendar_provider_config')
      .where({ tenant })
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        webhook_subscription_id: null,
        webhook_expires_at: null,
        webhook_notification_url: null,
        webhook_verification_token: null,
        delta_link: null,
        updated_at: knex.fn.now(),
      });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to reset Microsoft providers' };
  }
});
