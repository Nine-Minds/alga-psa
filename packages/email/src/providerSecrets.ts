/**
 * Server-only handling of outbound email provider secrets.
 *
 * SMTP passwords and Resend API keys live in the tenant secret provider, under
 * versioned names. `tenant_email_settings.provider_configs` keeps only
 * `config.secretRefs` (field -> secret name). Nothing in this module logs or
 * returns secret values except `resolveProviderSecrets`, which hands the
 * runtime config to the provider being built.
 */

import { randomUUID } from 'node:crypto';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { EmailProviderError, type EmailProviderConfig } from '@alga-psa/types';
import type { Knex } from 'knex';

// LEVERAGE: pattern secret-ref-in-db — versioned tenant secret + ref in a DB column (also calendar client_secret_ref); a shared ref/rotate/cleanup layer is missing
export const SECRET_MASK = '***';

export interface ProviderSecretField {
  /** Canonical key in the runtime config and in the UI contract. */
  field: string;
  /** Legacy/alternate keys that must also be stripped. */
  aliases: string[];
  /** Fixed label used in secret names. Never derived from client input. */
  label: string;
}

export const PROVIDER_SECRET_FIELDS: Record<string, ProviderSecretField[]> = {
  smtp: [{ field: 'password', aliases: [], label: 'password' }],
  resend: [{ field: 'apiKey', aliases: ['api_key'], label: 'api_key' }],
};

export type TenantSecretStore = {
  getTenantSecret(tenantId: string, name: string): Promise<string | undefined>;
  setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void>;
  deleteTenantSecret(tenantId: string, name: string): Promise<void>;
};

export const EMAIL_PROVIDER_SECRET_MISSING = 'EMAIL_PROVIDER_SECRET_MISSING';

// Refs read from the DB are only honoured when they have exactly the shape we
// generate, so a tampered row cannot point a provider at another secret.
const SECRET_REF_PATTERN = /^email_outbound_[a-z]+_[a-z_]+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normalizeSecretValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === SECRET_MASK) {
    return undefined;
  }

  return trimmed;
}

