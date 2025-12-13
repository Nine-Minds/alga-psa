// EE-only registry service v2 (Knex-backed)
import type { Knex } from 'knex';
import type { ManifestV2, ManifestEndpoint } from './bundles/manifest';
import { isValidSemverLike } from './bundles/manifest';
import type { SignatureVerificationResult } from './bundles/verify';
import { computeDomain, enqueueProvisioningWorkflow } from './runtime/provision';
import { isKnownCapability, normalizeCapability } from './providers';
import { upsertInstallConfigRecord } from './installConfig';

export type RegistryId = string;
export type VersionId = string;

export interface ApiEndpointDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: string; // e.g., "dist/handlers/http/sync#handle"
}

export interface UiDef {
  type: 'iframe';
  entry: string;
  routes?: { path: string; iframePath: string }[];
}

export interface RegistryEntry {
  id: RegistryId;
  publisher: string;
  name: string;
  displayName?: string;
  description?: string;
}

export interface VersionEntry {
  id: VersionId;
  registryId: RegistryId;
  version: string;
  runtime: string; // e.g., wasm-js@1
  mainEntry: string;
  api: { endpoints: ApiEndpointDef[] };
  ui?: UiDef;
  capabilities: string[];
}

export interface BundleDescriptor {
  id: string;
  versionId: VersionId;
  contentHash: string; // sha256:...
  signature?: string; // detached signature text
  precompiled?: Record<string, string>; // target -> path
  // Optional fields supported by DB (not required by type)
  // storageUrl?: string;
  // sizeBytes?: number;
}

export class ExtensionRegistryServiceV2 {
  constructor(private db: Knex) {}

  // 1) Create registry entry
  async createRegistryEntry(input: Omit<RegistryEntry, 'id'>): Promise<RegistryEntry> {
    try {
      const row = {
        publisher: input.publisher,
        name: input.name,
        display_name: input.displayName ?? null,
        description: input.description ?? null,
      };
      const [inserted] = await this.db('extension_registry')
        .insert(row)
        .returning(['id', 'publisher', 'name', 'display_name', 'description']);
      return {
        id: inserted.id,
        publisher: inserted.publisher,
        name: inserted.name,
        displayName: inserted.display_name ?? undefined,
        description: inserted.description ?? undefined,
      };
    } catch (err: any) {
      // Postgres unique_violation
      if (err && (err.code === '23505' || /unique/i.test(String(err.message)))) {
        throw new Error('Registry entry already exists for publisher/name');
      }
      throw err;
    }
  }

  // 2) List registry entries
  async listRegistryEntries(): Promise<RegistryEntry[]> {
    const rows = await this.db('extension_registry')
      .select([
        'id',
        'publisher',
        'name',
        'display_name',
        'description',
        // created_at is available but not part of RegistryEntry type
      ])
      .orderBy([{ column: 'publisher', order: 'asc' }, { column: 'name', order: 'asc' }]);

    return rows.map((r: any) => ({
      id: r.id,
      publisher: r.publisher,
      name: r.name,
      displayName: r.display_name ?? undefined,
      description: r.description ?? undefined,
    }));
  }

  // 3) Get by (publisher, name)
  async getRegistryEntryByName(publisher: string, name: string): Promise<RegistryEntry | null> {
    const r = await this.db('extension_registry')
      .where({ publisher, name })
      .first(['id', 'publisher', 'name', 'display_name', 'description']);
    if (!r) return null;
    return {
      id: r.id,
      publisher: r.publisher,
      name: r.name,
      displayName: r.display_name ?? undefined,
      description: r.description ?? undefined,
    };
  }

