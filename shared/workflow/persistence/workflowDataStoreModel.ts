import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type WorkflowDataStoreValue = unknown;

export type WorkflowDataStoreRecord = {
  tenant: string;
  store_id: string;
  namespace: string;
  key: string;
  value: WorkflowDataStoreValue;
  value_type: 'string' | 'number' | 'boolean' | 'json' | string;
  revision: number | string;
  expires_at?: string | null;
  created_by_run_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowDataStoreSetInput = {
  namespace: string;
  key: string;
  value: WorkflowDataStoreValue;
  value_type?: WorkflowDataStoreRecord['value_type'];
  expires_at?: string | Date | null;
  created_by_run_id?: string | null;
  if_revision?: number;
};

export type WorkflowDataStoreSetResult = {
  record: WorkflowDataStoreRecord | null;
  created: boolean;
  conflict: boolean;
};

export type WorkflowDataStoreListOptions = {
  prefix?: string;
  limit?: number;
  cursor?: number | string | null;
};

export type WorkflowDataStoreListResult = {
  items: WorkflowDataStoreRecord[];
  next_cursor: number | null;
};

export type WorkflowDataStoreNamespace = {
  namespace: string;
  key_count: number;
};

const TABLE = 'workflow_data_store';
const UNIQUE_COLUMNS = ['tenant', 'namespace', 'key'];
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

const nowIso = () => new Date().toISOString();

const normalizeTimestamp = (value?: string | Date | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

const normalizeLimit = (limit?: number): number => {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit as number)));
};

const normalizeCursor = (cursor?: number | string | null): number => {
  const parsed = typeof cursor === 'string' ? Number.parseInt(cursor, 10) : cursor;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.trunc(parsed as number) : 0;
};

const normalizeRevision = (record: WorkflowDataStoreRecord): WorkflowDataStoreRecord => ({
  ...record,
  revision: Number(record.revision),
});

const encodeJsonbValue = (value: WorkflowDataStoreValue): string => (
  JSON.stringify(value === undefined ? null : value)
);

const activeRows = (query: Knex.QueryBuilder): void => {
  query.where((builder) => {
    builder.whereNull('expires_at').orWhere('expires_at', '>', nowIso());
  });
};

function workflowDataStore(
  knex: Knex,
  tenant: string,
): Knex.QueryBuilder<WorkflowDataStoreRecord, WorkflowDataStoreRecord[]> {
  return tenantDb(knex, tenant).table<WorkflowDataStoreRecord>(TABLE);
}

