import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, getConnection, tenantDb } from '@alga-psa/db';
import { IHourBlock } from '@alga-psa/types';
import { toCalendarDateString } from '@alga-psa/core';

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

    console.log(`Processing expired hour blocks for tenant ${tenantId}${clientId ? ` and client ${clientId}` : ''}`);

    try {
      await knex.transaction(async (trx: Knex.Transaction) => {
        await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenantId]);
        await trx.raw('select set_config(?, ?, true)', ['app.current_user', 'system']);

        // "Today" for expiration eligibility is the server's LOCAL calendar date:
        // expiration_date is a DATE column holding the user-local calendar date, so
        // a block expiring 2026-08-31 is expired the moment local time enters
        // 2026-09-01 — even while UTC still reads 2026-08-31. UTC-today (the old
        // `toISODate(toPlainDate(new Date().toISOString()))`) delayed auto-expiration
        // by up to 24h in positive-offset zones. Matches the shared burn engine
        // (hourBlockService.getAvailableHourBlockMinutes).
        const today = toCalendarDateString(new Date());

        let query = (tenantScopedTable(trx, 'hour_blocks', tenantId) as Knex.QueryBuilder<IHourBlock, IHourBlock[]>)
          .where('status', 'active')
          .whereNotNull('expiration_date')
          .where('expiration_date', '<', today)
          .where('remaining_minutes', '>', 0);

        if (clientId) {
          query = query.where('client_id', clientId);
        }

        const expiredBlocks: IHourBlock[] = await query;

        console.log(`Found ${expiredBlocks.length} expired hour blocks to process`);

        const now = new Date().toISOString();
        for (const block of expiredBlocks) {
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

        console.log(`Successfully processed ${expiredBlocks.length} expired hour blocks`);
      });
    } catch (error: any) {
      console.error(`Error processing expired hour blocks: ${error.message}`, error);
      throw error; // Re-throw to let pg-boss handle the failure
    }
  });
}