function buildSecretName(providerType: string, label: string): string {
  return `email_outbound_${providerType}_${label}_${randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRef(config: Record<string, any> | undefined, field: string): string | undefined {
  const ref = isRecord(config?.secretRefs) ? config?.secretRefs[field] : undefined;
  return typeof ref === 'string' && SECRET_REF_PATTERN.test(ref) ? ref : undefined;
}

/** First defined raw value among the field and its aliases (may be '' or the mask). */
function getRawValue(config: Record<string, any> | undefined, spec: ProviderSecretField): unknown {
  for (const key of [spec.field, ...spec.aliases]) {
    if (config && config[key] !== undefined && config[key] !== null) return config[key];
  }
  return undefined;
}

function getLegacyValue(config: Record<string, any> | undefined, spec: ProviderSecretField): string | undefined {
  for (const key of [spec.field, ...spec.aliases]) {
    const value = normalizeSecretValue(config?.[key]);
    if (value) return value;
  }
  return undefined;
}

function stripSecretKeys(config: Record<string, any>, spec: ProviderSecretField): void {
  delete config[spec.field];
  for (const alias of spec.aliases) delete config[alias];
}

async function deleteRefsBestEffort(tenant: string, refs: string[], store: TenantSecretStore): Promise<void> {
  for (const name of refs) {
    try {
      await store.deleteTenantSecret(tenant, name);
    } catch (error) {
      logger.warn('[providerSecrets] Failed to delete email provider secret', {
        tenant,
        secretName: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export { deleteRefsBestEffort as deleteProviderSecretRefs };

export interface PersistProviderSecretsResult {
  configs: EmailProviderConfig[];
  /** Names written by this call; delete them if the save does not commit. */
  committedRefs: string[];
  /** Names no longer referenced; delete them after the save commits. */
  staleRefs: string[];
}

/**
 * Move secrets from `incoming` configs into the secret store and return configs
 * that carry references only. Secret-store writes happen here, so callers must
 * finish all validation first and clean up `committedRefs` if the save fails.
 * Incoming `secretRefs` are never trusted: references come from `existing`.
 */
export async function persistProviderSecrets(
  tenant: string,
  incoming: EmailProviderConfig[],
  existing: EmailProviderConfig[] | undefined,
  store: TenantSecretStore
): Promise<PersistProviderSecretsResult> {
  const existingById = new Map((existing ?? []).map(config => [config.providerId, config]));
  const committedRefs: string[] = [];
  const staleRefs: string[] = [];

  try {
    const configs: EmailProviderConfig[] = [];

    for (const config of incoming) {
      const specs = PROVIDER_SECRET_FIELDS[config.providerType];
      if (!specs) {
        const passthrough: Record<string, any> = { ...(config.config ?? {}) };
        delete passthrough.secretRefs;
        configs.push({ ...config, config: passthrough });
        continue;
      }

      const prior = existingById.get(config.providerId);
      const priorConfig = prior && prior.providerType === config.providerType ? prior.config : undefined;
      const nextConfig: Record<string, any> = { ...(config.config ?? {}) };
      const refs: Record<string, string> = {};
      delete nextConfig.secretRefs;

      for (const spec of specs) {
        const raw = getRawValue(nextConfig, spec);
        const priorRef = getRef(priorConfig, spec.field);
        const priorLegacy = getLegacyValue(priorConfig, spec);
        stripSecretKeys(nextConfig, spec);

        const trimmed = typeof raw === 'string' ? raw.trim() : undefined;
        const unchanged = raw === undefined || trimmed === SECRET_MASK;

        if (unchanged) {
          if (priorRef) {
            refs[spec.field] = priorRef;
          } else if (priorLegacy) {
            const name = buildSecretName(config.providerType, spec.label);
            await store.setTenantSecret(tenant, name, priorLegacy);
            committedRefs.push(name);
            refs[spec.field] = name;
          }
          continue;
        }

        if (typeof raw !== 'string' || trimmed === '') {
          // Explicit clear.
          if (priorRef) staleRefs.push(priorRef);
          continue;
        }

        const name = buildSecretName(config.providerType, spec.label);
        await store.setTenantSecret(tenant, name, raw);
        committedRefs.push(name);
        refs[spec.field] = name;
        if (priorRef) staleRefs.push(priorRef);
      }

      if (Object.keys(refs).length > 0) nextConfig.secretRefs = refs;
      configs.push({ ...config, config: nextConfig });
    }

    // Provider configs dropped by this save, or re-saved under the same id with a
    // different provider type, no longer reference their secrets.
    const incomingTypeById = new Map(incoming.map(config => [config.providerId, config.providerType]));
    for (const prior of existing ?? []) {
      if (incomingTypeById.get(prior.providerId) === prior.providerType) continue;
      for (const spec of PROVIDER_SECRET_FIELDS[prior.providerType] ?? []) {
        const ref = getRef(prior.config, spec.field);
        if (ref) staleRefs.push(ref);
      }
    }

    return { configs, committedRefs, staleRefs: [...new Set(staleRefs)] };
  } catch (error) {
    await deleteRefsBestEffort(tenant, committedRefs, store);
    throw error;
  }
}

/**
 * Build the runtime config for a provider, filling in secrets from the store.
 * A reference whose secret cannot be read fails fast; it never falls back.
 * Legacy plaintext (no reference yet) is used with one warning per call.
 */
export async function resolveProviderSecrets(
  tenant: string,
  config: EmailProviderConfig,
  store: TenantSecretStore
): Promise<Record<string, any>> {
  const specs = PROVIDER_SECRET_FIELDS[config.providerType];
  const original: Record<string, any> = isRecord(config.config) ? config.config : {};
  if (!specs) return original;

  const runtime: Record<string, any> = { ...original };
  delete runtime.secretRefs;

  for (const spec of specs) {
    const ref = getRef(original, spec.field);
    const rawRef = isRecord(original.secretRefs) ? original.secretRefs[spec.field] : undefined;

    if (rawRef !== undefined && !ref) {
      throw new EmailProviderError(
        `The saved ${config.providerType} credential reference is invalid; re-enter it in Outbound Email settings.`,
        config.providerId,
        config.providerType,
        false,
        EMAIL_PROVIDER_SECRET_MISSING
      );
    }

    if (ref) {
      let value: string | undefined;
      try {
        value = await store.getTenantSecret(tenant, ref);
      } catch (error) {
        logger.error('[providerSecrets] Failed to read email provider secret', {
          tenant,
          secretName: ref,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new EmailProviderError(
          `The saved ${config.providerType} credential could not be read from the secret store.`,
          config.providerId,
          config.providerType,
          true,
          EMAIL_PROVIDER_SECRET_MISSING
        );
      }
      if (!value) {
        throw new EmailProviderError(
          `The saved ${labelFor(config.providerType, spec)} could not be read from the secret store; re-enter it in Outbound Email settings.`,
          config.providerId,
          config.providerType,
          false,
          EMAIL_PROVIDER_SECRET_MISSING
        );
      }
      stripSecretKeys(runtime, spec);
      runtime[spec.field] = value;
      continue;
    }

    const legacy = getLegacyValue(original, spec);
    if (legacy) {
      logger.warn('[providerSecrets] Using legacy plaintext email provider secret; run the tenant email secrets backfill', {
        tenant,
        providerId: config.providerId,
        field: `${config.providerType}.${spec.field}`,
      });
    }
  }

  return runtime;
}

function labelFor(providerType: string, spec: ProviderSecretField): string {
  if (providerType === 'smtp') return 'SMTP password';
  if (providerType === 'resend') return 'Resend API key';
  return spec.field;
}

/**
 * Client-safe view: no secret fields, aliases or references. The canonical
 * field is `'***'` when a secret exists and `''` otherwise.
 */
export function redactProviderConfigs(configs: EmailProviderConfig[] | undefined): EmailProviderConfig[] {
  return (configs ?? []).map(config => {
    const nextConfig: Record<string, any> = { ...(isRecord(config.config) ? config.config : {}) };
    const specs = PROVIDER_SECRET_FIELDS[config.providerType] ?? [];

    for (const spec of specs) {
      const present = Boolean(getRef(nextConfig, spec.field)) ||
        [spec.field, ...spec.aliases].some(key => {
          const value = nextConfig[key];
          return typeof value === 'string' && value.trim() !== '';
        });
      stripSecretKeys(nextConfig, spec);
      nextConfig[spec.field] = present ? SECRET_MASK : '';
    }
    delete nextConfig.secretRefs;

    return { ...config, config: nextConfig };
  });
}

export interface MigrateTenantProviderSecretsResult {
  tenant: string;
  /** Field labels such as `smtp.password`. Never values. */
  migrated: string[];
  skipped?: 'no-settings' | 'nothing-to-migrate' | 'concurrent';
}

/**
 * Per-tenant backfill unit: move legacy plaintext in `provider_configs` into
 * the secret store. Idempotent. Conditional on `updated_at` so a concurrent
 * save wins; in that case the refs just written are deleted and the next run
 * retries. `updated_at` is deliberately not bumped (the ref change already
 * moves the provider fingerprint).
 */
export async function migrateTenantProviderSecrets(
  knex: Knex,
  tenant: string,
  store: TenantSecretStore,
  options: { dryRun?: boolean } = {}
): Promise<MigrateTenantProviderSecretsResult> {
  const row = await tenantDb(knex, tenant)
    .table('tenant_email_settings')
    .select('*', knex.raw('updated_at::text as __updated_at_text'))
    .first();
  if (!row) return { tenant, migrated: [], skipped: 'no-settings' };

  const rawConfigs = typeof row.provider_configs === 'string' ? JSON.parse(row.provider_configs) : row.provider_configs;
  const configs: EmailProviderConfig[] = Array.isArray(rawConfigs) ? rawConfigs : [];

  const migrated: string[] = [];
  const committedRefs: string[] = [];

  try {
    const nextConfigs: EmailProviderConfig[] = [];
    for (const config of configs) {
      const specs = PROVIDER_SECRET_FIELDS[config.providerType];
      if (!specs || !isRecord(config.config)) {
        nextConfigs.push(config);
        continue;
      }

      const nextConfig: Record<string, any> = { ...config.config };
      const refs: Record<string, string> = isRecord(nextConfig.secretRefs) ? { ...nextConfig.secretRefs } : {};

      for (const spec of specs) {
        const legacy = getLegacyValue(nextConfig, spec);
        if (!legacy) continue;

        const existingRef = getRef(nextConfig, spec.field);
        const existingValue = existingRef && !options.dryRun
          ? await store.getTenantSecret(tenant, existingRef)
          : undefined;

        if (!existingValue || options.dryRun) {
          if (!options.dryRun) {
            const name = buildSecretName(config.providerType, spec.label);
            await store.setTenantSecret(tenant, name, legacy);
            committedRefs.push(name);
            refs[spec.field] = name;
          }
        }
        stripSecretKeys(nextConfig, spec);
        migrated.push(`${config.providerType}.${spec.field}`);
      }

      if (Object.keys(refs).length > 0) nextConfig.secretRefs = refs;
      nextConfigs.push({ ...config, config: nextConfig });
    }

    if (migrated.length === 0) return { tenant, migrated, skipped: 'nothing-to-migrate' };
    if (options.dryRun) return { tenant, migrated };

    const updated = await tenantDb(knex, tenant)
      .table('tenant_email_settings')
      .whereRaw('updated_at IS NOT DISTINCT FROM ?::timestamptz', [row.__updated_at_text])
      .update({ provider_configs: JSON.stringify(nextConfigs) });

    if (updated === 0) {
      await deleteRefsBestEffort(tenant, committedRefs, store);
      return { tenant, migrated: [], skipped: 'concurrent' };
    }
    return { tenant, migrated };
  } catch (error) {
    await deleteRefsBestEffort(tenant, committedRefs, store);
    throw error;
  }
}
