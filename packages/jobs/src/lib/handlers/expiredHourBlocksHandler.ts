import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, getConnection, tenantDb, resolveEffectiveTimeZone } from '@alga-psa/db';
import { IHourBlock } from '@alga-psa/types';
import { reconcileLineAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import { toCalendarDateString, toCalendarDateStringInTimeZone } from '@alga-psa/core';
import { deriveClientContractStatus } from '@alga-psa/shared/billingClients/clientContractStatus';
import { resolvePrepaidBlockBusinessDate, toDateOnly } from '@alga-psa/billing/lib/prepaidBlockDates';
import { cancelScheduledIssuances } from '@alga-psa/billing/services/prepaidBlockIssuanceSync';

export interface ExpiredHourBlocksJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string; // Optional: process only a specific client
}

const tenantScopedTable = (trx: Knex.Transaction, table: string, tenant: string) =>
  tenantDb(trx, tenant).table(table);

interface ContractEndBlock {
  block_id: string;
  contract_line_id: string;
  client_contract_id: string;
  end_date: string | null;
  assignment_status: 'expired' | 'terminated';
}

/**
 * Active contract blocks (with minutes left) whose owning assignment ended without renewal:
 * end_date passed in the tenant business date, or the assignment is inactive
 * (deriveClientContractStatus 'expired' / 'terminated'). Assignments marked `renewing`
 * (cc.status, with or without a linked renewal draft) that merely expired are skipped: their blocks
 * keep running to their own expiration_date. A terminated assignment is forfeited even if marked
 * renewing (terminated takes precedence).
 */
async function findContractEndBlocks(
  trx: Knex.Transaction,
  tenant: string,
  businessDate: string,
  clientId?: string,
): Promise<ContractEndBlock[]> {
  const db = tenantDb(trx, tenant);
  const query = db.table('hour_blocks as hb');
  db.tenantJoin(query, 'client_contracts as cc', 'cc.client_contract_id', 'hb.client_contract_id');
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cc.contract_id', { type: 'left' });
  query
    .where('hb.status', 'active')
    .whereNotNull('hb.contract_line_id')
    .where('hb.remaining_minutes', '>', 0)
    .where((qb: Knex.QueryBuilder) => qb
      .where('cc.is_active', false)
      .orWhere((ended: Knex.QueryBuilder) => ended.whereNotNull('cc.end_date').where('cc.end_date', '<', businessDate)));
  if (clientId) query.where('hb.client_id', clientId);
  const rows: Array<Record<string, any>> = await query.select(
    'hb.block_id', 'hb.contract_line_id', 'cc.client_contract_id', 'cc.is_active', 'cc.start_date', 'cc.end_date',
    'cc.status as renewal_status', 'ct.status as contract_status',
  );

  const result: ContractEndBlock[] = [];
  for (const row of rows) {
    const status = deriveClientContractStatus({
      isActive: row.is_active === true,
      startDate: toDateOnly(row.start_date),
      endDate: toDateOnly(row.end_date),
      contractStatus: row.contract_status ?? undefined,
      now: businessDate,
    });
    if (status !== 'expired' && status !== 'terminated') continue;
    // Precedence: terminated beats renewing. A renewal flag never shields an assignment that was
    // terminated (is_active=false or the contract itself terminated); only an assignment that
    // simply ran past its end_date ('expired') is spared when marked renewing. Blocks of a
    // renewing assignment keep running to their own expiration_date.
    if (status === 'expired' && row.renewal_status === 'renewing') continue;
    result.push({
      block_id: row.block_id,
      contract_line_id: row.contract_line_id,
      client_contract_id: row.client_contract_id,
      end_date: toDateOnly(row.end_date),
      assignment_status: status,
    });
  }
  return result;
}

