'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { ICountSession, ICountLine, IStockUnit } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  adjustStockCore,
  assertLocationWritable,
  publishInventoryEvent,
  recordCountCore,
  resolveTenantCurrency,
  startCountSessionCore,
  submitCountForReviewCore,
  timestampPayload,
  type PendingStockLowSignal,
} from '../lib';

// NOTE: 'use server' file — export ONLY async functions (+ erased types).

/**
 * Cycle counts (F059–F068). The flow:
 *   startCountSession  — snapshot expected on-hand per tracked product at the location
 *   recordCount        — blind entry (expected withheld unless the caller can approve)
 *   submitForReview    — in_progress → review
 *   approveCountSession — writes 'adjust' movements (reason 'cycle_count') per counted
 *                         variance; missing serialized units retire; unexpected serials
 *                         must be dispositioned. Ledger stays the source of truth (D7).
 *   cancelCountSession — discards with no stock effect
 *
 * Staleness (F067): a line is stale when the location's CURRENT on-hand no longer
 * matches the session snapshot (stock moved mid-count). Stale lines are flagged at
 * read time and skipped (reported) at approval rather than corrupting variance math.
 */

async function requireCountPerm(user: any, action: 'create' | 'read' | 'update' | 'delete' | 'approve'): Promise<void> {
  if (!(await hasPermission(user, 'cycle_count', action))) {
    throw new Error(`Permission denied: cycle_count ${action} required`);
  }
}

export type CycleCountActionError = ActionMessageError | ActionPermissionError;

function cycleCountActionErrorFrom(error: unknown): CycleCountActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Count session not found':
        return actionError('Count session not found. It may have been updated or deleted. Please refresh and try again.');
      case 'location_id is required':
        return actionError('Pick a location to count.');
      case 'Stock location not found':
        return actionError('Stock location not found. It may have been updated or deleted. Please refresh and try again.');
      case 'This location already has an open count session':
        return actionError('This location already has an open count session.');
      case 'This product is not part of the count session':
        return actionError('This product is not part of the count session. Refresh the session and try again.');
      case 'counted_qty must be a non-negative integer':
        return actionError('Count must be a non-negative whole number.');
      case 'An approved session cannot be cancelled':
        return actionError('An approved count session cannot be cancelled.');
      case 'Four-eyes: you counted in this session, so a different approver must sign it off':
        return actionError('A different approver must sign off because you counted in this session.');
      default:
        if (
          error.message.startsWith('Counts can only be recorded ') ||
          error.message.startsWith('Only an in-progress session ') ||
          error.message.startsWith('Only a session in review ') ||
          error.message.startsWith('Unexpected serial(s) ') ||
          error.message.startsWith('Serial number already exists:')
        ) {
          return actionError(error.message);
        }
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected count records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This count update conflicts with an existing record. Please refresh and try again.');
  }

  return null;
}

async function withCycleCountActionErrors<T>(work: () => Promise<T>): Promise<T | CycleCountActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = cycleCountActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

async function canApprove(user: any): Promise<boolean> {
  return hasPermission(user, 'cycle_count', 'approve');
}

async function getSessionOrThrow(
  trx: Knex.Transaction,
  tenant: string,
  sessionId: string,
  opts?: { forUpdate?: boolean },
): Promise<ICountSession> {
  const q = trx('count_sessions').where({ tenant, session_id: sessionId });
  if (opts?.forUpdate) q.forUpdate();
  const row = await q.first();
  if (!row) throw new Error('Count session not found');
  return row as ICountSession;
}

export interface CountLineView extends ICountLine {
  service_name: string | null;
  sku: string | null;
  is_serialized: boolean;
  /** Stock moved at this location since the snapshot — recount before approving (F067). */
  stale: boolean;
  /** Only present for approvers (blind count — F062/F064). */
  expected_qty_visible?: number;
  expected_serials_visible?: string[] | null;
  variance?: number | null;
  /** Variance valued at the product's average cost, cents (approvers only). */
  variance_value_cents?: number | null;
  /** Currency for the average cost used to value variance. */
  cost_currency?: string | null;
}

export interface CountSessionView extends ICountSession {
  location_name: string | null;
  lines: CountLineView[];
  /** Whether the CALLER may see expected quantities / variance (approve permission). */
  can_review: boolean;
}

