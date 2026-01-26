import { randomUUID } from 'node:crypto';

import { getAdminConnection } from '@alga-psa/db/admin';
import type { Knex } from 'knex';

import { coerceProviders, normalizeCapability, withDefaultProviders } from './providers';

export interface SecretEnvelopePayload {
  ciphertext_b64: string;
  algorithm?: string | null;
  key_path?: string | null;
  mount?: string | null;
  version?: string | null;
  expires_at?: string | null;
}

export interface InstallConfigResult {
  tenantId: string;
  extensionSlug?: string | null;
  installId: string;
  versionId: string;
  registryId: string;
  contentHash: string | null;
  config: Record<string, string>;
  providers: string[];
  configVersion?: string | null;
  secretsVersion?: string | null;
  secretEnvelope?: SecretEnvelopePayload | null;
  updatedAt?: string | null;
}

interface InstallLookupParams {
  tenantId: string;
  extensionId: string;
}

interface InstallRow {
  install_id: string;
  tenant_id: string;
  registry_id: string;
  registry_publisher: string | null;
  registry_name: string | null;
  version_id: string;
  version_capabilities: unknown;
  install_config: unknown;
  granted_caps: unknown;
}

async function getDb(): Promise<Knex> {
  return getAdminConnection();
}

function buildSlug(publisher: string | null, name: string | null): string | null {
  if (!publisher || !name) return null;
  return `${publisher}.${name}`;
}

function parseConfigMap(value: unknown): Record<string, string> {
  if (!value) return {};
  const obj = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!obj || typeof obj !== 'object') return {};
  const entries = Object.entries(obj as Record<string, unknown>).map(([key, val]) => {
    if (val === null || val === undefined) return [key, ''];
    if (typeof val === 'string') return [key, val];
    return [key, JSON.stringify(val)];
  });
  return Object.fromEntries(entries);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isUuid(value: string): boolean {
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    trimmed
  );
}

function mergeProviders(...sources: unknown[]): string[] {
  const set = new Set<string>();
  for (const source of sources) {
    for (const value of coerceProviders(source)) {
      set.add(normalizeCapability(value));
    }
  }
  return Array.from(set);
}

async function loadInstallRow(db: Knex, { tenantId, extensionId }: InstallLookupParams): Promise<InstallRow | null> {
  const slug = extensionId.toLowerCase();
  const isId = isUuid(extensionId);
  const row = await db('tenant_extension_install as install')
    .leftJoin('extension_registry as registry', 'registry.id', 'install.registry_id')
    .leftJoin('extension_version as version', 'version.id', 'install.version_id')
    .where('install.tenant_id', tenantId)
    .andWhere((builder) => {
      if (isId) {
        builder.where('install.id', extensionId);
        builder.orWhere('install.registry_id', extensionId);
        builder.orWhereRaw('lower(concat(registry.publisher, \'.\', registry.name)) = ?', [slug]);
        return;
      }

      builder.whereRaw('lower(concat(registry.publisher, \'.\', registry.name)) = ?', [slug]);
    })
    .select<InstallRow[]>([
      'install.id as install_id',
      'install.tenant_id',
      'install.registry_id',
      'install.config as install_config',
      'install.granted_caps',
      'registry.publisher as registry_publisher',
      'registry.name as registry_name',
      'version.id as version_id',
      'version.capabilities as version_capabilities',
    ])
    .first();
  return row ?? null;
}

async function loadInstallRowById(db: Knex, installId: string): Promise<InstallRow | null> {
  const row = await db('tenant_extension_install as install')
    .leftJoin('extension_registry as registry', 'registry.id', 'install.registry_id')
    .leftJoin('extension_version as version', 'version.id', 'install.version_id')
    .where('install.id', installId)
    .select<InstallRow[]>([
      'install.id as install_id',
      'install.tenant_id',
      'install.registry_id',
      'install.config as install_config',
      'install.granted_caps',
      'registry.publisher as registry_publisher',
      'registry.name as registry_name',
      'version.id as version_id',
      'version.capabilities as version_capabilities',
    ])
    .first();
  return row ?? null;
}

async function loadBundleContentHash(db: Knex, versionId: string): Promise<string | null> {
  const bundle = await db('extension_bundle')
    .where({ version_id: versionId })
    .orderBy('created_at', 'desc')
    .first(['content_hash']);
  return bundle?.content_hash ?? null;
}

async function loadConfigRow(db: Knex, installId: string) {
  return db('tenant_extension_install_config').where({ install_id: installId }).first();
}

async function loadSecretsRow(db: Knex, installId: string) {
  return db('tenant_extension_install_secrets').where({ install_id: installId }).first();
}