  // 4) Add version to registry entry
  async addVersion(
    entryId: RegistryId,
    v: Omit<VersionEntry, 'id' | 'registryId'>
  ): Promise<VersionEntry> {
    const normalizedCapabilities = (v.capabilities ?? []).map(normalizeCapability);
    const unknownCaps = normalizedCapabilities.filter((cap) => !isKnownCapability(cap));
    if (unknownCaps.length > 0) {
      throw new Error(`Unknown capabilities requested: ${unknownCaps.join(', ')}`);
    }

    try {
      const row = {
        registry_id: entryId,
        version: v.version,
        runtime: v.runtime,
        main_entry: v.mainEntry,
        capabilities: JSON.stringify(normalizedCapabilities),
        api_endpoints: JSON.stringify(v.api?.endpoints ?? []),
        ui: v.ui ? JSON.stringify(v.ui) : null,
      };

      const [ins] = await this.db('extension_version')
        .insert(row)
        .returning([
          'id',
          'registry_id',
          'version',
          'runtime',
          'main_entry',
          'capabilities',
          'api_endpoints',
          'ui',
        ]);

      return {
        id: ins.id,
        registryId: ins.registry_id,
        version: ins.version,
        runtime: ins.runtime,
        mainEntry: ins.main_entry,
        capabilities: Array.isArray(ins.capabilities) ? ins.capabilities : JSON.parse(ins.capabilities || '[]'),
        api: { endpoints: Array.isArray(ins.api_endpoints) ? ins.api_endpoints : JSON.parse(ins.api_endpoints || '[]') },
        ui: ins.ui ? (typeof ins.ui === 'string' ? JSON.parse(ins.ui) : ins.ui) : undefined,
      };
    } catch (err: any) {
      if (err && (err.code === '23505' || /unique/i.test(String(err.message)))) {
        throw new Error('Version already exists for this registry entry');
      }
      throw err;
    }
  }

  // 5) Attach bundle to a version
  async attachBundle(
    versionId: VersionId,
    b: Omit<BundleDescriptor, 'id' | 'versionId'>
  ): Promise<BundleDescriptor> {
    const contentHash = b.contentHash;
    const signature = b.signature;

    if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
      throw new Error('Invalid content_hash format; expected sha256:<64-hex>');
    }

    if (signature) {
      const ok = await this.verifySignature(contentHash, signature);
      if (!ok) {
        throw new Error('Signature verification failed');
      }
    }

    const row: any = {
      version_id: versionId,
      content_hash: contentHash,
      signature: signature ?? null,
      precompiled: b.precompiled ? JSON.stringify(b.precompiled) : null,
      // storage_url / size_bytes are optional; set via future publish pipeline
      storage_url: null,
      size_bytes: null,
    };

    const [ins] = await this.db('extension_bundle')
      .insert(row)
      .returning(['id', 'version_id', 'content_hash', 'signature', 'precompiled']);

