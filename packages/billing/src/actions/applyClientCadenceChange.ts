import type { Knex } from 'knex';
import type { BillingCycleType, ISO8601String } from '@alga-psa/types';
import {
  normalizeAnchorSettingsForCycle,
  validateAnchorSettingsForCycle,
  type BillingCycleAnchorSettingsInput,
} from '../lib/billing/billingCycleAnchors';
import { regenerateClientCadenceServicePeriodsForScheduleChange } from './clientCadenceScheduleRegeneration';
import { updateClientBillingSchedule as updateClientBillingScheduleShared } from '@alga-psa/shared/billingClients';

export type ApplyClientCadenceChangeInput = {
  clientId: string;
  billingCycle: BillingCycleType;
  anchor: BillingCycleAnchorSettingsInput;
  billingHistoryStartDate?: ISO8601String | null;
};

/**
 * The single entry point for any change to a client's billing cadence.
 *
 * A client's cadence lives in three places that must stay consistent, plus the
 * ledger that drives invoicing:
 *   1. clients.billing_cycle           — the scalar materialization/repair reads
 *   2. client_billing_settings anchor  — day-of-week / day-of-month / reference
 *   3. client_billing_cycles windows   — what the due-work gap detector reads
 *   4. recurring_service_periods       — regenerated to match the new cadence
 *
 * The shared `updateClientBillingSchedule` owns 1-3 (including history bootstrap
 * and retiring superseded windows); this wrapper adds 4. Every cadence mutation
 * must go through here. When a write path updated the scalar/windows without
 * re-materializing, the ledger drifted and the invoicing screen stranded the
 * client in an unexplained "repair required" state.
 *
 * Billed and invoice-linked periods are preserved: the regeneration only
 * supersedes unbilled rows (see `legacyBilledThroughEnd` in
 * `regenerateClientCadenceServicePeriodsForScheduleChange`).
 *
 * The caller owns the transaction; wrap this in `withTransaction` so the
 * scalar, anchor, windows, and ledger changes commit or roll back together.
 */
export async function applyClientCadenceChange(
  trx: Knex.Transaction,
  tenant: string,
  input: ApplyClientCadenceChangeInput,
): Promise<void> {
  validateAnchorSettingsForCycle(input.billingCycle, input.anchor);
  const normalized = normalizeAnchorSettingsForCycle(input.billingCycle, input.anchor);

  // Scalar + anchor + client_billing_cycles windows (and history bootstrap when
  // a start date is supplied).
  await updateClientBillingScheduleShared(trx, tenant, input);

  // Re-materialize the recurring service period ledger to the new cadence.
  await regenerateClientCadenceServicePeriodsForScheduleChange(trx, {
    tenant,
    clientId: input.clientId,
    billingCycle: input.billingCycle,
    anchor: normalized,
  });
}