function buildSecretEnvelope(row: any): SecretEnvelopePayload | null {
  if (!row) return null;
  if (!row.ciphertext) return null;
  return {
    ciphertext_b64: row.ciphertext,
    algorithm: row.algorithm ?? undefined,
    key_path: row.transit_key ?? undefined,
    mount: row.transit_mount ?? undefined,
    version: row.version ?? undefined,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
  };
}

function combineConfigRow(configRow: any, installRow: InstallRow) {
  const configSource = configRow?.config ?? installRow.install_config ?? {};
  const config = parseConfigMap(configSource);
  const providers = mergeProviders(configRow?.providers, installRow.granted_caps);
  return {
    config,
    providers,
    version: configRow?.version ?? null,
    updatedAt: configRow?.updated_at ? new Date(configRow.updated_at).toISOString() : null,
  };
}

export async function getInstallConfig(params: InstallLookupParams): Promise<InstallConfigResult | null> {
  const db = await getDb();
  const installRow = await loadInstallRow(db, params);
  if (!installRow) return null;
  if (!installRow.install_id || !String(installRow.install_id).trim()) {
    // Should be impossible unless DB row is corrupt; log loudly so we can track it down.
    console.error('[installConfig] invalid install_id on install row', {
      tenantId: params.tenantId,
      extensionId: params.extensionId,
      install_id: installRow.install_id,
      registry_id: installRow.registry_id,
      version_id: installRow.version_id,
    });
    return null;
  }
  return hydrateInstallConfig(db, installRow);
}

export async function getInstallConfigByInstallId(installId: string): Promise<InstallConfigResult | null> {
  const db = await getDb();
  const installRow = await loadInstallRowById(db, installId);
  if (!installRow) return null;
  if (!installRow.install_id || !String(installRow.install_id).trim()) {
    console.error('[installConfig] invalid install_id on install row (lookup by id)', {
      installId,
      install_id: installRow.install_id,
      tenant_id: installRow.tenant_id,
      registry_id: installRow.registry_id,
      version_id: installRow.version_id,
    });
    return null;
  }
  return hydrateInstallConfig(db, installRow);
}

async function hydrateInstallConfig(db: Knex, installRow: InstallRow): Promise<InstallConfigResult> {
  const [bundleHash, configRow, secretsRow] = await Promise.all([
    loadBundleContentHash(db, installRow.version_id),
    loadConfigRow(db, installRow.install_id),
    loadSecretsRow(db, installRow.install_id),
  ]);

  const installationConfig = combineConfigRow(configRow, installRow);

  const versionProviders = coerceProviders(installRow.version_capabilities);
  const providers = withDefaultProviders([...installationConfig.providers, ...versionProviders]);

  return {
    tenantId: installRow.tenant_id,
    extensionSlug: buildSlug(installRow.registry_publisher, installRow.registry_name),
    installId: installRow.install_id,
    versionId: installRow.version_id,
    registryId: installRow.registry_id,
    contentHash: bundleHash,
    config: installationConfig.config,
    providers,
    configVersion: installationConfig.version ?? undefined,
    secretsVersion: secretsRow?.version ?? undefined,
    secretEnvelope: buildSecretEnvelope(secretsRow),
    updatedAt: installationConfig.updatedAt,
  };
}

type DbConnection = Knex | Knex.Transaction;

interface UpsertInstallConfigInput {
  installId: string;
  tenantId: string;
  config?: Record<string, unknown>;
  providers?: string[];
  connection?: DbConnection;
}

interface UpsertInstallConfigResult {
  version: string;
  providers: string[];
  updatedAt: string;
}

interface UpsertInstallSecretsInput {
  installId: string;
  tenantId: string;
  secrets: Record<string, unknown>;
  expiresAt?: Date | string | null;
  algorithmPreference?: 'vault-transit' | 'inline';
  transitKeyOverride?: string;
  transitMountOverride?: string;
  connection?: DbConnection;
}

interface UpsertInstallSecretsResult {
  version: string | null;
  algorithm: string | null;
  cleared: boolean;
}

interface DeleteInstallSecretsInput {
  installId: string;
  connection?: DbConnection;
}

interface SecretEnvelopeRecord {
  ciphertext: string;
  algorithm: string;
  transitKey?: string | null;
  transitMount?: string | null;
}

const INLINE_ALGORITHM = 'inline/base64';
const VAULT_ALGORITHM = 'vault-transit:v1';

function sanitizeConfig(config?: Record<string, unknown>): Record<string, unknown> {
  if (!config || typeof config !== 'object') return {};
  return { ...config };
}

function normalizeProvidersInput(values?: string[]): string[] {
  const merged = mergeProviders(values ?? []);
  return withDefaultProviders(merged.map(normalizeCapability));
}

function resolveConnection(connection?: DbConnection): DbConnection | Promise<DbConnection> {
  if (connection) return connection;
  return getDb();
}