interface CountEventFacts {
  line_count: number;
  counted_line_count: number;
  variance_line_count: number;
  variance_quantity: number;
}

async function loadCountEventFacts(
  trx: Knex.Transaction,
  tenant: string,
  sessionId: string,
): Promise<CountEventFacts> {
  const lines = await trx('count_lines')
    .where({ tenant, session_id: sessionId })
    .select('expected_qty', 'counted_qty');
  const counted = lines.filter((line: any) => line.counted_qty != null);
  const variances = counted.map((line: any) => Number(line.counted_qty) - Number(line.expected_qty));
  return {
    line_count: lines.length,
    counted_line_count: counted.length,
    variance_line_count: variances.filter((variance: number) => variance !== 0).length,
    variance_quantity: variances.reduce((sum: number, variance: number) => sum + variance, 0),
  };
}

/**
 * Start a count at a location (F061/F063): snapshot expected on-hand for every
 * stock-tracked product with a stock_levels row there, plus serialized products'
 * in-stock serial lists. Counting respects location scoping (an engineer counts
 * their own van).
 */
export const startCountSession = withAuth(
  async (user, { tenant }, locationId: string, notes?: string | null): Promise<ICountSession | CycleCountActionError> => {
    return withCycleCountActionErrors(async () => {
      await requireCountPerm(user, 'create');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) =>
        startCountSessionCore(trx, tenant, user.user_id, { location_id: locationId, notes }),
      );
    });
  },
);

export const listCountSessions = withAuth(
  async (
    user,
    { tenant },
    filter?: { location_id?: string; status?: ICountSession['status'] },
  ): Promise<Array<ICountSession & { location_name: string | null; line_count: number; counted_count: number }> | CycleCountActionError> => {
    return withCycleCountActionErrors(async () => {
    await requireCountPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('count_sessions as cs')
        .leftJoin('stock_locations as loc', function () {
          this.on('loc.location_id', '=', 'cs.location_id').andOn('loc.tenant', '=', 'cs.tenant');
        })
        .leftJoin(
          trx('count_lines')
            .select('session_id')
            .count({ line_count: '*' })
            .sum({ counted_count: trx.raw('CASE WHEN counted_qty IS NOT NULL THEN 1 ELSE 0 END') })
            .where({ tenant })
            .groupBy('session_id')
            .as('cl'),
          'cl.session_id',
          'cs.session_id',
        )
        .where('cs.tenant', tenant)
        .orderBy('cs.started_at', 'desc')
        .select(
          'cs.*',
          'loc.name as location_name',
          trx.raw('COALESCE(cl.line_count, 0) as line_count'),
          trx.raw('COALESCE(cl.counted_count, 0) as counted_count'),
        );
      if (filter?.location_id) q.andWhere('cs.location_id', filter.location_id);
      if (filter?.status) q.andWhere('cs.status', filter.status);
      return (await q).map((r: any) => ({
        ...r,
        line_count: Number(r.line_count),
        counted_count: Number(r.counted_count),
      }));
    });
    });
  },
);

/**
 * Session detail. Expected quantities/serials and variance are included ONLY for
 * callers holding cycle_count:approve — counters stay blind (F062).
 */