    return {
      id: ins.id,
      versionId: ins.version_id,
      contentHash: ins.content_hash,
      signature: ins.signature ?? undefined,
      precompiled: ins.precompiled
        ? (typeof ins.precompiled === 'string' ? JSON.parse(ins.precompiled) : ins.precompiled)
        : undefined,
    };
  }

  // 6a) Install (upsert) for tenant
  async install(
    tenantId: string,
    registryId: string,
    version: string,
    opts?: { grantedCaps?: string[]; config?: any }
  ): Promise<boolean> {
    // Resolve version_id
    const v = await this.db('extension_version')
      .where({ registry_id: registryId, version })
      .first(['id', 'capabilities']);
    if (!v) {
      throw new Error('Version not found for provided registry/version');
    }

    let versionCaps: string[] = [];
    try {
      if (Array.isArray((v as any).capabilities)) {
        versionCaps = ((v as any).capabilities as string[]).filter((cap) => typeof cap === 'string');
      } else if (typeof (v as any).capabilities === 'string') {
        const parsed = JSON.parse((v as any).capabilities as string);
        if (Array.isArray(parsed)) {
          versionCaps = parsed.filter((cap: unknown): cap is string => typeof cap === 'string');
        }
      }
    } catch (err) {
      console.warn('[ExtensionRegistryServiceV2] failed to parse version capabilities', {
        registryId,
        version,
        error: (err as any)?.message,
      });
    }
    const normalizedCaps =
      opts?.grantedCaps?.length
        ? opts.grantedCaps.map(normalizeCapability).filter((cap) => isKnownCapability(cap))
        : versionCaps.map((cap) => normalizeCapability(cap)).filter((cap) => isKnownCapability(cap));

    const now = this.db.fn.now();
    // Compute per-install domain
    let runnerDomain: string | null = null;
    try {
      runnerDomain = computeDomain(tenantId, registryId);
    } catch (_e) {
      runnerDomain = null;
    }
    const payload = {
      tenant_id: tenantId,
      registry_id: registryId,
      version_id: v.id,
      status: 'enabled',
      granted_caps: JSON.stringify(normalizedCaps),
      config: JSON.stringify(opts?.config ?? {}),
      is_enabled: true,
      runner_domain: runnerDomain,
      runner_status: JSON.stringify({ state: 'pending', message: 'Provisioning requested' }),
      created_at: now,
      updated_at: now,
    };

    const rows = await this.db('tenant_extension_install')
      .insert(payload)
      .onConflict(['tenant_id', 'registry_id'])
      .merge({
        version_id: payload.version_id,
        status: payload.status,
        granted_caps: payload.granted_caps,
        config: payload.config,
        is_enabled: payload.is_enabled,
        runner_domain: payload.runner_domain,
        runner_status: payload.runner_status,
        updated_at: payload.updated_at,
      })
      .returning(['id', 'tenant_id']);

    const installRow = rows[0];

    if (installRow?.id) {
      try {
        await upsertInstallConfigRecord({
          installId: installRow.id,
          tenantId,
          config: opts?.config ?? {},
          providers: normalizedCaps,
          connection: this.db,
        });
      } catch (error: any) {
        console.error('[ExtensionRegistryServiceV2] failed to upsert install config record', {
          installId: installRow.id,
          tenantId,
          error: error?.message,
        });
      }
    }

    // Fire-and-forget: enqueue provisioning workflow
    try {
      const installId = installRow?.id;
      if (installId && runnerDomain) {
        await enqueueProvisioningWorkflow({ tenantId, extensionId: registryId, installId });
      }
    } catch (_e) {
      // swallow errors; status remains pending and can be retried from UI
    }

    return true;
    }

  // 6b) Get tenant install resolved to latest bundle content hash for the version
  async getTenantInstall(
    tenantId: string,
    registryId: string
  ): Promise<{ version_id: string; content_hash: string } | null> {
    const ti = await this.db('tenant_extension_install')
      .where({ tenant_id: tenantId, registry_id: registryId })
      .first(['version_id']);
    if (!ti) return null;

    const bundle = await this.db('extension_bundle')
      .where({ version_id: ti.version_id })
      .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'content_hash', order: 'desc' }])
      .first(['content_hash']);
    if (!bundle) return null;

    return { version_id: ti.version_id, content_hash: bundle.content_hash };
  }

  // Signature verification seam
  // See ee/docs/extension-system/security_signing.md
  private async verifySignature(contentHash: string, signature: string): Promise<boolean> {
    const trustBundle = process.env.SIGNING_TRUST_BUNDLE;
    // TODO: Implement actual crypto verification. Load PEMs from trustBundle (or path), verify detached signature.
    // Stub acceptance for now: ensure shapes are present; log for observability.
    const hashOk = /^sha256:[0-9a-f]{64}$/i.test(contentHash);
    const sigOk = typeof signature === 'string' && signature.trim().length > 0;

    // eslint-disable-next-line no-console
    console.info(
      '[ext-registry-v2] verifySignature (stub):',
      { contentHash, signaturePreview: signature.slice(0, 16) + '...', hasTrustBundle: !!trustBundle }
    );

    return hashOk && sigOk;
  }
}

// ========= M1 Task Additions: Adapter-agnostic registry v2 with content-hash version methods =========

// 1) Types

export interface CreateExtensionIfMissingInput {
  name: string; // manifest.name
  publisher?: string;
}

export interface CreateExtensionVersionInput {
  extensionId: string;              // FK to extension registry record
  version: string;                  // manifest.version
  contentHash: string;              // sha256 hex (no prefix)
  runtime: string;                  // manifest.runtime
  ui?: {                            // sanitized UI subset for storage
    type: 'iframe';
    entry: string;
    hooks?: {
      appMenu?: { label: string };
      [key: string]: unknown;
    };
  };
  uiEntry?: string;                 // sanitized UI entry if present
  endpoints: Array<{ method: string; path: string; handler: string }>;
  capabilities: string[];
  signature?: {
    required: boolean;
    verified: boolean;
    algorithm?: 'cosign' | 'x509' | 'pgp';
    subject?: string;
    issuer?: string;
    timestamp?: string;
    reason?: string;
  };
}

export interface ExtensionRecord {
  id: string;
  name: string;
  publisher?: string;
  createdAt: Date;
}