function encodeInlineCiphertext(payload: Record<string, string>): SecretEnvelopeRecord {
  const json = JSON.stringify(payload);
  const ciphertext = Buffer.from(json, 'utf8').toString('base64');
  return { ciphertext, algorithm: INLINE_ALGORITHM };
}

interface VaultConfig {
  addr: string;
  token: string;
  key: string;
  mount: string;
  namespace?: string;
}

function resolveVaultConfig(overrides?: { transitKey?: string; transitMount?: string }): VaultConfig | null {
  const addr = process.env.ALGA_VAULT_ADDR || process.env.VAULT_ADDR;
  const token = process.env.ALGA_VAULT_TOKEN || process.env.VAULT_TOKEN;
  const key = overrides?.transitKey || process.env.ALGA_VAULT_TRANSIT_KEY;
  const mount = overrides?.transitMount || process.env.ALGA_VAULT_TRANSIT_MOUNT || 'transit';
  const namespace = process.env.ALGA_VAULT_NAMESPACE || process.env.VAULT_NAMESPACE;

  if (!addr || !token || !key) return null;
  return { addr, token, key, mount, namespace: namespace || undefined };
}

async function encryptWithVault(payload: Record<string, string>, overrides?: { transitKey?: string; transitMount?: string }): Promise<SecretEnvelopeRecord | null> {
  const cfg = resolveVaultConfig(overrides);
  if (!cfg) return null;

  try {
    const plaintextB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const url = `${cfg.addr.replace(/\/$/, '')}/v1/${cfg.mount.replace(/^\/|\/$/g, '')}/encrypt/${cfg.key.replace(/^\/|\/$/g, '')}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-vault-token': cfg.token,
    };
    if (cfg.namespace) {
      headers['x-vault-namespace'] = cfg.namespace;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ plaintext: plaintextB64 }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.warn('[installConfig] Vault transit encrypt failed', { status: resp.status, body: text?.slice?.(0, 256) });
      return null;
    }
    const data = await resp.json();
    const ciphertext = data?.data?.ciphertext;
    if (!ciphertext || typeof ciphertext !== 'string') {
      console.warn('[installConfig] Vault transit encrypt missing ciphertext');
      return null;
    }
    return {
      ciphertext,
      algorithm: VAULT_ALGORITHM,
      transitKey: cfg.key,
      transitMount: cfg.mount,
    };
  } catch (err: any) {
    console.warn('[installConfig] Vault transit encrypt exception', { error: err?.message });
    return null;
  }
}

function coerceSecretsMap(source: Record<string, unknown>): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(source ?? {})) {
    if (!key) continue;
    if (typeof value === 'string') {
      entries.push([key, value]);
      continue;
    }
    if (value === null || value === undefined) continue;
    entries.push([key, String(value)]);
  }
  return Object.fromEntries(entries);
}

async function createSecretEnvelopeRecord(
  _tenantId: string,
  _installId: string,
  secrets: Record<string, unknown>,
  options?: { algorithmPreference?: 'vault-transit' | 'inline'; transitKey?: string; transitMount?: string }
): Promise<SecretEnvelopeRecord | null> {
  const map = coerceSecretsMap(secrets);
  if (Object.keys(map).length === 0) {
    return null;
  }

  const preferVault = options?.algorithmPreference !== 'inline';
  if (preferVault) {
    const vaultRecord = await encryptWithVault(map, {
      transitKey: options?.transitKey,
      transitMount: options?.transitMount,
    });
    if (vaultRecord) {
      return vaultRecord;
    }
  }

  // Fallback to inline encoding
  return encodeInlineCiphertext(map);
}

export async function upsertInstallConfigRecord(input: UpsertInstallConfigInput): Promise<UpsertInstallConfigResult> {
  const { installId, tenantId } = input;
  if (!installId || !tenantId) {
    throw new Error('installId and tenantId are required');
  }

  const connection = (await resolveConnection(input.connection)) as Knex;
  const normalizedConfig = sanitizeConfig(input.config);
  const providers = normalizeProvidersInput(input.providers);
  const version = randomUUID();

  const insertPayload = {
    install_id: installId,
    tenant_id: tenantId,
    config: JSON.stringify(normalizedConfig),
    providers: JSON.stringify(providers),
    version,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  };

  const rows = await connection('tenant_extension_install_config')
    .insert(insertPayload)
    .onConflict('install_id')
    .merge({
      tenant_id: tenantId,
      config: insertPayload.config,
      providers: insertPayload.providers,
      version,
      updated_at: connection.fn.now(),
    })
    .returning(['version', 'providers', 'updated_at']);

  const row = rows[0];
  const storedProviders = coerceProviders(row?.providers);
  const updatedAt = row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString();

  return {
    version: row?.version ?? version,
    providers: withDefaultProviders(storedProviders),
    updatedAt,
  };
}

function decodeInlineCiphertext(ciphertext: string): Record<string, string> | null {
  try {
    const json = Buffer.from(ciphertext, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return coerceSecretsMap(payload);
  } catch {
    return null;
  }
}

async function decryptWithVault(ciphertext: string, overrides?: { transitKey?: string; transitMount?: string }): Promise<Record<string, string> | null> {
  const cfg = resolveVaultConfig(overrides);
  if (!cfg) return null;

  try {
    const url = `${cfg.addr.replace(/\/$/, '')}/v1/${cfg.mount.replace(/^\/|\/$/g, '')}/decrypt/${cfg.key.replace(/^\/|\/$/g, '')}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-vault-token': cfg.token,
    };
    if (cfg.namespace) {
      headers['x-vault-namespace'] = cfg.namespace;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ciphertext }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.warn('[installConfig] Vault transit decrypt failed', { status: resp.status, body: text?.slice?.(0, 256) });
      return null;
    }

    const data = await resp.json();
    const plaintextB64 = data?.data?.plaintext;
    if (!plaintextB64 || typeof plaintextB64 !== 'string') {
      console.warn('[installConfig] Vault transit decrypt missing plaintext');
      return null;
    }

    const json = Buffer.from(plaintextB64, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return coerceSecretsMap(payload);
  } catch (err: any) {
    console.warn('[installConfig] Vault transit decrypt exception', { error: err?.message });
    return null;
  }
}

