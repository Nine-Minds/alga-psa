import type { Knex } from 'knex';
import {
  type ExtensionRecord,
  type ExtensionVersionRecord,
  setRegistryV2Repository,
} from './registry-v2';

function uuid(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? '';
  } catch {
    return '';
  }
}

function stripSha256Prefix(h?: string | null): string | undefined {
  if (!h) return undefined;
  const v = String(h);
  if (v.startsWith('sha256:')) return v.slice('sha256:'.length);
  return v;
}

function withSha256Prefix(h: string): string {
  return h.startsWith('sha256:') ? h : `sha256:${h}`;
}

export function registerRegistryV2KnexRepo(knex: Knex) {
  const extensions = {
    async findByNamePublisher(name: string, publisher?: string): Promise<ExtensionRecord | null> {
      const q = knex('extension_registry').modify((qb) => {
        qb.where({ name });
        if (publisher) qb.andWhere({ publisher });
      });
      const row = await q.first(['id', 'name', 'publisher', 'created_at']);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        publisher: row.publisher ?? undefined,
        createdAt: row.created_at ?? new Date(),
      } as ExtensionRecord;
    },

    async create(input: { name: string; publisher?: string }): Promise<ExtensionRecord> {
      const id = uuid();
      const row: any = {
        id: id || undefined,
        name: input.name,
        publisher: input.publisher ?? null,
        display_name: null,
        description: null,
      };
      const cols = ['id', 'name', 'publisher', 'created_at'] as const;
      const [ins] = await knex('extension_registry').insert(row).returning(cols as any);
      return {
        id: ins.id,
        name: ins.name,
        publisher: ins.publisher ?? undefined,
        createdAt: ins.created_at ?? new Date(),
      } as ExtensionRecord;
    },
  };

  const versions = {
    async findByExtensionAndVersion(extensionId: string, version: string): Promise<ExtensionVersionRecord | null> {
      const v = await knex('extension_version')
        .where({ registry_id: extensionId, version })
        .first(['id', 'registry_id', 'version', 'runtime', 'main_entry', 'api_endpoints', 'ui', 'capabilities', 'created_at']);
      if (!v) return null;
      const b = await knex('extension_bundle')
        .where({ version_id: v.id })
        .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'content_hash', order: 'desc' }])
        .first(['content_hash']);
      return {
        id: v.id,
        extensionId: v.registry_id,
        version: v.version,
        contentHash: stripSha256Prefix(b?.content_hash) ?? '',
        runtime: v.runtime,
        uiEntry: typeof v.ui === 'string' ? (JSON.parse(v.ui) as any)?.entry ?? undefined : (v.ui as any)?.entry ?? undefined,
        endpoints: Array.isArray(v.api_endpoints) ? v.api_endpoints : JSON.parse(v.api_endpoints || '[]'),
        capabilities: Array.isArray(v.capabilities) ? v.capabilities : JSON.parse(v.capabilities || '[]'),
        createdAt: v.created_at ?? new Date(),
      } as any;
    },

    async findByHash(contentHash: string): Promise<ExtensionVersionRecord | null> {
      const prefixed = withSha256Prefix(contentHash);
      const b = await knex('extension_bundle')
        .where({ content_hash: prefixed })
        .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'content_hash', order: 'desc' }])
        .first(['version_id', 'content_hash']);
      if (!b) return null;
      const v = await knex('extension_version')
        .where({ id: b.version_id })
        .first(['id', 'registry_id', 'version', 'runtime', 'main_entry', 'api_endpoints', 'ui', 'capabilities', 'created_at']);
      if (!v) return null;
      return {
        id: v.id,
        extensionId: v.registry_id,
        version: v.version,
        contentHash: stripSha256Prefix(b.content_hash) ?? contentHash,
        runtime: v.runtime,
        uiEntry: typeof v.ui === 'string' ? (JSON.parse(v.ui) as any)?.entry ?? undefined : (v.ui as any)?.entry ?? undefined,
        endpoints: Array.isArray(v.api_endpoints) ? v.api_endpoints : JSON.parse(v.api_endpoints || '[]'),
        capabilities: Array.isArray(v.capabilities) ? v.capabilities : JSON.parse(v.capabilities || '[]'),
        createdAt: v.created_at ?? new Date(),
      } as any;
    },

    async findLatestForExtension(extensionId: string): Promise<ExtensionVersionRecord | null> {
      const v = await knex('extension_version')
        .where({ registry_id: extensionId })
        .orderBy('created_at', 'desc')
        .first(['id', 'registry_id', 'version', 'runtime', 'main_entry', 'api_endpoints', 'ui', 'capabilities', 'created_at']);
      if (!v) return null;
      const b = await knex('extension_bundle')
        .where({ version_id: v.id })
        .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'content_hash', order: 'desc' }])
        .first(['content_hash']);
      return {
        id: v.id,
        extensionId: v.registry_id,
        version: v.version,
        contentHash: stripSha256Prefix(b?.content_hash) ?? '',
        runtime: v.runtime,
        uiEntry: typeof v.ui === 'string' ? (JSON.parse(v.ui) as any)?.entry ?? undefined : (v.ui as any)?.entry ?? undefined,
        endpoints: Array.isArray(v.api_endpoints) ? v.api_endpoints : JSON.parse(v.api_endpoints || '[]'),
        capabilities: Array.isArray(v.capabilities) ? v.capabilities : JSON.parse(v.capabilities || '[]'),
        createdAt: v.created_at ?? new Date(),
      } as any;
    },

    async listVersionStringsForExtension(extensionId: string): Promise<string[]> {
      const rows = await knex('extension_version')
        .where({ registry_id: extensionId })
        .select(['version']);
      return rows.map((r: any) => r.version as string);
    },

    async create(input: Omit<ExtensionVersionRecord, 'id' | 'createdAt'>): Promise<ExtensionVersionRecord> {
      const id = uuid();
      const now = knex.fn.now();
      const vRow: any = {
        id: id || undefined,
        registry_id: input.extensionId,
        version: input.version,
        runtime: input.runtime,
        main_entry: input.uiEntry || 'main',
        api_endpoints: JSON.stringify(input.endpoints ?? []),
        ui: input.ui ? JSON.stringify(input.ui) : (input.uiEntry ? JSON.stringify({ entry: input.uiEntry }) : null),
        capabilities: JSON.stringify(input.capabilities ?? []),
      };
      const vCols = ['id', 'registry_id', 'version', 'runtime', 'main_entry', 'api_endpoints', 'ui', 'capabilities', 'created_at'] as const;
      const [v] = await knex('extension_version').insert(vRow).returning(vCols as any);

      const contentHashHex = stripSha256Prefix(input.contentHash) ?? '';
      if (contentHashHex) {
        const bRow: any = {
          id: uuid() || undefined,
          version_id: v.id,
          content_hash: withSha256Prefix(contentHashHex),
          signature: null,
          precompiled: null,
          storage_url: null,
          size_bytes: null,
        };
        await knex('extension_bundle').insert(bRow);
      }

      // Materialize endpoints into normalized table for strong references (best-effort / idempotent).
      try {
        const endpoints = Array.isArray(input.endpoints) ? input.endpoints : [];
        if (endpoints.length > 0) {
          const normalizePath = (p: string) => {
            const raw = String(p || '').trim();
            if (!raw) return '/';
            const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
            return withSlash.replace(/\/{2,}/g, '/');
          };
          const rows = endpoints
            .map((e) => ({
              version_id: v.id,
              method: String((e as any).method || '').toUpperCase(),
              path: normalizePath(String((e as any).path || '')),
              handler: String((e as any).handler || ''),
              updated_at: now,
            }))
            .filter((row) => row.method && row.path && row.handler);
          if (rows.length > 0) {
            await knex('extension_api_endpoint')
              .insert(rows)
              .onConflict(['version_id', 'method', 'path'])
              .merge({ handler: knex.raw('excluded.handler'), updated_at: now });
          }
        }
      } catch (error: any) {
        // eslint-disable-next-line no-console
        console.warn('[registry-v2-repo-knex] failed to materialize extension_api_endpoint rows', {
          versionId: v.id,
          extensionId: input.extensionId,
          error: error?.message ?? String(error),
        });
      }

      return {
        id: v.id,
        extensionId: v.registry_id,
        version: v.version,
        contentHash: contentHashHex,
        runtime: v.runtime,
        ui: typeof v.ui === 'string' ? JSON.parse(v.ui) : v.ui ?? undefined,
        uiEntry: input.uiEntry,
        endpoints: Array.isArray(v.api_endpoints) ? v.api_endpoints : JSON.parse(v.api_endpoints || '[]'),
        capabilities: Array.isArray(v.capabilities) ? v.capabilities : JSON.parse(v.capabilities || '[]'),
        createdAt: v.created_at ?? new Date(),
      } as any;
    },
  };

  // Expose attachBundle on the repo object used by upsertVersionFromManifest
  const attachBundle = async (versionId: string, b: { contentHash: string; signature?: string; precompiled?: any }) => {
    await knex('extension_bundle').insert({
      id: uuid() || undefined,
      version_id: versionId,
      content_hash: b.contentHash,
      signature: b.signature ?? null,
      precompiled: b.precompiled ? JSON.stringify(b.precompiled) : null,
      storage_url: null,
      size_bytes: null,
    });
  };

  setRegistryV2Repository({ extensions, versions, attachBundle } as any);
}

let registered = false;
export async function ensureRegistryV2KnexRepo(getKnex: () => Promise<Knex>) {
  if (registered) return;
  const knex = await getKnex();
  registerRegistryV2KnexRepo(knex);
  registered = true;
}
