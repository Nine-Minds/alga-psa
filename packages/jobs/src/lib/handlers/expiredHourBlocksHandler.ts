import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, getConnection, tenantDb, resolveEffectiveTimeZone } from '@alga-psa/db';
import { IHourBlock } from '@alga-psa/types';
import { reconcileLineAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import { toCalendarDateString, toCalendarDateStringInTimeZone } from '@alga-psa/core';

export interface ExpiredHourBlocksJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string; // Optional: process only a specific client
}

const tenantScopedTable = (trx: Knex.Transaction, table: string, tenant: string) =>
  tenantDb(trx, tenant).table(table);

/**
 * Job handler for expiring hour blocks whose expiration date has passed.
 *
 * Mirrors expiredCreditsHandler but hour blocks KEEP their remaining minutes
 * for display ("expired with 3.5 hrs unused") — the audit row records the
 * amount. Balance/eligibility queries filter on status, so keeping the minutes
 * is display-only and never lets an expired block burn.
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
        const peekedLineIds: string[] = (await peek).map((r: { contract_line_id: string }) => r.contract_line_id).sort();
        if (peekedLineIds.length > 0) {
          await tenantScopedTable(trx, 'contract_line_prepaid_blocks', tenantId)
            .whereIn('contract_line_id', peekedLineIds)
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
          .whereNotNull('expiration_date')
          .where('expiration_date', '<', today)
          .where('remaining_minutes', '>', 0)
          .orderBy('block_id', 'asc')
          .forUpdate();

        if (clientId) {
          query = query.where('client_id', clientId);
        }

        const expiredBlocks: IHourBlock[] = await query;

        console.log(`Found ${expiredBlocks.length} expired hour blocks to process`);

        const now = new Date().toISOString();
        const expiredLineIds = new Set<string>();
        for (const block of expiredBlocks) {
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
        // work that was only covered by the expired block's remainder falls to
        // overage (entries already drawn against the expired block stay as they
        // were). The audit rows above are kept as-is.
        // TODO(captain-decision-2): contract-end forfeiture belongs here. When a
        // contract ends (client_contracts.end_date passed / terminated), active
        // contract blocks on its lines would be force-expired with a distinct
        // audit reason (e.g. 'contract_end_forfeiture') in this same pass, before
        // the re-draw below. Not implemented pending the captain's decision on
        // whether unused prepaid hours are forfeited at contract end.
        for (const lineId of [...expiredLineIds].sort()) {
          await reconcileLineAllocations(trx, tenantId, lineId);
        }

        console.log(`Successfully processed ${expiredBlocks.length} expired hour blocks`);
      });
    } catch (error: any) {
      console.error(`Error processing expired hour blocks: ${error.message}`, error);
      throw error; // Re-throw to let pg-boss handle the failure
    }
  });
}