export const getCountSession = withAuth(
  async (user, { tenant }, sessionId: string): Promise<CountSessionView | CycleCountActionError> => {
    return withCycleCountActionErrors(async () => {
    await requireCountPerm(user, 'read');
    const reviewer = await canApprove(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const session = await getSessionOrThrow(trx, tenant, sessionId);
      const location = await trx('stock_locations')
        .where({ tenant, location_id: session.location_id })
        .first();

      const lines = (await trx('count_lines as cl')
        .leftJoin('service_catalog as sc', function () {
          this.on('sc.service_id', '=', 'cl.service_id').andOn('sc.tenant', '=', 'cl.tenant');
        })
        .leftJoin('product_inventory_settings as pis', function () {
          this.on('pis.service_id', '=', 'cl.service_id').andOn('pis.tenant', '=', 'cl.tenant');
        })
        .where({ 'cl.tenant': tenant, 'cl.session_id': sessionId })
        .orderBy('sc.service_name', 'asc')
        .select(
          'cl.*',
          'sc.service_name',
          'sc.sku',
          trx.raw('COALESCE(pis.is_serialized, false) as is_serialized'),
          'pis.average_cost',
          'pis.cost_currency',
        )) as any[];

      const out: CountLineView[] = [];
      for (const l of lines) {
        // Staleness: current on-hand vs the snapshot (F067).
        const level = await trx('stock_levels')
          .where({ tenant, service_id: l.service_id, location_id: session.location_id })
          .first();
        const currentOnHand = Number(level?.quantity_on_hand ?? 0);
        const stale = session.status !== 'approved' && session.status !== 'cancelled'
          ? currentOnHand !== Number(l.expected_qty)
          : false;

        const view: CountLineView = {
          ...l,
          expected_serials: undefined, // never leak through the raw row
          expected_qty: undefined as any,
          is_serialized: Boolean(l.is_serialized),
          stale,
        };
        if (reviewer) {
          view.expected_qty_visible = Number(l.expected_qty);
          view.expected_serials_visible = l.expected_serials ?? null;
          view.variance = l.counted_qty != null ? Number(l.counted_qty) - Number(l.expected_qty) : null;
          view.variance_value_cents =
            l.counted_qty != null && l.average_cost != null
              ? (Number(l.counted_qty) - Number(l.expected_qty)) * Number(l.average_cost)
              : null;
        }
        out.push(view);
      }

      return {
        ...(session as ICountSession),
        location_name: location?.name ?? null,
        lines: out,
        can_review: reviewer,
      };
    });
    });
  },
);

/** Record a blind count for one product line (F062/F063). */
export const recordCount = withAuth(
  async (
    user,
    { tenant },
    sessionId: string,
    serviceId: string,
    input: { counted_qty?: number; serials?: string[] },
  ): Promise<{ recorded: boolean } | CycleCountActionError> => {
    return withCycleCountActionErrors(async () => {
      await requireCountPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) =>
        recordCountCore(trx, tenant, user.user_id, {
          ...input,
          session_id: sessionId,
          service_id: serviceId,
        }),
      );
    });
  },
);

export const submitCountForReview = withAuth(
  async (user, { tenant }, sessionId: string): Promise<ICountSession | CycleCountActionError> => {
    return withCycleCountActionErrors(async () => {
      await requireCountPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      const outcome = await withTransaction(db, async (trx: Knex.Transaction) => {
        const session = await submitCountForReviewCore(
          trx,
          tenant,
          user.user_id,
          { session_id: sessionId },
        );
        const facts = await loadCountEventFacts(trx, tenant, sessionId);
        return { session, facts };
      });
      await publishInventoryEvent('INVENTORY_COUNT_SUBMITTED', timestampPayload({
        tenant,
        session_id: outcome.session.session_id,
        location_id: outcome.session.location_id,
        ...outcome.facts,
        user_id: user.user_id,
      }));
      return outcome.session;
    });
  },
);

export const cancelCountSession = withAuth(
  async (user, { tenant }, sessionId: string): Promise<ICountSession | CycleCountActionError> => {
    return withCycleCountActionErrors(async () => {
    await requireCountPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const session = await getSessionOrThrow(trx, tenant, sessionId, { forUpdate: true });
      if (session.status === 'approved') throw new Error('An approved session cannot be cancelled');
      if (session.status === 'cancelled') return session;
      const [row] = await trx('count_sessions')
        .where({ tenant, session_id: sessionId })
        .update({ status: 'cancelled', updated_at: trx.fn.now() })
        .returning('*');
      return row as ICountSession;
    });
    });
  },
);

/** How an unexpected (counted-but-not-expected) serial should be handled (F066/F068). */
export interface UnexpectedSerialDisposition {
  serial_number: string;
  action: 'add' | 'exclude';
  mac_address?: string | null;
}

export interface ApproveCountResult {
  session: ICountSession;
  adjustments: Array<{ service_id: string; delta: number }>;
  retired_serials: string[];
  added_serials: string[];
  /** Lines skipped because stock moved mid-count (recount and re-approve — F067). */
  stale_service_ids: string[];
  /** Lines never counted — no adjustment was applied for them. */
  uncounted_service_ids: string[];
}

/**
 * Approve a reviewed session (F065/F066/F068): every counted, non-stale line's
 * variance becomes an 'adjust' movement with reason 'cycle_count'. Serialized:
 * expected-but-unscanned units retire; unexpected serials require an explicit
 * disposition ('add' as a found unit with its REAL serial, or 'exclude').
 */
