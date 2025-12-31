import Ajv, { ValidateFunction } from 'ajv';
import type { Knex } from 'knex';
import {
  StorageBulkPutRequest,
  StorageBulkPutResponse,
  StorageDeleteRequest,
  StorageGetRequest,
  StorageGetResponse,
  StorageListRequest,
  StorageListResponse,
  StoragePutRequest,
  StoragePutResponse,
  StorageQuota,
} from './types';
import type { JsonValue } from './types';
import {
  StorageLimitError,
  StorageQuotaError,
  StorageRevisionMismatchError,
  StorageServiceError,
  StorageValidationError,
} from './errors';
import { encodeJsonb } from './json';

type NamespaceRecord = {
  tenant: string;
  extension_install_id: string;
  namespace: string;
  key: string;
  revision: number;
  value: unknown;
  metadata: Record<string, unknown>;
  ttl_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  value_size_bytes: number;
  metadata_size_bytes: number;
};

type UsageRow = {
  bytes_used: string | number | null;
  keys_count: string | number | null;
  namespaces_count: string | number | null;
};

type SchemaRow = {
  schema_version: number;
  schema_document: unknown;
};

const DEFAULT_QUOTA: StorageQuota = {
  maxNamespaces: 32,
  maxKeysPerNamespace: 5120,
  maxValueBytes: 64 * 1024,
  maxMetadataBytes: 4 * 1024,
  maxBulkPayloadBytes: 512 * 1024,
  maxBulkItems: 20,
  totalBytes: 256 * 1024 * 1024,
};

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const ajv = new Ajv({
  strict: false,
  allErrors: true,
  validateFormats: false,
});

function assertNamespace(namespace: string) {
  if (!namespace || namespace.length > 128) {
    throw new StorageValidationError('namespace must be 1-128 characters');
  }
}

function assertKey(key: string) {
  if (!key || key.length > 256 || key.includes('/')) {
    throw new StorageValidationError('key must be 1-256 characters and must not contain "/"');
  }
}

function assertMetadata(metadata: unknown) {
  if (metadata === undefined) {
    return;
  }
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new StorageValidationError('metadata must be a JSON object');
  }
}

function computeTtl(ttlSeconds?: number | null): Date | null {
  if (ttlSeconds === undefined || ttlSeconds === null) {
    return null;
  }
  if (!Number.isFinite(ttlSeconds)) {
    throw new StorageValidationError('ttlSeconds must be numeric');
  }
  if (ttlSeconds < MIN_TTL_SECONDS) {
    throw new StorageLimitError(`ttlSeconds must be >= ${MIN_TTL_SECONDS}`);
  }
  if (ttlSeconds > MAX_TTL_SECONDS) {
    throw new StorageLimitError(`ttlSeconds must be <= ${MAX_TTL_SECONDS}`);
  }
  return new Date(Date.now() + ttlSeconds * 1000);
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function decodeCount(row: { count?: string | number } | undefined): number {
  if (!row || row.count === undefined || row.count === null) {
    return 0;
  }
  return Number(row.count);
}

function encodeCursor(key: string): string {
  return Buffer.from(JSON.stringify({ key }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): { key: string } | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed.key !== 'string') {
      throw new StorageValidationError('cursor is invalid or corrupted');
    }
    return { key: parsed.key };
  } catch {
    throw new StorageValidationError('cursor is invalid or corrupted');
  }
}

export class ExtensionStorageServiceV2 {
  private readonly tenantId: string;
  private readonly extensionInstallId: string;
  private readonly knex: Knex;
  private readonly quota: StorageQuota;
  private readonly validatorCache: Map<string, ValidateFunction>;

  constructor(knex: Knex, tenantId: string, extensionInstallId: string, quota: StorageQuota = DEFAULT_QUOTA) {
    this.knex = knex;
    this.tenantId = tenantId;
    this.extensionInstallId = extensionInstallId;
    this.quota = quota;
    this.validatorCache = new Map();
  }

