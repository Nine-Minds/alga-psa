/**
 * Site audit service (mobile 2.0 FR16).
 *
 * A run snapshots the assets expected at a client location, collects marks as
 * the technician walks the site, and on completion turns the gap between
 * expected and present into `missing` items, one `asset_history` row per
 * touched asset (change_type 'audit') and the asset's last-audit columns.
 *
 * Every query is tenant-scoped (Citus) and every write that must agree with
 * another runs inside one transaction.
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, tenantDb, withTransaction } from '@alga-psa/db';
import { ConflictError, NotFoundError } from '../middleware/apiMiddleware';
import type { CreateAssetAuditData, MarkAssetAuditItemData } from '../schemas/assetAudit';

export type AssetAuditStatus = 'in_progress' | 'completed' | 'cancelled';
export type AssetAuditItemResult = 'expected' | 'present' | 'missing' | 'unexpected';
export type AssetAuditItemMethod = 'scan' | 'manual' | 'register';

export interface AssetAuditRecord {
  audit_id: string;
  tenant: string;
  client_id: string;
  location_id: string | null;
  status: AssetAuditStatus;
  started_by: string;
  started_at: string;
  completed_at: string | null;
  expected_count: number;
  present_count: number;
  missing_count: number;
  unexpected_count: number;
  statuses?: string[] | null;
  notes?: string | null;
}

export interface AssetAuditItemRecord {
  asset_id: string;
  result: AssetAuditItemResult;
  method: AssetAuditItemMethod | null;
  marked_at: string | null;
  marked_by: string | null;
  asset_name?: string | null;
  asset_tag?: string | null;
  serial_number?: string | null;
  location_id?: string | null;
  location?: string | null;
  client_id?: string | null;
}

export interface AssetAuditWithItems extends AssetAuditRecord {
  items: AssetAuditItemRecord[];
}

function scoped(conn: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

export class AssetAuditService extends BaseService<any> {
  constructor() {
    super({
      tableName: 'asset_audits',
      primaryKey: 'audit_id',
      tenantColumn: 'tenant',
      defaultSort: 'started_at',
      defaultOrder: 'desc',
    });
  }

  /**
   * Snapshot the assets expected in scope and open the audit. `location_id`
   * null audits the client's assets that have no location, which is what a
   * tenant that never filled locations in actually has.
   */
  async start(data: CreateAssetAuditData, context: ServiceContext): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);

    return withTransaction(knex, async (trx) => {
      const expectedQuery = scoped(trx, context.tenant, 'assets')
        .where({ client_id: data.client_id })
        .select('asset_id');

      if (data.location_id) {
        expectedQuery.where({ location_id: data.location_id });
      } else {
        expectedQuery.whereNull('location_id');
      }
      if (data.statuses && data.statuses.length > 0) {
        expectedQuery.whereIn('status', data.statuses);
      }

      const expected: Array<{ asset_id: string }> = await expectedQuery;

      const [audit] = await scoped(trx, context.tenant, 'asset_audits')
        .insert({
          tenant: context.tenant,
          client_id: data.client_id,
          location_id: data.location_id ?? null,
          status: 'in_progress',
          started_by: context.userId,
          expected_count: expected.length,
          statuses: data.statuses && data.statuses.length > 0 ? JSON.stringify(data.statuses) : null,
          notes: data.notes ?? null,
        })
        .returning('*');

      if (expected.length > 0) {
        await scoped(trx, context.tenant, 'asset_audit_items').insert(
          expected.map((asset) => ({
            tenant: context.tenant,
            audit_id: audit.audit_id,
            asset_id: asset.asset_id,
            result: 'expected',
          })),
        );
      }

      return { ...audit, items: await this.loadItems(trx, context.tenant, audit.audit_id) };
    });
  }

  /**
   * Record a mark. Idempotent on (tenant, audit, asset): re-marking an asset
   * that is already present keeps the first `marked_at`. An asset outside the
   * snapshot is stored as `unexpected` whatever the caller asked for, so the
   * summary can never claim a device was expected here.
   */
  async markItem(
    auditId: string,
    data: MarkAssetAuditItemData,
    context: ServiceContext,
  ): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);

    return withTransaction(knex, async (trx) => {
      const audit = await this.requireInProgress(trx, context.tenant, auditId);

      const asset = await scoped(trx, context.tenant, 'assets')
        .where({ asset_id: data.asset_id })
        .first('asset_id');
      if (!asset) {
        throw new NotFoundError('Asset not found');
      }

      const existing = await scoped(trx, context.tenant, 'asset_audit_items')
        .where({ audit_id: auditId, asset_id: data.asset_id })
        .first('result', 'marked_at');

      // Only a snapshot row can become `present`. An `unexpected` row proves the
      // asset was never in scope, so re-scanning it must not promote it.
      const inSnapshot = Boolean(existing) && existing.result !== 'unexpected';
      const result: AssetAuditItemResult = inSnapshot ? 'present' : 'unexpected';

      if (existing && existing.result === result && existing.marked_at) {
        return { ...audit, items: await this.loadItems(trx, context.tenant, auditId) };
      }

      // Citus rejects non-IMMUTABLE functions in the DO UPDATE SET of an insert
      // on a distributed table, so the mark time is bound as a value.
      const markedAt = new Date().toISOString();

      await scoped(trx, context.tenant, 'asset_audit_items')
        .insert({
          tenant: context.tenant,
          audit_id: auditId,
          asset_id: data.asset_id,
          result,
          method: data.method,
          marked_at: markedAt,
          marked_by: context.userId,
        })
        .onConflict(['tenant', 'audit_id', 'asset_id'])
        .merge({
          result,
          method: data.method,
          marked_at: markedAt,
          marked_by: context.userId,
        });

      return { ...audit, items: await this.loadItems(trx, context.tenant, auditId) };
    });
  }

  /**
   * Undo a mark. An expected asset goes back to `expected`; an unexpected one
   * was never in scope, so its row is removed outright.
   */
  async unmarkItem(auditId: string, assetId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);

    return withTransaction(knex, async (trx) => {
      const audit = await this.requireInProgress(trx, context.tenant, auditId);

      const item = await scoped(trx, context.tenant, 'asset_audit_items')
        .where({ audit_id: auditId, asset_id: assetId })
        .first('result');
      if (!item) {
        throw new NotFoundError('Audit item not found');
      }

      if (item.result === 'unexpected') {
        await scoped(trx, context.tenant, 'asset_audit_items')
          .where({ audit_id: auditId, asset_id: assetId })
          .delete();
      } else {
        await scoped(trx, context.tenant, 'asset_audit_items')
          .where({ audit_id: auditId, asset_id: assetId })
          .update({ result: 'expected', method: null, marked_at: null, marked_by: null });
      }

      return { ...audit, items: await this.loadItems(trx, context.tenant, auditId) };
    });
  }

  /**
   * Close the audit: what was expected and never seen becomes `missing`, the
   * counts are written, and each present or missing asset gets a history row
   * plus its last-audit columns — all in one transaction, so a failure leaves
   * the audit open with no partial trail.
   */
  async complete(auditId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);

    return withTransaction(knex, async (trx) => {
      const audit = await this.requireInProgress(trx, context.tenant, auditId);

      await scoped(trx, context.tenant, 'asset_audit_items')
        .where({ audit_id: auditId, result: 'expected' })
        .update({ result: 'missing' });

      const items: AssetAuditItemRecord[] = await scoped(trx, context.tenant, 'asset_audit_items')
        .where({ audit_id: auditId })
        .select('asset_id', 'result', 'method');

      const presentCount = items.filter((item) => item.result === 'present').length;
      const missingCount = items.filter((item) => item.result === 'missing').length;
      const unexpectedCount = items.filter((item) => item.result === 'unexpected').length;

      const nowIso = new Date().toISOString();
      for (const item of items) {
        if (item.result === 'unexpected') continue;
        await scoped(trx, context.tenant, 'asset_history').insert({
          tenant: context.tenant,
          asset_id: item.asset_id,
          changed_by: context.userId,
          change_type: 'audit',
          changes: JSON.stringify({
            audit_id: auditId,
            result: item.result,
            location_id: audit.location_id,
            method: item.method ?? null,
          }),
        });
        await scoped(trx, context.tenant, 'assets')
          .where({ asset_id: item.asset_id })
          .update({ last_audited_at: nowIso, last_audit_result: item.result });
      }

      const [updated] = await scoped(trx, context.tenant, 'asset_audits')
        .where({ audit_id: auditId })
        .update({
          status: 'completed',
          completed_at: nowIso,
          present_count: presentCount,
          missing_count: missingCount,
          unexpected_count: unexpectedCount,
          updated_at: nowIso,
        })
        .returning('*');

      return { ...updated, items: await this.loadItems(trx, context.tenant, auditId) };
    });
  }

  /** Abandon the run; only an open audit can be cancelled. */
  async cancel(auditId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);

    return withTransaction(knex, async (trx) => {
      await this.requireInProgress(trx, context.tenant, auditId);

      const [updated] = await scoped(trx, context.tenant, 'asset_audits')
        .where({ audit_id: auditId })
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .returning('*');

      return { ...updated, items: await this.loadItems(trx, context.tenant, auditId) };
    });
  }

  async get(auditId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);
    const audit = await scoped(knex, context.tenant, 'asset_audits')
      .where({ audit_id: auditId })
      .first('*');
    if (!audit) {
      throw new NotFoundError('Audit not found');
    }
    return { ...audit, items: await this.loadItems(knex, context.tenant, auditId) };
  }

  async list(
    options: { page?: number; limit?: number; client_id?: string },
    context: ServiceContext,
  ): Promise<{ data: AssetAuditRecord[]; total: number }> {
    const knex = await this.getDbForContext(context);
    const page = options.page && options.page > 0 ? options.page : 1;
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 25;

    const base = () => {
      const query = scoped(knex, context.tenant, 'asset_audits');
      if (options.client_id) query.where({ client_id: options.client_id });
      return query;
    };

    const [rows, countRow] = await Promise.all([
      base()
        .orderBy('started_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit)
        .select('*'),
      base().count('* as count').first(),
    ]);

    return { data: rows, total: Number((countRow as { count?: string })?.count ?? 0) };
  }

  private async requireInProgress(
    conn: Knex | Knex.Transaction,
    tenant: string,
    auditId: string,
  ): Promise<AssetAuditRecord> {
    const audit = await scoped(conn, tenant, 'asset_audits').where({ audit_id: auditId }).first('*');
    if (!audit) {
      throw new NotFoundError('Audit not found');
    }
    if (audit.status !== 'in_progress') {
      throw new ConflictError(`Audit is ${audit.status}`);
    }
    return audit;
  }

  /** Items joined to the asset identity the session and summary screens show. */
  private async loadItems(
    conn: Knex | Knex.Transaction,
    tenant: string,
    auditId: string,
  ): Promise<AssetAuditItemRecord[]> {
    const db = tenantDb(conn, tenant);
    const query = db.table('asset_audit_items');
    db.tenantJoin(query, 'assets', 'asset_audit_items.asset_id', 'assets.asset_id', { type: 'left' });

    return query
      .where({ 'asset_audit_items.audit_id': auditId })
      .orderBy('assets.name', 'asc')
      .select(
        'asset_audit_items.asset_id',
        'asset_audit_items.result',
        'asset_audit_items.method',
        'asset_audit_items.marked_at',
        'asset_audit_items.marked_by',
        'assets.name as asset_name',
        'assets.asset_tag',
        'assets.serial_number',
        'assets.client_id',
        'assets.location_id',
        'assets.location',
      ) as unknown as Promise<AssetAuditItemRecord[]>;
  }
}