export const approveCountSession = withAuth(
  async (
    user,
    { tenant },
    sessionId: string,
    dispositions?: UnexpectedSerialDisposition[],
  ): Promise<ApproveCountResult | CycleCountActionError> => {
    return withCycleCountActionErrors(async () => {
    await requireCountPerm(user, 'approve');
    const { knex: db } = await createTenantKnex();
    const outcome = await withTransaction(db, async (trx: Knex.Transaction) => {
      const session = await getSessionOrThrow(trx, tenant, sessionId, { forUpdate: true });
      if (session.status !== 'review' && session.status !== 'in_progress') {
        throw new Error(`Only a session in review can be approved (current: ${session.status})`);
      }
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, session.location_id);

      // Four-eyes: the person who counted (or started the session) cannot also sign off
      // the write-offs — the approver is the fraud control, so they must be a second
      // pair of eyes. Escape hatch: a one-person shop (no OTHER user holds
      // cycle_count:approve) may self-approve rather than being locked out.
      const approverId = (user as any)?.user_id as string;
      const counterIds = new Set<string>(
        (await trx('count_lines')
          .where({ tenant, session_id: sessionId })
          .whereNotNull('counted_by')
          .distinct('counted_by'))
          .map((r: any) => r.counted_by as string),
      );
      if (session.created_by) counterIds.add(session.created_by);
      if (counterIds.has(approverId)) {
        const otherApprover = await trx('users as u')
          .join('user_roles as ur', function () {
            this.on('ur.user_id', '=', 'u.user_id').andOn('ur.tenant', '=', 'u.tenant');
          })
          .join('role_permissions as rp', function () {
            this.on('rp.role_id', '=', 'ur.role_id').andOn('rp.tenant', '=', 'ur.tenant');
          })
          .join('permissions as p', function () {
            this.on('p.permission_id', '=', 'rp.permission_id').andOn('p.tenant', '=', 'rp.tenant');
          })
          .where({ 'u.tenant': tenant, 'p.resource': 'cycle_count', 'p.action': 'approve' })
          .whereNot('u.user_id', approverId)
          .first('u.user_id');
        if (otherApprover) {
          throw new Error(
            'Four-eyes: you counted in this session, so a different approver must sign it off',
          );
        }
      }
      const locationId = session.location_id;
      const reason = `cycle_count: session ${sessionId}`;
      const dispositionBySerial = new Map((dispositions ?? []).map((d) => [d.serial_number.trim(), d]));

      const lines = (await trx('count_lines as cl')
        .leftJoin('product_inventory_settings as pis', function () {
          this.on('pis.service_id', '=', 'cl.service_id').andOn('pis.tenant', '=', 'cl.tenant');
        })
        .where({ 'cl.tenant': tenant, 'cl.session_id': sessionId })
        .select('cl.*', trx.raw('COALESCE(pis.is_serialized, false) as is_serialized'), 'pis.average_cost', 'pis.cost_currency')) as any[];
      const defaultCurrency = await resolveTenantCurrency(trx, tenant);

      const result: ApproveCountResult = {
        session,
        adjustments: [],
        retired_serials: [],
        added_serials: [],
        stale_service_ids: [],
        uncounted_service_ids: [],
      };
      const pendingStockLowEvents: PendingStockLowSignal[] = [];

      for (const line of lines) {
        if (line.counted_qty == null) {
          result.uncounted_service_ids.push(line.service_id);
          continue;
        }

        // Staleness gate (F067): stock moved since the snapshot → skip, report.
        const level = await trx('stock_levels')
          .where({ tenant, service_id: line.service_id, location_id: locationId })
          .forUpdate()
          .first();
        const currentOnHand = Number(level?.quantity_on_hand ?? 0);
        if (currentOnHand !== Number(line.expected_qty)) {
          result.stale_service_ids.push(line.service_id);
          continue;
        }

        if (line.is_serialized) {
          const expected = new Set<string>((line.expected_serials ?? []) as string[]);
          const counted = new Set<string>((line.counted_serials ?? []) as string[]);

          // Unexpected serials block approval until dispositioned (F066).
          const unexpected = [...counted].filter((s) => !expected.has(s));
          const undispositioned = unexpected.filter((s) => !dispositionBySerial.has(s));
          if (undispositioned.length > 0) {
            throw new Error(
              `Unexpected serial(s) need a disposition (add or exclude): ${undispositioned.join(', ')}`,
            );
          }

          // Missing units retire through the same adjustment core as manual adjustments (F068).
          const missing = [...expected].filter((s) => !counted.has(s));
          const missingUnits: IStockUnit[] = [];
          for (const serial of missing) {
            const unit = (await trx('stock_units')
              .where({ tenant, service_id: line.service_id, serial_number: serial, location_id: locationId, status: 'in_stock' })
              .forUpdate()
              .first()) as IStockUnit | undefined;
            if (!unit) continue; // moved since snapshot — covered by staleness next round
            missingUnits.push(unit);
          }
          if (missingUnits.length > 0) {
            const adjustment = await adjustStockCore(trx, tenant, user.user_id, {
              service_id: line.service_id,
              location_id: locationId,
              delta: -missingUnits.length,
              reason,
              unit_ids: missingUnits.map((unit) => unit.unit_id),
              source_doc_type: 'manual',
              source_doc_id: sessionId,
            });
            if (adjustment.pending_stock_low_event) {
              pendingStockLowEvents.push(adjustment.pending_stock_low_event);
            }
            const adjustedIds = new Set(adjustment.unit_ids);
            result.retired_serials.push(
              ...missingUnits
                .filter((unit) => adjustedIds.has(unit.unit_id))
                .map((unit) => unit.serial_number)
                .filter(Boolean) as string[],
            );
          }

          // Found units also enter through the adjustment core with their real serials.
          const additions = unexpected
            .map((serial) => dispositionBySerial.get(serial)!)
            .filter((disposition) => disposition.action === 'add');
          if (additions.length > 0) {
            const adjustment = await adjustStockCore(trx, tenant, user.user_id, {
              service_id: line.service_id,
              location_id: locationId,
              delta: additions.length,
              reason,
              serials: additions.map((disposition) => ({
                serial_number: disposition.serial_number.trim(),
                mac_address: disposition.mac_address,
              })),
              source_doc_type: 'manual',
              source_doc_id: sessionId,
              unit_cost: line.average_cost ?? null,
              cost_currency: line.cost_currency ?? defaultCurrency,
              unit_notes: `Found via ${reason}`,
              skip_mac_uniqueness_check: true,
            });
            if (adjustment.pending_stock_low_event) {
              pendingStockLowEvents.push(adjustment.pending_stock_low_event);
            }
            result.added_serials.push(...additions.map((disposition) => disposition.serial_number.trim()));
          }
          const applied = result.added_serials.length - result.retired_serials.length;
          if (applied !== 0) result.adjustments.push({ service_id: line.service_id, delta: applied });
        } else {
          const delta = Number(line.counted_qty) - Number(line.expected_qty);
          if (delta !== 0) {
            const adjustment = await adjustStockCore(trx, tenant, user.user_id, {
              service_id: line.service_id,
              location_id: locationId,
              delta,
              reason,
              source_doc_type: 'manual',
              source_doc_id: sessionId,
            });
            if (adjustment.pending_stock_low_event) {
              pendingStockLowEvents.push(adjustment.pending_stock_low_event);
            }
            result.adjustments.push({ service_id: line.service_id, delta });
          }
        }
      }

      const [updated] = await trx('count_sessions')
        .where({ tenant, session_id: sessionId })
        .update({
          status: 'approved',
          approved_by: user.user_id,
          approved_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning('*');
      result.session = updated as ICountSession;
      const facts = await loadCountEventFacts(trx, tenant, sessionId);
      return { result, pendingStockLowEvents, facts };
    });
    for (const signal of outcome.pendingStockLowEvents) {
      await publishInventoryEvent('INVENTORY_STOCK_LOW', signal);
    }
    await publishInventoryEvent('INVENTORY_COUNT_APPROVED', timestampPayload({
      tenant,
      session_id: outcome.result.session.session_id,
      location_id: outcome.result.session.location_id,
      ...outcome.facts,
      adjustment_line_count: outcome.result.adjustments.length,
      stale_line_count: outcome.result.stale_service_ids.length,
      uncounted_line_count: outcome.result.uncounted_service_ids.length,
      user_id: user.user_id,
    }));
    return outcome.result;
    });
  },
);