  async put(request: StoragePutRequest): Promise<StoragePutResponse> {
    assertNamespace(request.namespace);
    assertKey(request.key);
    assertMetadata(request.metadata);

    return this.knex.transaction(async (trx) => {
      const ttlExpiresAt = computeTtl(request.ttlSeconds);
      const valueSize = byteLength(request.value);
      const valueJson = encodeJsonb(request.value);
      const metadataValue = request.metadata ?? {};
      const metadataSize = byteLength(metadataValue);

      if (valueSize > this.quota.maxValueBytes) {
        throw new StorageLimitError(`value exceeds max size of ${this.quota.maxValueBytes} bytes`);
      }
      if (metadataSize > this.quota.maxMetadataBytes) {
        throw new StorageLimitError(`metadata exceeds max size of ${this.quota.maxMetadataBytes} bytes`);
      }

      await this.cleanupExpired(trx);
      await this.validateAgainstSchema(trx, request.namespace, request.value, request.schemaVersion);

      const existing = await trx<NamespaceRecord>('ext_storage_records')
        .where({
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
          key: request.key,
        })
        .forUpdate()
        .first();

      if (request.ifRevision !== undefined) {
        if (!existing || Number(existing.revision) !== request.ifRevision) {
          throw new StorageRevisionMismatchError('ifRevision did not match stored revision');
        }
      }

      const usageRow = await this.getUsageForUpdate(trx);
      const namespaceCountRow = await trx('ext_storage_records')
        .where({
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
        })
        .count<{ count: string }>('key as count')
        .first();
      const namespaceKeyCount = decodeCount(namespaceCountRow);

      const isInsert = !existing;
      if (isInsert && namespaceKeyCount >= this.quota.maxKeysPerNamespace) {
        throw new StorageQuotaError(`namespace ${request.namespace} exceeded key quota`);
      }
      if (isInsert && namespaceKeyCount === 0 && usageRow.namespacesCount >= this.quota.maxNamespaces) {
        throw new StorageQuotaError('namespace quota exceeded');
      }

      const previousBytes = existing
        ? Number(existing.value_size_bytes ?? 0) + Number(existing.metadata_size_bytes ?? 0)
        : 0;
      const deltaBytes = valueSize + metadataSize - previousBytes;
      if (usageRow.bytesUsed + deltaBytes > this.quota.totalBytes) {
        throw new StorageQuotaError('total storage quota exceeded', {
          limit: this.quota.totalBytes,
          attempted: usageRow.bytesUsed + deltaBytes,
        });
      }

      const now = new Date();
      const revision = existing ? Number(existing.revision) + 1 : 1;
      const insertRow = {
        tenant: this.tenantId,
        extension_install_id: this.extensionInstallId,
        namespace: request.namespace,
        key: request.key,
        revision,
        value: valueJson,
        metadata: metadataValue,
        ttl_expires_at: ttlExpiresAt,
        created_at: existing ? existing.created_at : now,
        updated_at: now,
        value_size_bytes: valueSize,
        metadata_size_bytes: metadataSize,
      };

      const [row] = await trx('ext_storage_records')
        .insert(insertRow)
        .onConflict(['tenant', 'extension_install_id', 'namespace', 'key'])
        .merge({
          revision,
          value: valueJson,
          metadata: metadataValue,
          ttl_expires_at: ttlExpiresAt,
          updated_at: now,
          value_size_bytes: valueSize,
          metadata_size_bytes: metadataSize,
        })
        .returning(['namespace', 'key', 'revision', 'ttl_expires_at', 'created_at', 'updated_at']);

      await this.refreshUsage(trx);

      return {
        namespace: row.namespace,
        key: row.key,
        revision: Number(row.revision),
        ttlExpiresAt: row.ttl_expires_at,
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
      };
    });
  }

