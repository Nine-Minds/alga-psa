import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type WorkflowEntityRef = {
  type: string;
  id: string;
};

export type WorkflowEntityLinkRecord = {
  tenant: string;
  link_id: string;
  namespace: string;
  left_type: string;
  left_id: string;
  right_type: string;
  right_id: string;
  relation: string;
  attributes: Record<string, unknown>;
  created_by_run_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowEntityLinkMatch = {
  link_id: string;
  type: string;
  id: string;
  relation: string;
  attributes: Record<string, unknown>;
};

export type WorkflowEntityLinkListOptions = {
  left_type?: string;
  right_type?: string;
  relation?: string;
  limit?: number;
  cursor?: number | string | null;
};

export type WorkflowEntityLinkListResult = {
  items: WorkflowEntityLinkRecord[];
  next_cursor: number | null;
};

export type WorkflowEntityLinkNamespace = {
  namespace: string;
  link_count: number;
};

const TABLE = 'workflow_entity_links';
const UNIQUE_COLUMNS = [
  'tenant',
  'namespace',
  'left_type',
  'left_id',
  'right_type',
  'right_id',
  'relation',
];
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

const nowIso = () => new Date().toISOString();

const normalizeLimit = (limit?: number): number => {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit as number)));
};

const normalizeCursor = (cursor?: number | string | null): number => {
  const parsed = typeof cursor === 'string' ? Number.parseInt(cursor, 10) : cursor;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.trunc(parsed as number) : 0;
};

const targetFromLeft = (row: WorkflowEntityLinkRecord): WorkflowEntityLinkMatch => ({
  link_id: row.link_id,
  type: row.right_type,
  id: row.right_id,
  relation: row.relation,
  attributes: row.attributes ?? {},
});

const targetFromRight = (row: WorkflowEntityLinkRecord): WorkflowEntityLinkMatch => ({
  link_id: row.link_id,
  type: row.left_type,
  id: row.left_id,
  relation: row.relation,
  attributes: row.attributes ?? {},
});

function workflowEntityLinks(
  knex: Knex,
  tenant: string,
): Knex.QueryBuilder<WorkflowEntityLinkRecord, WorkflowEntityLinkRecord[]> {
  return tenantDb(knex, tenant).table<WorkflowEntityLinkRecord>(TABLE);
}

const WorkflowEntityLinkModel = {
  upsert: async (
    knex: Knex,
    tenant: string,
    input: {
      namespace: string;
      left: WorkflowEntityRef;
      right: WorkflowEntityRef;
      relation?: string;
      attributes?: Record<string, unknown>;
      created_by_run_id?: string | null;
    }
  ): Promise<{ record: WorkflowEntityLinkRecord; created: boolean }> => {
    const timestamp = nowIso();
    const insertData = {
      tenant,
      namespace: input.namespace,
      left_type: input.left.type,
      left_id: input.left.id,
      right_type: input.right.type,
      right_id: input.right.id,
      relation: input.relation ?? 'related',
      attributes: input.attributes ?? {},
      created_by_run_id: input.created_by_run_id ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    const inserted = await workflowEntityLinks(knex, tenant)
      .insert(insertData)
      .onConflict(UNIQUE_COLUMNS)
      .ignore()
      .returning('*');

    if (inserted[0]) {
      return { record: inserted[0], created: true };
    }

    const [record] = await workflowEntityLinks(knex, tenant)
      .where({
        namespace: insertData.namespace,
        left_type: insertData.left_type,
        left_id: insertData.left_id,
        right_type: insertData.right_type,
        right_id: insertData.right_id,
        relation: insertData.relation,
      })
      .update({
        attributes: insertData.attributes,
        updated_at: timestamp,
      })
      .returning('*');

    return { record, created: false };
  },

  lookup: async (
    knex: Knex,
    tenant: string,
    input: {
      namespace: string;
      from: WorkflowEntityRef;
      direction?: 'forward' | 'reverse' | 'either';
      relation?: string;
      right_type?: string;
      limit?: number;
    }
  ): Promise<{ matches: WorkflowEntityLinkMatch[] }> => {
    const direction = input.direction ?? 'forward';
    const limit = normalizeLimit(input.limit);
    const matches: WorkflowEntityLinkMatch[] = [];

    if (direction === 'forward' || direction === 'either') {
      const query = workflowEntityLinks(knex, tenant)
        .where({
          namespace: input.namespace,
          left_type: input.from.type,
          left_id: input.from.id,
        })
        .orderBy('created_at', 'asc')
        .orderBy('link_id', 'asc')
        .limit(limit);
      if (input.relation) query.andWhere({ relation: input.relation });
      if (input.right_type) query.andWhere({ right_type: input.right_type });
      const rows = await query;
      matches.push(...rows.map(targetFromLeft));
    }

    if (matches.length < limit && (direction === 'reverse' || direction === 'either')) {
      const query = workflowEntityLinks(knex, tenant)
        .where({
          namespace: input.namespace,
          right_type: input.from.type,
          right_id: input.from.id,
        })
        .orderBy('created_at', 'asc')
        .orderBy('link_id', 'asc')
        .limit(limit - matches.length);
      if (input.relation) query.andWhere({ relation: input.relation });
      if (input.right_type) query.andWhere({ left_type: input.right_type });
      const rows = await query;
      matches.push(...rows.map(targetFromRight));
    }

    return { matches };
  },

  delete: async (
    knex: Knex,
    tenant: string,
    input: {
      namespace: string;
      left?: WorkflowEntityRef;
      right?: WorkflowEntityRef;
      relation?: string;
    }
  ): Promise<number> => {
    if (!input.left && !input.right) {
      throw new Error('WORKFLOW_ENTITY_LINK_DELETE_REQUIRES_LEFT_OR_RIGHT');
    }

    const query = workflowEntityLinks(knex, tenant).where({
      namespace: input.namespace,
    });
    if (input.left) {
      query.andWhere({ left_type: input.left.type, left_id: input.left.id });
    }
    if (input.right) {
      query.andWhere({ right_type: input.right.type, right_id: input.right.id });
    }
    if (input.relation) {
      query.andWhere({ relation: input.relation });
    }

    return query.delete();
  },

  list: async (
    knex: Knex,
    tenant: string,
    namespace: string,
    options: WorkflowEntityLinkListOptions = {}
  ): Promise<WorkflowEntityLinkListResult> => {
    const limit = normalizeLimit(options.limit);
    const cursor = normalizeCursor(options.cursor);
    const query = workflowEntityLinks(knex, tenant).where({ namespace });
    if (options.left_type) query.andWhere({ left_type: options.left_type });
    if (options.right_type) query.andWhere({ right_type: options.right_type });
    if (options.relation) query.andWhere({ relation: options.relation });

    const rows = await query
      .orderBy('created_at', 'asc')
      .orderBy('link_id', 'asc')
      .limit(limit + 1)
      .offset(cursor);
    const hasMore = rows.length > limit;

    return {
      items: rows.slice(0, limit),
      next_cursor: hasMore ? cursor + limit : null,
    };
  },

  listNamespaces: async (knex: Knex, tenant: string): Promise<WorkflowEntityLinkNamespace[]> => {
    const rows = (await workflowEntityLinks(knex, tenant)
      .select('namespace')
      .count<{ link_count: string | number }[]>({ link_count: '*' })
      .groupBy('namespace')
      .orderBy('namespace', 'asc')) as Array<{ namespace: string; link_count: string | number }>;

    return rows.map((row) => ({
      namespace: row.namespace,
      link_count: Number(row.link_count),
    }));
  },
};

export default WorkflowEntityLinkModel;
