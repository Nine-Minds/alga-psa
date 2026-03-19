import { randomUUID } from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getAdminConnection } from '@alga-psa/db/admin';

// Kept local to @alga-psa/auth to avoid a package cycle through @alga-psa/integrations.
const MICROSOFT_PROFILE_CONSUMERS = ['msp_sso', 'email', 'calendar', 'teams'] as const;

type MicrosoftProfileConsumer = typeof MICROSOFT_PROFILE_CONSUMERS[number];

const LEGACY_MICROSOFT_CLIENT_ID_SECRET = 'microsoft_client_id';
const LEGACY_MICROSOFT_CLIENT_SECRET_SECRET = 'microsoft_client_secret';
const LEGACY_MICROSOFT_TENANT_ID_SECRET = 'microsoft_tenant_id';
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

type ResolverStatus = 'ready' | 'not_configured' | 'invalid_profile';

export interface MicrosoftConsumerProfileResolution {
  status: ResolverStatus;
  tenantId: string;
  consumerType: MicrosoftProfileConsumer;
  profileId?: string;
  clientId?: string;
  clientSecret?: string;
  microsoftTenantId?: string;
  message?: string;
}

function normalizeTenantId(value?: string | null): string {
  return (value || '').trim() || 'common';
}

function normalizeDisplayNameKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
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

function isConfigured(value?: string | null): boolean {
  return Boolean((value || '').trim());
}

async function getLegacyMicrosoftConfig(
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>,
  tenant: string
): Promise<{ clientId: string; clientSecret: string; tenantId: string }> {
  const [clientId, clientSecret, tenantId] = await Promise.all([
    secretProvider.getTenantSecret(tenant, LEGACY_MICROSOFT_CLIENT_ID_SECRET),
    secretProvider.getTenantSecret(tenant, LEGACY_MICROSOFT_CLIENT_SECRET_SECRET),
    secretProvider.getTenantSecret(tenant, LEGACY_MICROSOFT_TENANT_ID_SECRET),
  ]);

  return {
    clientId: (clientId || '').trim(),
    clientSecret: (clientSecret || '').trim(),
    tenantId: normalizeTenantId(tenantId),
  };
}

function getMicrosoftProfileSecretRef(profileId: string): string {
  return `microsoft_profile_${profileId}_client_secret`;
}

