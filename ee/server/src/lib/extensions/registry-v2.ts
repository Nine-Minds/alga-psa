// EE-only registry service v2 (Knex-backed)
import type { Knex } from 'knex';

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
    try {
      const row = {
        registry_id: entryId,
        version: v.version,
        runtime: v.runtime,
        main_entry: v.mainEntry,
        capabilities: JSON.stringify(v.capabilities ?? []),
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
      .first(['id']);
    if (!v) {
      throw new Error('Version not found for provided registry/version');
    }

    const now = this.db.fn.now();
    const payload = {
      tenant_id: tenantId,
      registry_id: registryId,
      version_id: v.id,
      status: 'enabled',
      granted_caps: JSON.stringify(opts?.grantedCaps ?? []),
      config: JSON.stringify(opts?.config ?? {}),
      is_enabled: true,
      created_at: now,
      updated_at: now,
    };

    await this.db('tenant_extension_install')
      .insert(payload)
      .onConflict(['tenant_id', 'registry_id'])
      .merge({
        version_id: payload.version_id,
        status: payload.status,
        granted_caps: payload.granted_caps,
        config: payload.config,
        is_enabled: payload.is_enabled,
        updated_at: payload.updated_at,
      });

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
      .orderBy('created_at', 'desc')
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

