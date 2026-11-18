import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { reconcileLineAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import { resolvePrepaidBlockBusinessDate, toDateOnly } from '../lib/prepaidBlockDates';
import {
  EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON,
  supersedeExpiryIssuancesForLine,
  supersedeScheduledExpiryForRenewal,
} from './prepaidBlockLifecycleService';

/**
 * Renewal behaviour of Prepaid Block lines (plan section 6 "Renewal trigger", captain decision 1).
 *
 *  (a) scheduleRenewalIssuancesForRolledCycle: the renewal cycle of an assignment that continues
 *      rolled (the job detects it from the assignment dates) -> one `renewal` issuance per block
 *      line with trigger_on_renewal, due on the new cycle start. A scheduled expiry issuance does
 *      not block it: the renewal block is the newer block, so the expiry issuance is superseded
 *      (restored if the renewal block is voided). Any other open issuance, or a pending block,
 *      makes it skip and report.
 *  (b) reownBlocksForRenewalActivation: a renewal draft was activated -> the source assignment's
 *      unexpired contract blocks move to the matching block line of the new contract.
 *
 * Neither path resets or extends a block: expiration_date and remaining_minutes are never written.
 * Lock order (plan Risk 6): config rows (line-id order), issuance rows, then hour_blocks in block_id
 * order, then reconcileLineAllocations per affected line.
 */

function table(conn: Knex | Knex.Transaction, tenant: string, name: string) {
  return tenantDb(conn, tenant).table(name);
}

/** Prepaid Block lines of a contract (those with a config row), in line-id order. */
async function blockLineIds(
  trx: Knex.Transaction,
  tenant: string,
  contractId: string,
  filter: { triggerOnRenewal?: boolean },
): Promise<string[]> {
  const db = tenantDb(trx, tenant);
  const query = db.table('contract_lines as cl');
  db.tenantJoin(query, 'contract_line_prepaid_blocks as cfg', 'cfg.contract_line_id', 'cl.contract_line_id');
  query.where({ 'cl.contract_id': contractId });
  if (filter.triggerOnRenewal) query.where({ 'cfg.trigger_on_renewal': true });
  const rows: Array<{ contract_line_id: string }> = await query
    .orderBy('cl.contract_line_id', 'asc')
    .select('cl.contract_line_id');
  return rows.map((r) => r.contract_line_id);
}

export type RenewalIssuanceOutcome =
  | { contractLineId: string; action: 'scheduled'; issuanceId: string; dueDate: string }
  | { contractLineId: string; action: 'already_issued' }
  | { contractLineId: string; action: 'skipped_open_issuance'; openKind: string; openDueDate: string | null }
  | { contractLineId: string; action: 'skipped_pending_block' }
  | { contractLineId: string; action: 'skipped_line_started_after_cycle' };

export interface RolledRenewalCycle {
  clientContractId: string;
  clientId: string;
  contractId: string;
  /** Assignment end_date (null = evergreen). */
  endDate: unknown;
  /** The new renewal_cycle_start, YYYY-MM-DD. */
  newCycleStart: string;
}

/**
 * Inserts the `renewal` issuance for every block line of the rolled assignment's contract that has
 * trigger_on_renewal. Runs inside the caller's transaction. Never throws for an open issuance (the
 * partial unique index allows one `scheduled` row per line): an open `expiry` issuance is superseded
 * (EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON, source block carried on the renewal issuance); any other
 * kind is reported as `skipped_open_issuance`, a pending block as `skipped_pending_block`. A line whose
 * block config (or the line itself) was created on or after the cycle start never owed that renewal
 * (`skipped_line_started_after_cycle`), which keeps a deploy from back-filling old cycles.
 *
 * Idempotent per (line, assignment, cycle start): a `renewal` issuance already recorded for that
 * due date in any status (including `invoiced`, after the block was already issued) is not repeated.
 * "Continues" = evergreen, or end_date falls after the new cycle start; otherwise nothing is done.
 */
export async function scheduleRenewalIssuancesForRolledCycle(
  trx: Knex.Transaction,
  tenant: string,
  cycle: RolledRenewalCycle,
): Promise<RenewalIssuanceOutcome[]> {
  const endDate = toDateOnly(cycle.endDate);
  if (endDate && endDate <= cycle.newCycleStart) return [];

  const lineIds = await blockLineIds(trx, tenant, cycle.contractId, { triggerOnRenewal: true });

  const outcomes: RenewalIssuanceOutcome[] = [];
  for (const contractLineId of lineIds) {
    // Config lock first; re-read the trigger under it (it may have been switched off since the peek).
    const config = await table(trx, tenant, 'contract_line_prepaid_blocks')
      .where({ contract_line_id: contractLineId })
      .forUpdate()
      .first('trigger_on_renewal', 'created_at');
    if (!config?.trigger_on_renewal) continue;

    const line = await table(trx, tenant, 'contract_lines')
      .where({ contract_line_id: contractLineId })
      .first('created_at');
    const startedOn = await Promise.all(
      [config.created_at, line?.created_at].map((at) => (at ? resolvePrepaidBlockBusinessDate(trx, tenant, at) : null)),
    );
    if (startedOn.some((day) => day && day >= cycle.newCycleStart)) {
      outcomes.push({ contractLineId, action: 'skipped_line_started_after_cycle' });
      continue;
    }

    const already = await table(trx, tenant, 'contract_line_block_issuances')
      .where({
        contract_line_id: contractLineId,
        client_contract_id: cycle.clientContractId,
        trigger_kind: 'renewal',
        due_date: cycle.newCycleStart,
      })
      .first('issuance_id');
    if (already) {
      outcomes.push({ contractLineId, action: 'already_issued' });
      continue;
    }

    const open = await table(trx, tenant, 'contract_line_block_issuances')
      .where({ contract_line_id: contractLineId, status: 'scheduled' })
      .first('trigger_kind', 'due_date');
    if (open && open.trigger_kind !== 'expiry') {
      outcomes.push({
        contractLineId,
        action: 'skipped_open_issuance',
        openKind: open.trigger_kind,
        openDueDate: toDateOnly(open.due_date),
      });
      continue;
    }
    const pending = await table(trx, tenant, 'hour_blocks')
      .where({ contract_line_id: contractLineId, status: 'pending' })
      .first('block_id');
    if (pending) {
      outcomes.push({ contractLineId, action: 'skipped_pending_block' });
      continue;
    }

    const replaced = open ? await supersedeScheduledExpiryForRenewal(trx, tenant, contractLineId) : null;
    const issuanceId = uuidv4();
    await table(trx, tenant, 'contract_line_block_issuances').insert({
      tenant,
      issuance_id: issuanceId,
      contract_line_id: contractLineId,
      client_contract_id: cycle.clientContractId,
      client_id: cycle.clientId,
      trigger_kind: 'renewal',
      due_date: cycle.newCycleStart,
      status: 'scheduled',
      source_block_id: replaced?.sourceBlockId ?? null,
    });
    outcomes.push({ contractLineId, action: 'scheduled', issuanceId, dueDate: cycle.newCycleStart });
  }
  return outcomes;
}

export interface BlockReownershipResult {
  /** Blocks moved to a matching line of the renewal contract. */
  reowned: Array<{ blockId: string; fromLineId: string; toLineId: string }>;
  /** Source lines with live blocks and no matching line on the renewal contract (behaviour 6 forfeits them). */
  unmatchedSourceLineIds: string[];
}

async function lineServiceSet(trx: Knex.Transaction, tenant: string, lineIds: string[]): Promise<Map<string, string>> {
  const rows: Array<{ contract_line_id: string; service_id: string }> = lineIds.length === 0
    ? []
    : await table(trx, tenant, 'contract_line_services')
      .whereIn('contract_line_id', lineIds)
      .select('contract_line_id', 'service_id');
  const byLine = new Map<string, string[]>(lineIds.map((id) => [id, []]));
  for (const row of rows) byLine.get(row.contract_line_id)!.push(row.service_id);
  return new Map([...byLine].map(([id, services]) => [id, [...new Set(services)].sort().join(',')]));
}

/**
 * Re-owns the source assignment's unexpired contract blocks (active, plus pending ones awaiting
 * finalization, with an expiration date not before the business date) to the Prepaid Block line of
 * the renewal contract whose covered-service set equals the source line's. Moves only ownership:
 * hour_blocks.client_contract_id / contract_line_id change, with a `reassignment` audit row each.
 *
 *  - A line that inherits blocks still issues a new block on the renewal date when its
 *    trigger_on_renewal is on (the `renewal` start issuance of the new assignment stays; the inherited
 *    blocks keep running). A `contract_start` issuance on it is cancelled (never issued on a renewal).
 *  - A scheduled expiry issuance triggered by a moved block follows it to the new line when the new
 *    line has trigger_on_expiry and no other open issuance; when the new line has an open renewal
 *    issuance it is superseded with the renewal reason (restored if the renewal block is voided);
 *    otherwise it is superseded.
 *  - Time drawn from a moved block by the source line's still-uninvoiced entries is released by the
 *    reconcile of the new line (a block of contract A is never drawn by other-contract time); the
 *    entries then bill normally and the block gets the minutes back. Invoiced draws are untouched.
 *
 * Returns without writing when the renewal contract has no active assignment yet.
 */
export async function reownBlocksForRenewalActivation(
  trx: Knex.Transaction,
  tenant: string,
  input: { sourceClientContractId: string; renewalContractId: string; userId: string | null },
): Promise<BlockReownershipResult> {
  const result: BlockReownershipResult = { reowned: [], unmatchedSourceLineIds: [] };

  const target = await table(trx, tenant, 'client_contracts')
    .where({ contract_id: input.renewalContractId, is_active: true })
    .orderBy('start_date', 'asc')
    .first('client_contract_id', 'client_id');
  if (!target || target.client_contract_id === input.sourceClientContractId) return result;

  const businessDate = await resolvePrepaidBlockBusinessDate(trx, tenant);

  // Unlocked peek: which source lines have unexpired blocks, and which new lines could take them.
  const peeked: Array<{ contract_line_id: string }> = await table(trx, tenant, 'hour_blocks')
    .where({ client_contract_id: input.sourceClientContractId })
    .whereNotNull('contract_line_id')
    .whereIn('status', ['active', 'pending'])
    .where((qb: Knex.QueryBuilder) => qb.whereNull('expiration_date').orWhere('expiration_date', '>=', businessDate))
    .distinct('contract_line_id');
  const sourceLineIds = peeked.map((r) => r.contract_line_id).sort();
  if (sourceLineIds.length === 0) return result;

  const targetLineIds = await blockLineIds(trx, tenant, input.renewalContractId, {});

  const sourceSets = await lineServiceSet(trx, tenant, sourceLineIds);
  const targetSets = await lineServiceSet(trx, tenant, targetLineIds);
  const lineMap = new Map<string, string>();
  for (const sourceLineId of sourceLineIds) {
    const set = sourceSets.get(sourceLineId)!;
    // An empty covered-service set is "no services": never matches anything.
    const match = set === '' ? undefined : targetLineIds.find((id) => targetSets.get(id) === set);
    if (match) lineMap.set(sourceLineId, match);
    else result.unmatchedSourceLineIds.push(sourceLineId);
  }
  if (lineMap.size === 0) return result;

  // 1. Config locks (source and target lines, line-id order).
  const lockLineIds = [...new Set([...lineMap.keys(), ...lineMap.values()])].sort();
  await table(trx, tenant, 'contract_line_prepaid_blocks')
    .whereIn('contract_line_id', lockLineIds)
    .orderBy('contract_line_id', 'asc')
    .forUpdate()
    .select('contract_line_id');

  // 2. Blocks, canonical block_id order; eligibility is re-evaluated on the locked rows.
  const locked: Array<{
    block_id: string; contract_line_id: string; status: string; expiration_date: unknown;
  }> = await table(trx, tenant, 'hour_blocks')
    .where({ client_contract_id: input.sourceClientContractId })
    .whereIn('contract_line_id', [...lineMap.keys()])
    .orderBy('block_id', 'asc')
    .forUpdate()
    .select('block_id', 'contract_line_id', 'status', 'expiration_date');
  const movable = locked.filter((b) => {
    if (b.status !== 'active' && b.status !== 'pending') return false;
    const expiration = toDateOnly(b.expiration_date);
    return !expiration || expiration >= businessDate;
  });

  const now = new Date().toISOString();
  const movedByTargetLine = new Map<string, string[]>();
  for (const block of movable) {
    const toLineId = lineMap.get(block.contract_line_id)!;
    await table(trx, tenant, 'hour_blocks')
      .where({ block_id: block.block_id })
      .update({ client_contract_id: target.client_contract_id, contract_line_id: toLineId, updated_at: now });
    await table(trx, tenant, 'hour_block_audit').insert({
      audit_id: uuidv4(),
      tenant,
      block_id: block.block_id,
      type: 'reassignment',
      minutes_delta: null,
      reason: 'Re-owned by contract renewal',
      created_by: input.userId,
      metadata: {
        from_contract_line_id: block.contract_line_id,
        to_contract_line_id: toLineId,
        from_client_contract_id: input.sourceClientContractId,
        to_client_contract_id: target.client_contract_id,
      },
    });
    result.reowned.push({ blockId: block.block_id, fromLineId: block.contract_line_id, toLineId });
    movedByTargetLine.set(toLineId, [...(movedByTargetLine.get(toLineId) ?? []), block.block_id]);
  }

  // 3. Issuances: no contract_start on a renewal contract; expiry issuances follow their block.
  for (const toLineId of [...movedByTargetLine.keys()].sort()) {
    await table(trx, tenant, 'contract_line_block_issuances')
      .where({
        contract_line_id: toLineId,
        client_contract_id: target.client_contract_id,
        status: 'scheduled',
      })
      .where({ trigger_kind: 'contract_start' })
      .update({
        status: 'cancelled',
        cancel_reason: 'A renewal contract never issues a contract_start block',
        updated_at: now,
      });
  }
  for (const move of result.reowned) {
    const expiry = await table(trx, tenant, 'contract_line_block_issuances')
      .where({
        contract_line_id: move.fromLineId, trigger_kind: 'expiry', status: 'scheduled', source_block_id: move.blockId,
      })
      .first('issuance_id');
    if (!expiry) continue;
    const toConfig = await table(trx, tenant, 'contract_line_prepaid_blocks')
      .where({ contract_line_id: move.toLineId })
      .first('trigger_on_expiry');
    const open = await table(trx, tenant, 'contract_line_block_issuances')
      .where({ contract_line_id: move.toLineId, status: 'scheduled' })
      .first('issuance_id', 'trigger_kind', 'source_block_id');
    if (toConfig?.trigger_on_expiry && !open) {
      await table(trx, tenant, 'contract_line_block_issuances')
        .where({ issuance_id: expiry.issuance_id })
        .update({
          contract_line_id: move.toLineId,
          client_contract_id: target.client_contract_id,
          client_id: target.client_id,
          updated_at: now,
        });
    } else if (open?.trigger_kind === 'renewal') {
      // The renewal block is the newer block: the moved block's expiry issuance is superseded on the
      // new line (so a void of the renewal block restores it there) and recorded on the renewal.
      await table(trx, tenant, 'contract_line_block_issuances')
        .where({ issuance_id: expiry.issuance_id })
        .update({
          contract_line_id: move.toLineId,
          client_contract_id: target.client_contract_id,
          client_id: target.client_id,
          status: 'superseded',
          cancel_reason: EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON,
          updated_at: now,
        });
      if (!open.source_block_id) {
        await table(trx, tenant, 'contract_line_block_issuances')
          .where({ issuance_id: open.issuance_id })
          .update({ source_block_id: move.blockId, updated_at: now });
      }
    } else {
      await supersedeExpiryIssuancesForLine(trx, tenant, move.fromLineId, {
        reason: 'The source block was re-owned by a renewal and the new line does not carry its expiry issuance',
        onlySourceBlockId: move.blockId,
      });
    }
  }
  // 4. Re-draw each affected line (canonical line order).
  const affected = new Set<string>([...movedByTargetLine.keys(), ...result.reowned.map((m) => m.fromLineId)]);
  for (const lineId of [...affected].sort()) {
    await reconcileLineAllocations(trx, tenant, lineId);
  }
  return result;
}