  async bulkPut(request: StorageBulkPutRequest): Promise<StorageBulkPutResponse> {
    assertNamespace(request.namespace);
    if (!Array.isArray(request.items) || request.items.length === 0) {
      throw new StorageValidationError('items must contain at least one entry');
    }
    if (request.items.length > this.quota.maxBulkItems) {
      throw new StorageLimitError(`bulk operations limited to ${this.quota.maxBulkItems} items`);
    }

    const keys = new Set<string>();
    const schemaVersions = new Set<number>();
    let totalPayloadBytes = 0;
    for (const item of request.items) {
      assertKey(item.key);
      assertMetadata(item.metadata);
      if (keys.has(item.key)) {
        throw new StorageValidationError(`duplicate key in bulk payload: ${item.key}`);
      }
      keys.add(item.key);
       if (item.schemaVersion !== undefined && item.schemaVersion !== null) {
         schemaVersions.add(item.schemaVersion);
       }
      totalPayloadBytes += byteLength(item.value);
      totalPayloadBytes += byteLength(item.metadata ?? {});
    }
    if (totalPayloadBytes > this.quota.maxBulkPayloadBytes) {
      throw new StorageLimitError(
        `bulk payload exceeds ${this.quota.maxBulkPayloadBytes} bytes (actual ${totalPayloadBytes})`,
      );
    }
    if (schemaVersions.size > 1) {
      throw new StorageValidationError('all items in a bulk write must use the same schemaVersion');
    }
    const schemaVersion = schemaVersions.size === 1 ? [...schemaVersions][0] : undefined;

    return this.knex.transaction(async (trx) => {
      await this.cleanupExpired(trx);
      await this.validateAgainstSchema(
        trx,
        request.namespace,
        request.items.map((item) => item.value),
        schemaVersion,
      );

      const existingRows = await trx<NamespaceRecord>('ext_storage_records')
        .where({
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
        })
        .whereIn(
          'key',
          request.items.map((item) => item.key),
        )
        .forUpdate();
      const existingMap = new Map(existingRows.map((row) => [row.key, row]));

      // Enforce per-item optimistic concurrency if requested
      for (const item of request.items) {
        if (item.ifRevision !== undefined) {
          const existing = existingMap.get(item.key);
          if (!existing || Number(existing.revision) !== item.ifRevision) {
            throw new StorageRevisionMismatchError('ifRevision did not match stored revision');
          }
        }
      }

      const usageRow = await this.getUsageForUpdate(trx);
      const namespaceCountRow = await trx('ext_storage_records')
        .where({
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
        })
        .count<{ count: string }>('key as count')
        .first();
      const namespaceKeyCount = decodeCount(namespaceCountRow);

      const newKeys = request.items.filter((item) => !existingMap.has(item.key)).length;
      if (namespaceKeyCount + newKeys > this.quota.maxKeysPerNamespace) {
        throw new StorageQuotaError(`namespace ${request.namespace} exceeded key quota`);
      }
      if (namespaceKeyCount === 0 && newKeys > 0 && usageRow.namespacesCount >= this.quota.maxNamespaces) {
        throw new StorageQuotaError('namespace quota exceeded');
      }

      let totalDeltaBytes = 0;
      for (const item of request.items) {
        const valueBytes = byteLength(item.value);
        const metadataBytes = byteLength(item.metadata ?? {});
        if (valueBytes > this.quota.maxValueBytes) {
          throw new StorageLimitError(`value for key ${item.key} exceeds max size`);
        }
        if (metadataBytes > this.quota.maxMetadataBytes) {
          throw new StorageLimitError(`metadata for key ${item.key} exceeds max size`);
        }
        const existing = existingMap.get(item.key);
        const existingBytes = existing
          ? Number(existing.value_size_bytes ?? 0) + Number(existing.metadata_size_bytes ?? 0)
          : 0;
        totalDeltaBytes += valueBytes + metadataBytes - existingBytes;
      }
      if (usageRow.bytesUsed + totalDeltaBytes > this.quota.totalBytes) {
        throw new StorageQuotaError('total storage quota exceeded', {
          limit: this.quota.totalBytes,
          attempted: usageRow.bytesUsed + totalDeltaBytes,
        });
      }

      const now = new Date();
      const rows = request.items.map((item) => {
        const existing = existingMap.get(item.key);
        const ttlExpiresAt = computeTtl(item.ttlSeconds);
        return {
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
          key: item.key,
          revision: existing ? Number(existing.revision) + 1 : 1,
          value: encodeJsonb(item.value),
          metadata: item.metadata ?? {},
          ttl_expires_at: ttlExpiresAt,
          created_at: existing ? existing.created_at : now,
          updated_at: now,
          value_size_bytes: byteLength(item.value),
          metadata_size_bytes: byteLength(item.metadata ?? {}),
        };
      });

      const result = await trx('ext_storage_records')
        .insert(rows)
        .onConflict(['tenant', 'extension_install_id', 'namespace', 'key'])
        .merge({
          revision: trx.raw('excluded.revision'),
          value: trx.raw('excluded.value'),
          metadata: trx.raw('excluded.metadata'),
          ttl_expires_at: trx.raw('excluded.ttl_expires_at'),
          updated_at: now,
          value_size_bytes: trx.raw('excluded.value_size_bytes'),
          metadata_size_bytes: trx.raw('excluded.metadata_size_bytes'),
        })
        .returning(['key', 'revision', 'ttl_expires_at']);

      if (result.length !== rows.length) {
        throw new StorageServiceError('INTERNAL_ERROR', 'bulkPut returned unexpected row count');
      }

      await this.refreshUsage(trx);

      return {
        namespace: request.namespace,
        items: result.map((row) => ({
          key: row.key,
          revision: Number(row.revision),
          ttlExpiresAt: row.ttl_expires_at,
        })),
      };
    });
  }

