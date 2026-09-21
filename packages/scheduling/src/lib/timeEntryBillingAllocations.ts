import type { Knex } from 'knex';
import { adjustTimeSpanDraw } from '@alga-psa/shared/billingClients/drawAdjustments';
import { isBucketUsageError } from '@alga-psa/shared/billingClients/bucketUsageErrors';
import { allocateTimeEntry, reverseTimeEntryAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import { getClientIdForWorkItem } from '../actions/timeEntryHelpers';

/** Reconcile the actual old/new rows inside their owning save transaction. */
export async function reconcileTimeEntryBillingAllocations(trx: Knex.Transaction, tenant: string, oldEntrySpan: any | null, resultingEntry: any) {
  if (!trx.isTransaction) throw new Error('Time billing requires its owning transaction');
  if (resultingEntry.billing_mode === 'operational' && oldEntrySpan?.billing_mode !== 'commercial') return;
  const entry_id = oldEntrySpan ? resultingEntry.entry_id : undefined;
  const oldDuration = Number(oldEntrySpan?.billable_duration ?? 0);
  // --- Bucket Usage Update Logic ---
  // Ordering matters: the OLD draw must be fully reversed BEFORE the NEW
  // draw is applied. findOrCreateCurrentBucketUsageRecord computes rollover
  // from the previous period's minutes_used, and updateBucketUsageMinutes
  // derives overage from the running total — both snapshot whatever usage
  // state exists at the moment they run. If the new draw ran first, a
  // cross-period edit/reassignment would create (or update) the target
  // period's record with rollover computed from usage that still includes
  // the old, not-yet-reversed draw, leaving stale rollover behind. So:
  // reverse the old side first (under the OLD entry's own client derived
  // from its own work item, span, service, and line), then apply the new
  // side (under the NEW entry's own client, span, service, and line).
  // Rollover state is only ever computed from post-reversal data.
  // Never reuse the new context to reverse the old draw (or vice versa) —
  // that would reverse against the wrong pool when an entry moves
  // clients/lines.

  // Old side (updates only): resolve the reversal under the OLD entry's own
  // client (its own work item), span, service, and line — before any new
  // draw runs.
  let oldClientId: string | null = null;
  if (entry_id && oldEntrySpan?.work_item_id && oldEntrySpan.work_item_type) {
    oldClientId = await getClientIdForWorkItem(trx, tenant, oldEntrySpan.work_item_id as string, oldEntrySpan.work_item_type as string);
  }
  if (entry_id && oldClientId && oldEntrySpan?.service_id && oldEntrySpan.start_time) {
    try {
      const reversedDelta = await adjustTimeSpanDraw(
        trx,
        tenant,
        oldClientId,
        {
          service_id: oldEntrySpan.service_id,
          start_time: oldEntrySpan.start_time,
          end_time: oldEntrySpan.end_time ?? oldEntrySpan.start_time,
          billable_duration: oldDuration,
          contract_line_id: oldEntrySpan.contract_line_id ?? null,
        },
        -1,
      );
      if (reversedDelta !== 0) {
        console.log(`Reversed old bucket usage for entry ${resultingEntry?.entry_id} (weighted ${reversedDelta})`);
      }
    } catch (bucketError) {
      if (isBucketUsageError(bucketError)) throw bucketError;
      throw new Error(`Bucket usage reversal failed for time entry ${resultingEntry?.entry_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
    }
  }

  // New side: apply the saved entry's burn when it resolves to a pool.
  let newClientId: string | null = null;
  if (resultingEntry?.work_item_id && resultingEntry.work_item_type) {
    newClientId = await getClientIdForWorkItem(trx, tenant, resultingEntry.work_item_id as string, resultingEntry.work_item_type as string);
  }
  if (newClientId) {
    if (resultingEntry && resultingEntry.service_id && (resultingEntry.billable_duration || 0) > 0) {
      try {
        const appliedDelta = await adjustTimeSpanDraw(
          trx,
          tenant,
          newClientId,
          {
            service_id: resultingEntry.service_id,
            start_time: resultingEntry.start_time,
            end_time: resultingEntry.end_time,
            billable_duration: resultingEntry.billable_duration,
            contract_line_id: resultingEntry.contract_line_id ?? null,
          },
          1,
        );
        if (appliedDelta !== 0) {
          console.log(`Applied new bucket usage for entry ${resultingEntry.entry_id} (weighted ${appliedDelta})`);
        }
      } catch (bucketError) {
        if (isBucketUsageError(bucketError)) throw bucketError;
        throw new Error(`Bucket usage update failed for time entry ${resultingEntry.entry_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
      }
    }
  }
  // --- End Bucket Usage Update Logic ---

  // --- Hour-block burn logic ---
  // Applies only when the entry is NOT contract-covered (contracts always
  // win), so it never fires for the bucket path above — the two are
  // mutually exclusive by construction. Block burn is best-effort on save:
  // a failure is logged, never aborts the entry save, and the nightly
  // reconcile converges allocations to the canonical FIFO state.
  // The reverse-on-update runs UNCONDITIONALLY (before any eligibility
  // check): an entry edited to be contract-covered, non-billable, or
  // serviceless must still give its minutes back to the blocks immediately
  // — otherwise the client loses block minutes AND pays the contract/
  // hourly rate until the nightly reconcile catches up.
  try {
    // A caught PostgreSQL error still leaves its transaction aborted. Use
    // a nested transaction (SAVEPOINT) so a best-effort burn failure rolls
    // back only the reverse/re-allocation work, not the time-entry save.
    await trx.transaction(async (burnTrx) => {
      const savedEntryId = resultingEntry?.entry_id;
      if (entry_id && savedEntryId) {
        // Update: reverse then re-allocate (clean FIFO, no delta).
        await reverseTimeEntryAllocations(burnTrx, tenant, savedEntryId);
      }
      if (resultingEntry && resultingEntry.service_id && (resultingEntry.billable_duration || 0) > 0) {
        let blockClientId: string | null = null;
        if (resultingEntry.work_item_id && resultingEntry.work_item_type) {
          blockClientId = await getClientIdForWorkItem(
            burnTrx,
            tenant,
            resultingEntry.work_item_id as string,
            resultingEntry.work_item_type as string,
          );
        }
        if (blockClientId && !resultingEntry.contract_line_id) {
          const burnEntry = {
            entry_id: savedEntryId!,
            service_id: resultingEntry.service_id,
            billable_duration: resultingEntry.billable_duration,
            contract_line_id: resultingEntry.contract_line_id,
            work_item_id: resultingEntry.work_item_id,
            work_item_type: resultingEntry.work_item_type,
            work_date: resultingEntry.work_date,
            start_time: resultingEntry.start_time,
          };
          const burned = await allocateTimeEntry(burnTrx, tenant, blockClientId, burnEntry);
          if (burned.length > 0) {
            console.log(`Time entry ${savedEntryId} burned ${burned.reduce((sum, a) => sum + a.minutes, 0)} block minutes.`);
          }
        }
      }
    });
  } catch (blockBurnError) {
    console.error(`Error applying hour-block burn for time entry ${resultingEntry?.entry_id}:`, blockBurnError);
  }
  // --- End Hour-block burn logic ---
}
