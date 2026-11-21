/**
 * The SLA side of `reevaluateSlaPause` (@alga-psa/shared/lib/sla/slaPauseConditions). A package
 * that contributes a pause condition asks for a re-evaluation through that port when its condition
 * changes; it never imports this package (see the port for why).
 *
 * Registration is a side effect of loading this module, which the services barrel does.
 */
import type { Knex } from 'knex';
import { registerAfterCommit, runWithTenant } from '@alga-psa/db';
import { registerSlaPauseReevaluator } from '@alga-psa/shared/lib/sla/slaPauseConditions';
import { dispatchSlaBackendActions } from './slaBackendActions';
import { syncPauseState } from './slaPauseService';

/**
 * Pauses or resumes the ticket's clock to match its pause conditions as they now stand. A failed
 * write throws, so a caller using the `rollback` policy commits its change and the clock fact
 * together or not at all. The timer backend is told after the transaction commits, never from
 * inside it.
 */
export async function reevaluateSlaPauseState(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  actorUserId?: string,
): Promise<void> {
  const result = await syncPauseState(trx, tenant, ticketId, actorUserId);
  if (!result.success) throw new Error(`SLA pause state could not be re-evaluated: ${result.error ?? 'unknown error'}`);
  const backendActions = result.backendActions;
  if (backendActions?.length) {
    registerAfterCommit(trx, () => runWithTenant(tenant, () => dispatchSlaBackendActions(backendActions)),
      `SLA_PAUSE_REEVALUATION ticket=${ticketId}`);
  }
}

registerSlaPauseReevaluator(reevaluateSlaPauseState);
