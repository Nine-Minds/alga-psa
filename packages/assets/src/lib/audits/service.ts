/**
 * Site audit service (mobile 2.0 FR16, web surfaces).
 *
 * A run snapshots the assets expected at a client location, collects marks as
 * the technician walks the site, and on completion turns the gap between
 * expected and present into `missing` items, one `asset_history` row per
 * touched asset (change_type 'audit') and the asset's last-audit columns.
 *
 * It lives in the package — not under server/ — because both the v1 REST
 * controller (through a thin adapter) and this package's `use server` actions
 * drive the same lifecycle; packages cannot import server code, so the service
 * raises {@link AssetAuditError} codes and each caller maps them.
 *
 * Every query is tenant-scoped (Citus) and every write that must agree with
 * another runs inside one transaction.
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, tenantDb, withTransaction } from '@alga-psa/db';
import type {
  AssetAuditItemRecord,
  AssetAuditItemResult,
  AssetAuditListFilters,
  AssetAuditRecord,
  AssetAuditWithItems,
} from '@alga-psa/types';
import { AssetAuditError } from './errors';

export type {
  AssetAuditItemMethod,
  AssetAuditItemRecord,
  AssetAuditItemResult,
  AssetAuditRecord,
  AssetAuditStatus,
  AssetAuditWithItems,
} from '@alga-psa/types';

/** What `start` takes. Structurally the v1 `createAssetAuditSchema` payload. */
export interface CreateAssetAuditInput {
  client_id: string;
  /** null audits the client's assets that have no location. */
  location_id?: string | null;
  /** Status slugs in scope; empty means every status. */
  statuses?: string[];
  notes?: string | null;
}

/** What `markItem` takes. Structurally the v1 `markAssetAuditItemSchema` payload. */
export interface MarkAssetAuditItemInput {
  asset_id: string;
  /** The caller's intent; an asset outside the snapshot is stored as unexpected. */
  result?: 'present' | 'unexpected';
  method?: 'scan' | 'manual' | 'register';
}