export interface ExtensionVersionRecord {
  id: string;
  extensionId: string;
  version: string;
  contentHash: string;
  runtime: string;
  // Optional full UI payload as stored in DB (if present)
  ui?: {
    type: 'iframe';
    entry: string;
    hooks?: {
      appMenu?: { label: string };
      [key: string]: unknown;
    };
  };
  uiEntry?: string;
  endpoints: Array<{ method: string; path: string; handler: string }>;
  capabilities: string[];
  signature?: CreateExtensionVersionInput['signature'];
  createdAt: Date;
}

// 2) Repository interfaces (adapter seam). TODO: wire real DAL implementation.

interface ExtensionsRepo {
  findByNamePublisher(name: string, publisher?: string): Promise<ExtensionRecord | null>;
  create(input: { name: string; publisher?: string }): Promise<ExtensionRecord>;
}

interface VersionsRepo {
  create(input: Omit<ExtensionVersionRecord, 'id' | 'createdAt'>): Promise<ExtensionVersionRecord>;
  findByHash(contentHash: string): Promise<ExtensionVersionRecord | null>;
  findLatestForExtension(extensionId: string): Promise<ExtensionVersionRecord | null>;
  findByExtensionAndVersion(extensionId: string, version: string): Promise<ExtensionVersionRecord | null>;
}

interface RegistryV2Repository {
  extensions: ExtensionsRepo;
  versions: VersionsRepo;
}

// Module-level repository injection point
let registryV2Repo: RegistryV2Repository | null = null;

export function setRegistryV2Repository(repo: RegistryV2Repository) {
  registryV2Repo = repo;
}

function requireRepo(): RegistryV2Repository {
  if (!registryV2Repo) {
    throw new Error('[registry-v2] Repository not configured. Call setRegistryV2Repository() with a concrete adapter.');
  }
  return registryV2Repo;
}

// 3) Validation / normalization helpers

const HASH_HEX_RE = /^[0-9a-f]{64}$/; // lowercase hex only, no prefix

function validateContentHash(hex: string): string {
  const v = (hex || '').trim();
  if (!HASH_HEX_RE.test(v)) {
    throw new Error('Invalid contentHash: expected 64-char lowercase hex without prefix');
  }
  return v;
}

function validateSemverLike(version: string): string {
  const v = (version || '').trim();
  if (!isValidSemverLike(v)) {
    throw new Error('Invalid version: expected semver-like string');
  }
  return v;
}

function ensureLeadingSlash(p: string): string {
  if (!p) return '/';
  return p.startsWith('/') ? p : `/${p}`;
}