/**
 * Job handler for expiring hour blocks whose expiration date has passed.
 *
 * Mirrors expiredCreditsHandler but hour blocks KEEP their remaining minutes
 * for display ("expired with 3.5 hrs unused") — the audit row records the
 * amount. Expired minutes are excluded from current availability, but contract
 * work performed within the block and assignment dates may draw them later.
 *
 * Contract-end pass (captain decision 2): an ACTIVE contract block whose assignment has ended
 * without renewal (end_date passed in the tenant business date, or the assignment is no longer
 * active) is expired the same way, with a `contract_end_expiration` audit row, and the line's
 * scheduled issuances are cancelled (expiry ones superseded). Not forfeited:
 *  - blocks a renewal re-owned (their client_contract_id is the new, live assignment), nor blocks
 *    of an expired assignment marked `renewing` (they run to their own expiry; any draft carry-over
 *    re-owns them at activation);
 *  - `pending` blocks (a draft invoice not yet finalized): the customer may still be invoiced for
 *    them, and voiding one would leave an invoice line with no block. They stay pending; if the
 *    invoice is finalized after the end date the block activates and the next pass forfeits it
 *    (audit row included), so nothing active outlives its contract.
 * Invoiced allocations remain fixed. Uninvoiced time is rechecked against the
 * work-date boundaries when the line is reconciled.
 */
