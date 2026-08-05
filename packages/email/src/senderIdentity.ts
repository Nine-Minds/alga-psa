import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { EmailAddress, TenantEmailSettings } from '@alga-psa/types';

export function parseEmailAddress(value?: string | EmailAddress | null): EmailAddress | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    if (!value.email) {
      return null;
    }
    return { email: value.email, name: value.name };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>$/);
  if (match) {
    const name = match[1]?.trim();
    return {
      email: match[2].trim(),
      name: name || undefined,
    };
  }

  return { email: trimmed };
}

function extractEmailParts(email?: string | null): { localPart: string; domain?: string } | null {
  if (!email) {
    return null;
  }

  const [localPart, domain] = email.split('@');
  if (!domain) {
    return { localPart: localPart || email };
  }

  return { localPart, domain };
}

function sanitizeLocalPart(localPart?: string | null): string {
  if (!localPart) {
    return 'notifications';
  }

  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, '');

  return normalized || 'notifications';
}

function sanitizeDomain(domain?: string | null): string | null {
  if (!domain) {
    return null;
  }

  const normalized = domain.trim().replace(/^@/, '').toLowerCase();
  return normalized || null;
}

function extractDomainFromAddress(address?: string): string | null {
  const parsed = parseEmailAddress(address);
  const parts = extractEmailParts(parsed?.email);
  return parts?.domain || null;
}

function getProviderConfiguredAddress(settings?: TenantEmailSettings | null): EmailAddress | null {
  const enabledConfig = settings?.providerConfigs?.find(config => config.isEnabled && config.config);
  if (!enabledConfig) {
    return null;
  }

  const configFrom = enabledConfig.config.from;
  const configFromName = enabledConfig.config.fromName ?? enabledConfig.config.from_name;
  if (typeof configFrom !== 'string' || !configFrom.trim()) {
    return null;
  }

  const parsed = parseEmailAddress(configFrom) || { email: configFrom.trim() };
  const normalizedName = typeof configFromName === 'string' ? configFromName.trim() : '';
  if (!parsed.name && normalizedName) {
    parsed.name = normalizedName;
  }
  return parsed;
}

export async function resolveTenantCompanyName(
  knex: Knex | Knex.Transaction,
  tenantId: string
): Promise<string | null> {
  const db = tenantDb(knex, tenantId);
  const defaultClientQuery = db.table('tenant_companies as tc')
    .where({ 'tc.is_default': true })
    .whereNull('tc.deleted_at')
    .select('c.client_name');
  db.tenantJoin(defaultClientQuery, 'clients as c', 'tc.client_id', 'c.client_id');

  const defaultClient = await defaultClientQuery.first<{ client_name?: string | null }>();
  const defaultClientName = defaultClient?.client_name?.trim();
  if (defaultClientName) {
    return defaultClientName;
  }

  const tenant = await db.table('tenants')
    .select('client_name')
    .first<{ client_name?: string | null }>();

  return tenant?.client_name?.trim() || null;
}

export function resolveDefaultFromAddress(
  settings?: TenantEmailSettings | null,
  tenantCompanyName?: string | null
): EmailAddress {
  const providerAddress = getProviderConfiguredAddress(settings);
  const envAddress = parseEmailAddress(process.env.EMAIL_FROM);
  const fallbackName = providerAddress?.name
    || tenantCompanyName?.trim()
    || envAddress?.name
    || process.env.EMAIL_FROM_NAME?.trim()
    || 'AlgaPSA Notifications';
  const fallbackEmail = providerAddress?.email || envAddress?.email || 'notifications@example.com';

  const emailParts = extractEmailParts(fallbackEmail);
  const localPart = sanitizeLocalPart(emailParts?.localPart);
  const configuredDomain = sanitizeDomain(settings?.defaultFromDomain);
  const fallbackDomain = sanitizeDomain(emailParts?.domain)
    || sanitizeDomain(extractDomainFromAddress(fallbackEmail));
  const targetDomain = configuredDomain || fallbackDomain;

  return {
    email: targetDomain ? `${localPart}@${targetDomain}` : fallbackEmail,
    name: fallbackName,
  };
}

export function applyFromNameOverride(
  address: string | EmailAddress,
  fromName?: string | null
): EmailAddress {
  const resolved = parseEmailAddress(address);
  if (!resolved) {
    throw new Error('A valid From address is required');
  }

  const normalizedName = fromName?.trim();
  return {
    ...resolved,
    ...(normalizedName ? { name: normalizedName } : {}),
  };
}