  async delete(request: StorageDeleteRequest): Promise<boolean> {
    assertNamespace(request.namespace);
    assertKey(request.key);

    return this.knex.transaction(async (trx) => {
      await this.cleanupExpired(trx);

      const existing = await trx<NamespaceRecord>('ext_storage_records')
        .where({
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
          key: request.key,
        })
        .forUpdate()
        .first();

      if (!existing) {
        return false;
      }
      if (request.ifRevision !== undefined && Number(existing.revision) !== request.ifRevision) {
        throw new StorageRevisionMismatchError('ifRevision did not match stored revision');
      }

      await trx('ext_storage_records')
        .where({
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
          key: request.key,
        })
        .delete();

      await this.refreshUsage(trx);

      return true;
    });
  }

  async get(request: StorageGetRequest): Promise<StorageGetResponse> {
    assertNamespace(request.namespace);
    assertKey(request.key);

    return this.knex.transaction(async (trx) => {
      await this.cleanupExpired(trx);

      const row = await trx<NamespaceRecord>('ext_storage_records')
        .where({
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
          key: request.key,
        })
        .first();

      if (!row) {
        throw new StorageServiceError('NOT_FOUND', 'record not found');
      }

      if (request.ifRevision !== undefined && Number(row.revision) !== request.ifRevision) {
        throw new StorageRevisionMismatchError('ifRevision did not match stored revision');
      }

      return {
        namespace: row.namespace,
        key: row.key,
        revision: Number(row.revision),
        value: row.value as StorageGetResponse['value'],
        metadata: (row.metadata ?? {}) as Record<string, JsonValue>,
        ttlExpiresAt: row.ttl_expires_at,
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
      };
    });
  }

  async list(request: StorageListRequest): Promise<StorageListResponse> {
    assertNamespace(request.namespace);

    const limit = Math.min(Math.max(request.limit ?? 25, 1), 100);
    const includeValues = request.includeValues ?? false;
    const includeMetadata = request.includeMetadata ?? false;
    const cursorInfo = decodeCursor(request.cursor);

    return this.knex.transaction(async (trx) => {
      await this.cleanupExpired(trx);

      let query = trx<NamespaceRecord>('ext_storage_records')
        .where({
          tenant: this.tenantId,
          extension_install_id: this.extensionInstallId,
          namespace: request.namespace,
        })
        .orderBy('key', 'asc')
        .limit(limit + 1);

      if (request.keyPrefix) {
        // Escape SQL LIKE wildcards in user-supplied prefix, relying on default escape '\\'
        const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const pattern = `${esc(request.keyPrefix)}%`;
        query = query.andWhere('key', 'like', pattern);
      }

      if (cursorInfo?.key) {
        query = query.andWhere('key', '>', cursorInfo.key);
      }

      const rows = await query;
      const items = rows.slice(0, limit).map((row) => ({
        tenantId: this.tenantId,
        extensionInstallId: this.extensionInstallId,
        namespace: row.namespace,
        key: row.key,
        revision: Number(row.revision),
        value: includeValues ? (row.value as JsonValue) : undefined,
        metadata: includeMetadata ? ((row.metadata ?? {}) as Record<string, JsonValue>) : undefined,
        ttlExpiresAt: row.ttl_expires_at,
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
      }));

      const nextCursor =
        rows.length > limit ? encodeCursor(rows[limit].key) : null;

      return {
        items,
        nextCursor,
      };
    });
  }