export interface AssetAuditScope {
  client_id: string;
  location_id: string | null;
  statuses?: string[] | null;
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
  async start(data: CreateAssetAuditInput, context: ServiceContext): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);

    return withTransaction(knex, async (trx) => {
      const expected: Array<{ asset_id: string }> = await this.scopeQuery(trx, context.tenant, {
        client_id: data.client_id,
        location_id: data.location_id ?? null,
        statuses: data.statuses ?? null,
      }).select('asset_id');

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

      return {
        ...(await this.loadAudit(trx, context.tenant, audit.audit_id)),
        items: await this.loadItems(trx, context.tenant, audit.audit_id),
      };
    });
  }

  /**
   * How many assets the audit would snapshot right now. Powers the start
   * dialog's live expected count, counted off the same predicate `start` uses
   * so the preview can never disagree with the snapshot.
   */
  async previewScope(scope: AssetAuditScope, context: ServiceContext): Promise<number> {
    const knex = await this.getDbForContext(context);
    const row = await this.scopeQuery(knex, context.tenant, scope).count('* as count').first();
    return Number((row as { count?: string } | undefined)?.count ?? 0);
  }

  /**
   * Record a mark. Idempotent on (tenant, audit, asset): re-marking an asset
   * that is already present keeps the first `marked_at`. An asset outside the
   * snapshot is stored as `unexpected` whatever the caller asked for, so the
   * summary can never claim a device was expected here.
   */
  async markItem(
    auditId: string,
    data: MarkAssetAuditItemInput,
    context: ServiceContext,
  ): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);

    return withTransaction(knex, async (trx) => {
      const audit = await this.requireInProgress(trx, context.tenant, auditId);

      const asset = await scoped(trx, context.tenant, 'assets')
        .where({ asset_id: data.asset_id })
        .first('asset_id');
      if (!asset) {
        throw new AssetAuditError('not_found', 'Asset not found');
      }

      const existing = await scoped(trx, context.tenant, 'asset_audit_items')
        .where({ audit_id: auditId, asset_id: data.asset_id })
        .first('result', 'marked_at');

      // An `unexpected` row proves the asset was never in scope, so re-scanning
      // it must not promote it. An asset with no row at all can still be
      // present: a device registered (or moved in) during the walk joins the
      // scope after the snapshot was taken, and the audit then expects it.
      const inSnapshot = Boolean(existing) && existing.result !== 'unexpected';
      const joinedScope = !existing && (await this.isInScope(trx, context.tenant, audit, data.asset_id));
      const result: AssetAuditItemResult = inSnapshot || joinedScope ? 'present' : 'unexpected';
      const method = data.method ?? 'manual';

      if (existing && existing.result === result && existing.marked_at) {
        return this.countedResult(trx, context.tenant, audit);
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
          method,
          marked_at: markedAt,
          marked_by: context.userId,
        })
        .onConflict(['tenant', 'audit_id', 'asset_id'])
        .merge({
          result,
          method,
          marked_at: markedAt,
          marked_by: context.userId,
        });

      // A late arrival widens the expected set, so expected stays present +
      // missing once the run is closed.
      if (joinedScope) {
        await scoped(trx, context.tenant, 'asset_audits')
          .where({ audit_id: auditId })
          .update({ expected_count: Number(audit.expected_count ?? 0) + 1 });
      }

      return this.countedResult(trx, context.tenant, audit);
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
        throw new AssetAuditError('not_found', 'Audit item not found');
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

      return this.countedResult(trx, context.tenant, audit);
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
      // A 500-device site would be 1000 round trips one row at a time, so the
      // trail goes in as one insert and one update per result.
      const audited = items.filter((item) => item.result !== 'unexpected');
      if (audited.length > 0) {
        await scoped(trx, context.tenant, 'asset_history').insert(
          audited.map((item) => ({
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
          })),
        );
      }
      for (const result of ['present', 'missing'] as const) {
        const assetIds = audited.filter((item) => item.result === result).map((item) => item.asset_id);
        if (assetIds.length === 0) continue;
        await scoped(trx, context.tenant, 'assets')
          .whereIn('asset_id', assetIds)
          .update({ last_audited_at: nowIso, last_audit_result: result });
      }

      await scoped(trx, context.tenant, 'asset_audits')
        .where({ audit_id: auditId })
        .update({
          status: 'completed',
          completed_at: nowIso,
          present_count: presentCount,
          missing_count: missingCount,
          unexpected_count: unexpectedCount,
          updated_at: nowIso,
        });

      return {
        ...(await this.loadAudit(trx, context.tenant, auditId)),
        items: await this.loadItems(trx, context.tenant, auditId),
      };
    });
  }

  /**
   * Abandon the run; only an open audit can be cancelled. Nothing is written to
   * the assets — but what the walk did see is kept on the row, because a
   * cancelled audit is terminal and its counts would otherwise read as zero in
   * the lists for good while the detail still showed the marks.
   */
  async cancel(auditId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);

    return withTransaction(knex, async (trx) => {
      const audit = await this.requireInProgress(trx, context.tenant, auditId);

      await scoped(trx, context.tenant, 'asset_audits')
        .where({ audit_id: auditId })
        .update({ status: 'cancelled', updated_at: new Date().toISOString() });

      return this.countedResult(trx, context.tenant, audit);
    });
  }

  async get(auditId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    const knex = await this.getDbForContext(context);
    return {
      ...(await this.loadAudit(knex, context.tenant, auditId)),
      items: await this.loadItems(knex, context.tenant, auditId),
    };
  }

  /**
   * Audits newest first, narrowed by client, location, status and a started_at
   * range. Mobile sends client only; the web list sends the rest. The same
   * predicates are applied to the count query, so the pager agrees with the
   * rows it pages over.
   */
  async list(
    options: AssetAuditListFilters,
    context: ServiceContext,
  ): Promise<{ data: AssetAuditRecord[]; total: number }> {
    const knex = await this.getDbForContext(context);
    const page = options.page && options.page > 0 ? options.page : 1;
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 25;

    const rowsQuery = this.applyListFilters(this.namedAuditQuery(knex, context.tenant), options, 'asset_audits.');
    const countQuery = this.applyListFilters(scoped(knex, context.tenant, 'asset_audits'), options, '');

    const [rows, countRow] = await Promise.all([
      rowsQuery
        .orderBy('asset_audits.started_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit),
      countQuery.count('* as count').first(),
    ]);

    return { data: rows, total: Number((countRow as { count?: string })?.count ?? 0) };
  }

  /**
   * A mutation's answer, with the audit row's result counts brought in step
   * with its items first.
   *
   * Those columns are what every list reads, while the detail page counts the
   * items it was given. `complete` has always written them, but nothing else
   * did: an open run read as 0 present in the list while the detail showed the
   * marks, and a cancelled run kept that disagreement for good. The update is
   * only issued when a count actually moved.
   */
  private async countedResult(
    conn: Knex | Knex.Transaction,
    tenant: string,
    audit: AssetAuditRecord,
  ): Promise<AssetAuditWithItems> {
    const items = await this.loadItems(conn, tenant, audit.audit_id);
    const counts = {
      present_count: items.filter((item) => item.result === 'present').length,
      missing_count: items.filter((item) => item.result === 'missing').length,
      unexpected_count: items.filter((item) => item.result === 'unexpected').length,
    };
    const moved = (Object.keys(counts) as Array<keyof typeof counts>).some(
      (key) => Number((audit as unknown as Record<string, unknown>)[key] ?? 0) !== counts[key],
    );
    if (moved) {
      await scoped(conn, tenant, 'asset_audits').where({ audit_id: audit.audit_id }).update(counts);
    }
    return { ...(await this.loadAudit(conn, tenant, audit.audit_id)), items };
  }

  /** The shared list predicates, applied to both the row and the count query. */
  private applyListFilters(
    query: Knex.QueryBuilder<any, any>,
    options: AssetAuditListFilters,
    prefix: string,
  ): Knex.QueryBuilder<any, any> {
    if (options.client_id) query.where({ [`${prefix}client_id`]: options.client_id });
    if (options.no_location) {
      query.whereNull(`${prefix}location_id`);
    } else if (options.location_id) {
      query.where({ [`${prefix}location_id`]: options.location_id });
    }
    if (options.status) query.where({ [`${prefix}status`]: options.status });
    // Day boundaries arrive as instants the caller computed in the viewer's
    // time zone; filtering on started_at keeps "audits started that day".
    if (options.started_from) query.where(`${prefix}started_at`, '>=', options.started_from);
    if (options.started_to) query.where(`${prefix}started_at`, '<=', options.started_to);
    return query;
  }

  /**
   * The audit's scope as a query over `assets`: one client, one location (or
   * none at all) and, when given, a set of status slugs.
   */
  private scopeQuery(
    conn: Knex | Knex.Transaction,
    tenant: string,
    scope: AssetAuditScope,
  ): Knex.QueryBuilder<any, any> {
    const query = scoped(conn, tenant, 'assets').where({ client_id: scope.client_id });
    if (scope.location_id) {
      query.where({ location_id: scope.location_id });
    } else {
      query.whereNull('location_id');
    }
    const statuses = Array.isArray(scope.statuses) ? scope.statuses : [];
    if (statuses.length > 0) {
      query.whereIn('status', statuses);
    }
    return query;
  }

  /** Is this one asset inside the audit's scope right now? */
  private async isInScope(
    conn: Knex | Knex.Transaction,
    tenant: string,
    audit: AssetAuditRecord,
    assetId: string,
  ): Promise<boolean> {
    const asset = await this.scopeQuery(conn, tenant, audit).where({ asset_id: assetId }).first('asset_id');
    return Boolean(asset);
  }

  /**
   * The audit row with the client, location and starter names the lists show.
   * The web list has a "Started by" column; resolving the name here keeps it
   * one query instead of a per-row user lookup.
   */
  private namedAuditQuery(conn: Knex | Knex.Transaction, tenant: string): Knex.QueryBuilder<any, any> {
    const db = tenantDb(conn, tenant);
    const query = db.table('asset_audits');
    db.tenantJoin(query, 'clients', 'asset_audits.client_id', 'clients.client_id', { type: 'left' });
    db.tenantJoin(query, 'client_locations', 'asset_audits.location_id', 'client_locations.location_id', {
      type: 'left',
    });
    db.tenantJoin(query, 'users as started_by_user', 'asset_audits.started_by', 'started_by_user.user_id', {
      type: 'left',
    });
    return query.select(
      'asset_audits.*',
      'clients.client_name',
      'client_locations.location_name',
      (conn as Knex).raw(
        "NULLIF(TRIM(CONCAT(started_by_user.first_name, ' ', started_by_user.last_name)), '') as started_by_name",
      ),
    ) as Knex.QueryBuilder<any, any>;
  }

  private async loadAudit(
    conn: Knex | Knex.Transaction,
    tenant: string,
    auditId: string,
  ): Promise<AssetAuditRecord> {
    const audit = await this.namedAuditQuery(conn, tenant).where({ 'asset_audits.audit_id': auditId }).first();
    if (!audit) {
      throw new AssetAuditError('not_found', 'Audit not found');
    }
    return audit as AssetAuditRecord;
  }

  private async requireInProgress(
    conn: Knex | Knex.Transaction,
    tenant: string,
    auditId: string,
  ): Promise<AssetAuditRecord> {
    const audit = await scoped(conn, tenant, 'asset_audits').where({ audit_id: auditId }).first('*');
    if (!audit) {
      throw new AssetAuditError('not_found', 'Audit not found');
    }
    if (audit.status !== 'in_progress') {
      throw new AssetAuditError('conflict', `Audit is ${audit.status}`);
    }
    return audit;
  }

  /**
   * Items joined to the asset identity the session, summary and web tables
   * show. `asset_type` is the registry slug — the web table resolves it to the
   * registry display name — and `marked_by_name` fills the "Marked by" column.
   */
  private async loadItems(
    conn: Knex | Knex.Transaction,
    tenant: string,
    auditId: string,
  ): Promise<AssetAuditItemRecord[]> {
    const db = tenantDb(conn, tenant);
    const query = db.table('asset_audit_items');
    db.tenantJoin(query, 'assets', 'asset_audit_items.asset_id', 'assets.asset_id', { type: 'left' });
    db.tenantJoin(query, 'users as marked_by_user', 'asset_audit_items.marked_by', 'marked_by_user.user_id', {
      type: 'left',
    });

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
        'assets.asset_type',
        'assets.client_id',
        'assets.location_id',
        'assets.location',
        (conn as Knex).raw(
          "NULLIF(TRIM(CONCAT(marked_by_user.first_name, ' ', marked_by_user.last_name)), '') as marked_by_name",
        ),
      ) as unknown as Promise<AssetAuditItemRecord[]>;
  }
}