function normalizeEndpoints(endpoints: Array<{ method: string; path: string; handler: string }>): Array<{ method: string; path: string; handler: string }> {
  const eps = Array.isArray(endpoints) ? endpoints : [];
  return eps.map((e) => ({
    method: String(e.method || '').toUpperCase(),
    path: ensureLeadingSlash(String(e.path || '').replace(/\/{2,}/g, '/').replace(/^\.\//, '')),
    handler: String(e.handler || '').replace(/\/{2,}/g, '/').replace(/^\.\//, ''),
  }));
}

function normalizeCapabilities(capabilities?: string[]): string[] {
  if (!Array.isArray(capabilities)) return [];
  return capabilities.filter((c) => typeof c === 'string' && c.trim().length > 0);
}

// 4) Service methods (exported)

export async function getExtensionByNamePublisher(name: string, publisher?: string): Promise<ExtensionRecord | null> {
  const repo = requireRepo();
  return repo.extensions.findByNamePublisher(name, publisher);
}

export async function createExtensionIfMissing(input: CreateExtensionIfMissingInput): Promise<ExtensionRecord> {
  const repo = requireRepo();
  const name = (input.name || '').trim();
  const publisher = typeof input.publisher === 'string' ? input.publisher.trim() : undefined;
  if (!name) throw new Error("Missing required 'name'");
  // Find by unique (name,publisher)
  const existing = await repo.extensions.findByNamePublisher(name, publisher);
  if (existing) return existing;
  // Create
  // TODO: handle unique race with retry if underlying DB throws unique violation
  return repo.extensions.create({ name, publisher });
}

export async function createExtensionVersion(input: CreateExtensionVersionInput): Promise<ExtensionVersionRecord> {
  const repo = requireRepo();
  const extensionId = (input.extensionId || '').trim();
  if (!extensionId) throw new Error("Missing required 'extensionId'");

  const version = validateSemverLike(input.version);
  const contentHash = validateContentHash(input.contentHash);
  const runtime = (input.runtime || '').trim();
  if (!runtime) throw new Error("Missing required 'runtime'");

  const endpoints = normalizeEndpoints(input.endpoints || []);
  const capabilities = normalizeCapabilities(input.capabilities);
  const uiEntry = input.uiEntry ? String(input.uiEntry).trim() || undefined : undefined;
  const ui = input.ui
    ? {
        type: 'iframe' as const,
        entry: String(input.ui.entry).trim(),
        hooks: input.ui.hooks && typeof input.ui.hooks === 'object' ? input.ui.hooks : undefined,
      }
    : undefined;
  const signature = input.signature
    ? {
        required: !!input.signature.required,
        verified: !!input.signature.verified,
        algorithm: input.signature.algorithm,
        subject: input.signature.subject,
        issuer: input.signature.issuer,
        timestamp: input.signature.timestamp,
        reason: input.signature.reason,
      }
    : undefined;

  // Idempotency on (extensionId, version)
  const exists = await repo.versions.findByExtensionAndVersion(extensionId, version);
  if (exists) {
    return exists;
  }

  // Allow same contentHash under different versions (no uniqueness by hash)
  const createInput: Omit<ExtensionVersionRecord, 'id' | 'createdAt'> = {
    extensionId,
    version,
    contentHash,
    runtime,
    ui,
    uiEntry,
    endpoints,
    capabilities,
    signature,
  };
  return repo.versions.create(createInput);
}

export async function getExtensionVersionByHash(contentHash: string): Promise<ExtensionVersionRecord | null> {
  const repo = requireRepo();
  const ch = validateContentHash(contentHash);
  return repo.versions.findByHash(ch);
}

export async function getLatestVersionForExtension(extensionId: string): Promise<ExtensionVersionRecord | null> {
  const repo = requireRepo();
  const id = (extensionId || '').trim();
  if (!id) throw new Error("Missing required 'extensionId'");
  return repo.versions.findLatestForExtension(id);
}

// 5) Higher-level helper for finalize flow

export interface UpsertVersionFromManifestInput {
  manifest: ManifestV2;
  contentHash: string;
  parsed: {
    ui?: {
      type: 'iframe';
      entry: string;
      hooks?: { appMenu?: { label: string }; clientPortalMenu?: { label: string }; [key: string]: unknown };
    };
    uiEntry?: string;
    endpoints: ManifestEndpoint[];
    runtime: string;
    capabilities: string[];
  };
  signature: SignatureVerificationResult;
}

export async function upsertVersionFromManifest(
  input: UpsertVersionFromManifestInput
): Promise<{ extension: ExtensionRecord; version: ExtensionVersionRecord }> {
  const { manifest, contentHash, parsed, signature } = input;

  // Ensure extension registry record exists
  const extension = await createExtensionIfMissing({
    name: manifest.name,
    publisher: manifest.publisher,
  });

  // Prepare signature payload mapping
  const sig = {
    required: !!signature.required,
    verified: !!signature.verified,
    algorithm: signature.algorithm,
    subject: signature.subject,
    issuer: signature.issuer,
    timestamp: signature.timestamp,
    reason: signature.reason,
  } as CreateExtensionVersionInput['signature'];

  // Create version; enforce uniqueness on (extensionId, version). If it exists, attach new bundle if needed.
  const repo = requireRepo();
  const existing = await repo.versions.findByExtensionAndVersion(extension.id, manifest.version);
  if (existing) {
    const want = validateContentHash(contentHash);
    if (existing.contentHash !== want) {
      // Attach new bundle row to this version (idempotent if same content_hash already present)
      await (repo as any).attachBundle?.(existing.id, { contentHash: `sha256:${want}` });
      // Re-read latest mapping for this version
      const newest = await repo.versions.findByExtensionAndVersion(extension.id, manifest.version);
      return { extension, version: newest || existing };
    }
    return { extension, version: existing };
  }

  const versionRecord = await createExtensionVersion({
    extensionId: extension.id,
    version: manifest.version,
    contentHash,
    runtime: parsed.runtime,
    ui: parsed.ui,
    uiEntry: parsed.uiEntry,
    endpoints: normalizeEndpoints(parsed.endpoints as Array<{ method: string; path: string; handler: string }>),
    capabilities: normalizeCapabilities(parsed.capabilities),
    signature: sig,
  });

  return { extension, version: versionRecord };
}

// ===== End M1 additions =====