export async function expiredHourBlocksHandler(data: ExpiredHourBlocksJobData): Promise<void> {
  const { tenantId, clientId } = data;

  if (!tenantId) {
    throw new Error('Tenant ID is required for expired hour blocks job');
  }

  await runWithTenant(tenantId, async () => {
    const knex = await getConnection(tenantId);

    // "Today" for expiration eligibility is the TENANT's calendar date, not the
    // worker host's: expiration_date is a DATE column holding the tenant-local
    // calendar date, so a Berlin tenant's block expiring 2026-08-31 is expired
    // the moment Berlin enters 2026-09-01 — even when the worker runs in UTC and
    // still reads 2026-08-31. resolveEffectiveTimeZone reads the tenant's
    // settings timezone and falls back to UTC when none is configured (no
    // "user-local" ground truth exists, and UTC is deterministic across
    // workers). Matches the shared burn engine
    // (hourBlockService.getAvailableHourBlockMinutes).
    const timeZone = await resolveEffectiveTimeZone(knex, tenantId);

    console.log(`Processing expired hour blocks for tenant ${tenantId}${clientId ? ` and client ${clientId}` : ''}`);

    try {
      await knex.transaction(async (trx: Knex.Transaction) => {
        await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenantId]);
        await trx.raw('select set_config(?, ?, true)', ['app.current_user', 'system']);

        const today = toCalendarDateStringInTimeZone(new Date(), timeZone);

        // Prepaid Block lock order: a contract line's config row is locked
        // BEFORE any of its blocks. Peek (unlocked) at the candidate contract
        // lines, lock their config rows in line-id order, then lock blocks below.
        let peek = tenantScopedTable(trx, 'hour_blocks', tenantId)
          .where('status', 'active')
          .whereNotNull('expiration_date')
          .whereNotNull('contract_line_id')
          .where('expiration_date', '<', today)
          .where('remaining_minutes', '>', 0)
          .distinct('contract_line_id');
        if (clientId) {
          peek = peek.where('client_id', clientId);
        }
        const peekedLineIds: string[] = (await peek).map((r: { contract_line_id: string }) => r.contract_line_id);

        // Contract-end candidates (unlocked peek, re-verified on the locked rows below).
        const businessDate = await resolvePrepaidBlockBusinessDate(trx, tenantId);
        const contractEndCandidates = await findContractEndBlocks(trx, tenantId, businessDate, clientId);
        const contractEndByBlock = new Map(contractEndCandidates.map((c) => [c.block_id, c] as const));

        const lockLineIds = [...new Set([...peekedLineIds, ...contractEndCandidates.map((c) => c.contract_line_id)])].sort();
        if (lockLineIds.length > 0) {
          await tenantScopedTable(trx, 'contract_line_prepaid_blocks', tenantId)
            .whereIn('contract_line_id', lockLineIds)
            .orderBy('contract_line_id', 'asc')
            .forUpdate()
            .select('contract_line_id');
        }

        // Lock the candidates (canonical block_id order — the same order
        // allocateTimeEntry/unfinalize lock hour_blocks in) so the eligibility
        // check and the expired transition are one serialized step: a
        // concurrent allocation either already holds/queued on these locks
        // (this query waits, then re-evaluates the committed row) or runs
        // after this transaction commits and no longer sees the block as
        // active. Pre-fix, an allocation could commit against a block between
        // this check and the update below (review run b2b3038e).
        let query = (tenantScopedTable(trx, 'hour_blocks', tenantId) as Knex.QueryBuilder<IHourBlock, IHourBlock[]>)
          .where('status', 'active')
          .where('remaining_minutes', '>', 0)
          .where((qb: Knex.QueryBuilder) => {
            qb.where((expired: Knex.QueryBuilder) => expired.whereNotNull('expiration_date').where('expiration_date', '<', today));
            if (contractEndByBlock.size > 0) qb.orWhereIn('block_id', [...contractEndByBlock.keys()]);
          })
          .orderBy('block_id', 'asc')
          .forUpdate();

        if (clientId) {
          query = query.where('client_id', clientId);
        }

        const expiredBlocks: IHourBlock[] = await query;

        console.log(`Found ${expiredBlocks.length} hour blocks to expire`);

        const now = new Date().toISOString();
        const expiredLineIds = new Set<string>();
        const contractEndLineIds = new Set<string>();
        let contractEndCount = 0;
        for (const block of expiredBlocks) {
          const contractEnd = contractEndByBlock.get(block.block_id);
          // Re-verify on the locked row: a renewal may have re-owned the block since the peek.
          if (contractEnd && block.contract_line_id === contractEnd.contract_line_id
            && block.client_contract_id === contractEnd.client_contract_id) {
            expiredLineIds.add(block.contract_line_id);
            contractEndLineIds.add(block.contract_line_id);
            contractEndCount += 1;
            await tenantScopedTable(trx, 'hour_blocks', tenantId)
              .where({ tenant: tenantId, block_id: block.block_id })
              .update({ status: 'expired', updated_at: now });

            await tenantScopedTable(trx, 'hour_block_audit', tenantId).insert({
              audit_id: uuidv4(),
              tenant: tenantId,
              block_id: block.block_id,
              type: 'contract_end_expiration',
              minutes_delta: null,
              reason: 'Contract ended without renewal; unused prepaid minutes forfeited',
              created_by: null,
              metadata: {
                client_contract_id: contractEnd.client_contract_id,
                assignment_end_date: contractEnd.end_date,
                assignment_status: contractEnd.assignment_status,
                effective_end_date: contractEnd.assignment_status === 'expired' ? contractEnd.end_date : businessDate,
                expiration_date: block.expiration_date ? toCalendarDateString(block.expiration_date) : null,
                remaining_minutes_at_expiration: Number(block.remaining_minutes),
              },
            });
            console.log(`Forfeited hour block ${block.block_id} at contract end (${contractEnd.assignment_status}), remaining: ${block.remaining_minutes}`);
            continue;
          }
          // Not a contract-end block after all: only a date-expired one belongs in the loop below.
          const expirationDay = block.expiration_date ? toCalendarDateString(block.expiration_date) : null;
          if (!expirationDay || expirationDay >= today) continue;
          if (block.contract_line_id) expiredLineIds.add(block.contract_line_id);
          await tenantScopedTable(trx, 'hour_blocks', tenantId)
            .where({ tenant: tenantId, block_id: block.block_id })
            .update({ status: 'expired', updated_at: now });

          await tenantScopedTable(trx, 'hour_block_audit', tenantId).insert({
            audit_id: uuidv4(),
            tenant: tenantId,
            block_id: block.block_id,
            type: 'auto_expiration',
            minutes_delta: null,
            reason: 'Auto-expired by nightly job',
            created_by: null,
            metadata: {
              expiration_date: toCalendarDateString(block.expiration_date),
              remaining_minutes_at_expiration: Number(block.remaining_minutes),
            },
          });

          console.log(`Expired hour block ${block.block_id} for client ${block.client_id}, remaining: ${block.remaining_minutes}`);
        }

        // Expiry shrinks the line's available pool: re-draw uninvoiced entries so
        // Recheck uninvoiced entries against the block and assignment dates;
        // invoiced allocations stay fixed. The audit rows above are kept as-is.
        // An ended contract owes nothing further: cancel the line's scheduled issuances (config row is
        // already locked above) before the re-draw.
        for (const lineId of [...contractEndLineIds].sort()) {
          await cancelScheduledIssuances(trx, tenantId, lineId, 'Contract ended; the line\'s blocks were forfeited');
        }

        for (const lineId of [...expiredLineIds].sort()) {
          await reconcileLineAllocations(trx, tenantId, lineId);
        }

        console.log(`Successfully processed ${expiredBlocks.length} hour blocks (${contractEndCount} forfeited at contract end)`);
      });
    } catch (error: any) {
      console.error(`Error processing expired hour blocks: ${error.message}`, error);
      throw error; // Re-throw to let pg-boss handle the failure
    }
  });
}