async function decryptSecretEnvelope(envelope: SecretEnvelopeRecord): Promise<Record<string, string> | null> {
  if (envelope.algorithm === INLINE_ALGORITHM) {
    return decodeInlineCiphertext(envelope.ciphertext);
  }
  if (envelope.algorithm === VAULT_ALGORITHM) {
    return decryptWithVault(envelope.ciphertext, {
      transitKey: envelope.transitKey ?? undefined,
      transitMount: envelope.transitMount ?? undefined,
    });
  }
  return null;
}

export async function upsertInstallSecretsRecord(input: UpsertInstallSecretsInput): Promise<UpsertInstallSecretsResult> {
  const { installId, tenantId } = input;
  if (!installId || !tenantId) throw new Error('installId and tenantId are required');

  const connection = (await resolveConnection(input.connection)) as Knex;

  // Load existing secrets to merge
  const existingRow = await connection('tenant_extension_install_secrets').where({ install_id: installId }).first();
  let mergedSecrets = { ...input.secrets };

  if (existingRow) {
    const existingEnvelope = {
      ciphertext: existingRow.ciphertext,
      algorithm: existingRow.algorithm,
      transitKey: existingRow.transit_key,
      transitMount: existingRow.transit_mount,
    };
    const existingSecrets = await decryptSecretEnvelope(existingEnvelope);
    if (existingSecrets) {
      // Merge: existing secrets + new secrets (new overwrites old)
      mergedSecrets = { ...existingSecrets, ...input.secrets };
    }
  }

  const envelope = await createSecretEnvelopeRecord(tenantId, installId, mergedSecrets, {
    algorithmPreference: input.algorithmPreference,
    transitKey: input.transitKeyOverride,
    transitMount: input.transitMountOverride,
  });

  if (!envelope) {
    await deleteInstallSecretsRecord({ installId, connection });
    return { version: null, algorithm: null, cleared: true };
  }

  const version = randomUUID();
  const expiresAt =
    typeof input.expiresAt === 'string' || input.expiresAt instanceof Date
      ? new Date(input.expiresAt)
      : null;

  const insertPayload: Record<string, unknown> = {
    install_id: installId,
    tenant_id: tenantId,
    ciphertext: envelope.ciphertext,
    algorithm: envelope.algorithm,
    transit_key: envelope.transitKey ?? null,
    transit_mount: envelope.transitMount ?? null,
    version,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  };

  const rows = await connection('tenant_extension_install_secrets')
    .insert(insertPayload)
    .onConflict('install_id')
    .merge({
      tenant_id: tenantId,
      ciphertext: envelope.ciphertext,
      algorithm: envelope.algorithm,
      transit_key: envelope.transitKey ?? null,
      transit_mount: envelope.transitMount ?? null,
      version,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      updated_at: connection.fn.now(),
    })
    .returning(['version', 'algorithm']);

  const row = rows[0];

  return {
    version: row?.version ?? version,
    algorithm: row?.algorithm ?? envelope.algorithm,
    cleared: false,
  };
}

export async function deleteInstallSecretsRecord({ installId, connection }: DeleteInstallSecretsInput): Promise<void> {
  if (!installId) return;
  const db = (await resolveConnection(connection)) as Knex;
  await db('tenant_extension_install_secrets').where({ install_id: installId }).del();
}