  private async cleanupExpired(trx: Knex.Transaction): Promise<void> {
    const deleted = await trx('ext_storage_records')
      .where({
        tenant: this.tenantId,
        extension_install_id: this.extensionInstallId,
      })
      .whereNotNull('ttl_expires_at')
      .andWhere('ttl_expires_at', '<=', trx.fn.now())
      .delete();

    if (deleted > 0) {
      await this.refreshUsage(trx);
    }
  }

  private async refreshUsage(trx: Knex.Transaction) {
    const row = await trx('ext_storage_records')
      .where({
        tenant: this.tenantId,
        extension_install_id: this.extensionInstallId,
      })
      .select({
        bytes_used: trx.raw('COALESCE(SUM(value_size_bytes + metadata_size_bytes), 0)'),
        keys_count: trx.raw('COUNT(*)'),
        namespaces_count: trx.raw('COUNT(DISTINCT namespace)'),
      })
      .first<UsageRow>();

    const bytesUsed = Number(row?.bytes_used ?? 0);
    const keysCount = Number(row?.keys_count ?? 0);
    const namespacesCount = Number(row?.namespaces_count ?? 0);

    await trx('ext_storage_usage')
      .insert({
        tenant: this.tenantId,
        extension_install_id: this.extensionInstallId,
        bytes_used: bytesUsed,
        keys_count: keysCount,
        namespaces_count: namespacesCount,
        updated_at: trx.fn.now(),
      })
      .onConflict(['tenant', 'extension_install_id'])
      .merge({
        bytes_used: bytesUsed,
        keys_count: keysCount,
        namespaces_count: namespacesCount,
        updated_at: trx.fn.now(),
      });
  }

  private async getUsageForUpdate(trx: Knex.Transaction) {
    // Ensure a usage row exists, then lock it
    await trx('ext_storage_usage')
      .insert({
        tenant: this.tenantId,
        extension_install_id: this.extensionInstallId,
        bytes_used: 0,
        keys_count: 0,
        namespaces_count: 0,
        updated_at: trx.fn.now(),
      })
      .onConflict(['tenant', 'extension_install_id'])
      .ignore();

    const row = await trx('ext_storage_usage')
      .where({
        tenant: this.tenantId,
        extension_install_id: this.extensionInstallId,
      })
      .forUpdate()
      .first<UsageRow>();

    return {
      bytesUsed: Number(row?.bytes_used ?? 0),
      keysCount: Number(row?.keys_count ?? 0),
      namespacesCount: Number(row?.namespaces_count ?? 0),
    };
  }

  private async validateAgainstSchema(
    trx: Knex.Transaction,
    namespace: string,
    payload: unknown,
    requestedSchemaVersion?: number | null,
  ): Promise<void> {
    const schema = await this.fetchSchema(trx, namespace, requestedSchemaVersion);
    if (!schema) {
      return;
    }

    const cacheKey = `${namespace}:${schema.schema_version}`;
    let validator = this.validatorCache.get(cacheKey);
    if (!validator) {
      validator = ajv.compile(schema.schema_document as any);
      this.validatorCache.set(cacheKey, validator);
    }

    const values = Array.isArray(payload) ? payload : [payload];
    for (const value of values) {
      const ok = validator(value);
      if (!ok) {
        throw new StorageValidationError('payload failed schema validation', validator.errors);
      }
    }
  }

  private async fetchSchema(
    trx: Knex.Transaction,
    namespace: string,
    requestedSchemaVersion?: number | null,
  ): Promise<SchemaRow | null> {
    const query = trx('ext_storage_schemas')
      .select(['schema_version', 'schema_document'])
      .where({
        tenant: this.tenantId,
        extension_install_id: this.extensionInstallId,
        namespace,
      })
      .andWhere('status', '=', 'active')
      .orderBy('schema_version', 'desc');

    if (requestedSchemaVersion !== undefined && requestedSchemaVersion !== null) {
      query.andWhere('schema_version', '=', requestedSchemaVersion);
    }

    const row = await query.first<SchemaRow>();
    return row ?? null;
  }
}