function getConsumerLabel(consumerType: MicrosoftProfileConsumer): string {
  switch (consumerType) {
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

async function getTenantMicrosoftProfiles(db: any, tenant: string): Promise<MicrosoftProfileRow[]> {
  const rows = (await db('microsoft_profiles').where({ tenant }).select('*')) as MicrosoftProfileRow[];
  return [...rows].sort((left, right) => {
    if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
    if (left.is_archived !== right.is_archived) return left.is_archived ? 1 : -1;
    return left.display_name.localeCompare(right.display_name);
  });
}

async function getMicrosoftConsumerBindingRow(
  db: any,
  tenant: string,
  consumerType: MicrosoftProfileConsumer
): Promise<MicrosoftConsumerBindingRow | undefined> {
  const row = await db('microsoft_profile_consumer_bindings')
    .where({ tenant, consumer_type: consumerType })
    .first();

  return row || undefined;
}

async function getMicrosoftProfileRow(
  db: any,
  tenant: string,
  profileId: string
): Promise<MicrosoftProfileRow | undefined> {
  const row = await db('microsoft_profiles').where({ tenant, profile_id: profileId }).first();
  return row || undefined;
}

async function resolveMicrosoftBindingCandidateProfile(
  db: any,
  tenant: string,
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>
): Promise<MicrosoftProfileRow | undefined> {
  const activeProfiles = (await getTenantMicrosoftProfiles(db, tenant)).filter(
    (profile) => !profile.is_archived
  );

  if (activeProfiles.length === 0) {
    return undefined;
  }

  if (activeProfiles.length === 1) {
    return activeProfiles[0];
  }

  const legacyConfig = await getLegacyMicrosoftConfig(secretProvider, tenant);
  if (
    !hasLegacyMicrosoftConfig({
      clientId: legacyConfig.clientId,
      clientSecret: legacyConfig.clientSecret,
      tenantId: legacyConfig.tenantId,
    })
  ) {
    return undefined;
  }

  const matches: MicrosoftProfileRow[] = [];
  for (const profile of activeProfiles) {
    if (legacyConfig.clientId && profile.client_id.trim() !== legacyConfig.clientId) {
      continue;
    }
    if (
      legacyConfig.tenantId &&
      normalizeTenantId(profile.tenant_id) !== normalizeTenantId(legacyConfig.tenantId)
    ) {
      continue;
    }

    if (legacyConfig.clientSecret) {
      const profileSecret = await secretProvider.getTenantSecret(tenant, profile.client_secret_ref);
      if ((profileSecret || '').trim() !== legacyConfig.clientSecret) {
        continue;
      }
    }

    matches.push(profile);
  }

  return matches.length === 1 ? matches[0] : undefined;
}

async function ensureLegacyMicrosoftProfileBackfill(
  db: any,
  tenant: string,
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>
): Promise<void> {
  const existing = await getTenantMicrosoftProfiles(db, tenant);
  if (existing.length > 0) {
    return;
  }

  const [legacyClientId, legacyClientSecret, legacyTenantId] = await Promise.all([
    secretProvider.getTenantSecret(tenant, LEGACY_MICROSOFT_CLIENT_ID_SECRET),
    secretProvider.getTenantSecret(tenant, LEGACY_MICROSOFT_CLIENT_SECRET_SECRET),
    secretProvider.getTenantSecret(tenant, LEGACY_MICROSOFT_TENANT_ID_SECRET),
  ]);

  if (
    !hasLegacyMicrosoftConfig({
      clientId: legacyClientId,
      clientSecret: legacyClientSecret,
      tenantId: legacyTenantId,
    })
  ) {
    return;
  }

  const profileId = randomUUID();
  const clientSecretRef = getMicrosoftProfileSecretRef(profileId);
  const now = new Date();

  await db('microsoft_profiles').insert({
    tenant,
    profile_id: profileId,
    display_name: DEFAULT_MICROSOFT_PROFILE_NAME,
    display_name_normalized: normalizeDisplayNameKey(DEFAULT_MICROSOFT_PROFILE_NAME),
    client_id: (legacyClientId || '').trim(),
    tenant_id: normalizeTenantId(legacyTenantId),
    client_secret_ref: clientSecretRef,
    is_default: true,
    is_archived: false,
    archived_at: null,
    created_by: null,
    updated_by: null,
    created_at: now,
    updated_at: now,
  } satisfies MicrosoftProfileRow);

  if ((legacyClientSecret || '').trim()) {
    await secretProvider.setTenantSecret(tenant, clientSecretRef, legacyClientSecret || null);
  }
}

async function tenantHasLegacyUsage(
  db: any,
  tenant: string,
  consumerType: MicrosoftProfileConsumer
): Promise<boolean> {
  if (consumerType === 'msp_sso') {
    const activeDomain = await db('msp_sso_tenant_login_domains')
      .where({ tenant, is_active: true })
      .first();
    return Boolean(activeDomain);
  }

  if (consumerType === 'email') {
    const provider = await db('email_providers')
      .where({ tenant, provider_type: 'microsoft' })
      .first();
    return Boolean(provider);
  }

  if (consumerType === 'calendar') {
    const provider = await db('calendar_providers')
      .where({ tenant, provider_type: 'microsoft' })
      .first();
    return Boolean(provider);
  }

  return false;
}

async function ensureMicrosoftConsumerBindingMigration(
  db: any,
  tenant: string,
  consumerType: MicrosoftProfileConsumer,
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>
): Promise<MicrosoftConsumerBindingRow | undefined> {
  await ensureLegacyMicrosoftProfileBackfill(db, tenant, secretProvider);

  const existing = await getMicrosoftConsumerBindingRow(db, tenant, consumerType);
  if (existing) {
    return existing;
  }

  if (consumerType === 'teams') {
    return undefined;
  }

  const candidateProfile = await resolveMicrosoftBindingCandidateProfile(db, tenant, secretProvider);
  if (!candidateProfile) {
    return undefined;
  }

  const shouldBackfill = await tenantHasLegacyUsage(db, tenant, consumerType);
  if (!shouldBackfill) {
    return undefined;
  }

  const binding: MicrosoftConsumerBindingRow = {
    tenant,
    consumer_type: consumerType,
    profile_id: candidateProfile.profile_id,
    created_by: null,
    updated_by: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  await db('microsoft_profile_consumer_bindings').insert(binding);
  return binding;
}

export async function resolveMicrosoftConsumerProfileConfig(
  tenantId: string,
  consumerType: MicrosoftProfileConsumer
): Promise<MicrosoftConsumerProfileResolution> {
  if (!(MICROSOFT_PROFILE_CONSUMERS as readonly string[]).includes(consumerType)) {
    return {
      status: 'not_configured',
      tenantId,
      consumerType,
      message: 'Unsupported Microsoft consumer type',
    };
  }

  const db = await getAdminConnection();
  const secretProvider = await getSecretProviderInstance();
  const binding = await ensureMicrosoftConsumerBindingMigration(db, tenantId, consumerType, secretProvider);

  if (!binding) {
    return {
      status: 'not_configured',
      tenantId,
      consumerType,
      message: `${getConsumerLabel(consumerType)} Microsoft profile binding is not configured`,
    };
  }

  const profile = await getMicrosoftProfileRow(db, tenantId, binding.profile_id);
  if (!profile || profile.is_archived) {
    return {
      status: 'invalid_profile',
      tenantId,
      consumerType,
      profileId: binding.profile_id,
      message: `Selected ${getConsumerLabel(consumerType)} Microsoft profile is missing or archived`,
    };
  }

  const clientSecret = await secretProvider.getTenantSecret(tenantId, profile.client_secret_ref);
  if (!isConfigured(profile.client_id) || !isConfigured(clientSecret)) {
    return {
      status: 'invalid_profile',
      tenantId,
      consumerType,
      profileId: profile.profile_id,
      message: `Selected ${getConsumerLabel(consumerType)} Microsoft profile is missing required credentials`,
    };
  }

  return {
    status: 'ready',
    tenantId,
    consumerType,
    profileId: profile.profile_id,
    clientId: profile.client_id,
    clientSecret: clientSecret || undefined,
    microsoftTenantId: normalizeTenantId(profile.tenant_id),
  };
}