const WorkflowDataStoreModel = {
  get: async (
    knex: Knex,
    tenant: string,
    namespace: string,
    key: string
  ): Promise<WorkflowDataStoreRecord | null> => {
    const record = await workflowDataStore(knex, tenant)
      .where({ namespace, key })
      .first();

    if (!record) return null;
    if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
      await workflowDataStore(knex, tenant).where({ store_id: record.store_id }).delete();
      return null;
    }
    return normalizeRevision(record);
  },

  set: async (
    knex: Knex,
    tenant: string,
    input: WorkflowDataStoreSetInput
  ): Promise<WorkflowDataStoreSetResult> => {
    const timestamp = nowIso();
    const insertData = {
      tenant,
      namespace: input.namespace,
      key: input.key,
      value: encodeJsonbValue(input.value),
      value_type: input.value_type ?? 'json',
      revision: 1,
      expires_at: normalizeTimestamp(input.expires_at),
      created_by_run_id: input.created_by_run_id ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    const inserted = await workflowDataStore(knex, tenant)
      .insert(insertData)
      .onConflict(UNIQUE_COLUMNS)
      .ignore()
      .returning('*');

    if (inserted[0]) {
      return { record: normalizeRevision(inserted[0]), created: true, conflict: false };
    }

    if (input.if_revision === 0) {
      return { record: null, created: false, conflict: true };
    }

    const query = workflowDataStore(knex, tenant).where({
      namespace: input.namespace,
      key: input.key,
    });
    if (input.if_revision !== undefined) {
      query.andWhere({ revision: input.if_revision });
    }

    const [record] = await query
      .update({
        value: encodeJsonbValue(input.value),
        value_type: input.value_type ?? 'json',
        expires_at: normalizeTimestamp(input.expires_at),
        revision: knex.raw('revision + 1'),
        updated_at: timestamp,
      })
      .returning('*');

    if (!record) {
      return { record: null, created: false, conflict: true };
    }

    return { record: normalizeRevision(record), created: false, conflict: false };
  },

  delete: async (knex: Knex, tenant: string, namespace: string, key: string): Promise<boolean> => {
    const deleted = await workflowDataStore(knex, tenant)
      .where({ namespace, key })
      .delete();
    return deleted > 0;
  },

  increment: async (
    knex: Knex,
    tenant: string,
    input: {
      namespace: string;
      key: string;
      by?: number;
      initial?: number;
      expires_at?: string | Date | null;
      created_by_run_id?: string | null;
    }
  ): Promise<{ record: WorkflowDataStoreRecord; created: boolean }> => {
    const by = input.by ?? 1;
    const initial = input.initial ?? 0;
    const timestamp = nowIso();
    const result = await knex.raw(
      `
        INSERT INTO workflow_data_store (
          tenant, namespace, key, value, value_type, revision, expires_at,
          created_by_run_id, created_at, updated_at
        )
        VALUES (
          ?, ?, ?, to_jsonb((?::numeric + ?::numeric)), 'number', 1, ?, ?, ?, ?
        )
        ON CONFLICT (tenant, namespace, key)
        DO UPDATE SET
          value = to_jsonb(((workflow_data_store.value::text)::numeric + ?::numeric)),
          value_type = 'number',
          revision = workflow_data_store.revision + 1,
          updated_at = EXCLUDED.updated_at
        WHERE jsonb_typeof(workflow_data_store.value) = 'number'
        RETURNING *, (xmax = 0) AS created
      `,
      [
        tenant,
        input.namespace,
        input.key,
        initial,
        by,
        normalizeTimestamp(input.expires_at),
        input.created_by_run_id ?? null,
        timestamp,
        timestamp,
        by,
      ]
    );

    const row = result.rows?.[0];
    if (!row) {
      throw new Error('WORKFLOW_DATA_STORE_INCREMENT_REQUIRES_NUMERIC_VALUE');
    }

    const { created, ...record } = row;
    return {
      record: normalizeRevision(record as WorkflowDataStoreRecord),
      created: Boolean(created),
    };
  },

  list: async (
    knex: Knex,
    tenant: string,
    namespace: string,
    options: WorkflowDataStoreListOptions = {}
  ): Promise<WorkflowDataStoreListResult> => {
    const limit = normalizeLimit(options.limit);
    const cursor = normalizeCursor(options.cursor);
    const query = workflowDataStore(knex, tenant).where({ namespace });
    activeRows(query);
    if (options.prefix) {
      query.andWhere('key', 'like', `${options.prefix}%`);
    }

    const rows = await query
      .orderBy('key', 'asc')
      .orderBy('store_id', 'asc')
      .limit(limit + 1)
      .offset(cursor);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(normalizeRevision);

    return {
      items,
      next_cursor: hasMore ? cursor + limit : null,
    };
  },

  listNamespaces: async (knex: Knex, tenant: string): Promise<WorkflowDataStoreNamespace[]> => {
    const query = workflowDataStore(knex, tenant)
      .select('namespace')
      .count<{ key_count: string | number }[]>({ key_count: '*' })
      .groupBy('namespace')
      .orderBy('namespace', 'asc');
    activeRows(query);
    const rows = (await query) as Array<{ namespace: string; key_count: string | number }>;
    return rows.map((row) => ({
      namespace: row.namespace,
      key_count: Number(row.key_count),
    }));
  },

  deleteExpired: async (knex: Knex, tenant: string, limit = 1000): Promise<number> => {
    const expired = workflowDataStore(knex, tenant)
      .select('store_id')
      .whereNotNull('expires_at')
      .where('expires_at', '<=', nowIso())
      .orderBy('expires_at', 'asc')
      .orderBy('store_id', 'asc')
      .limit(Math.max(1, Math.trunc(limit)));

    const deletedRows = await workflowDataStore(knex, tenant)
      .whereIn('store_id', expired)
      .delete()
      .returning('store_id');

    return Array.isArray(deletedRows) ? deletedRows.length : Number(deletedRows ?? 0);
  },
};

export default WorkflowDataStoreModel;
