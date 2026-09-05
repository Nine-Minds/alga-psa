'use server';

import { resolveNextUnbilledSeatBoundary } from '../lib/billing/seatRevisions';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { revalidatePath } from 'next/cache';
import { UsageMeasurementMode } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { setUsageMeasurementModeInTransaction } from '../lib/billing/usageMeasurementTransitions';

type ContractLineSemanticsActionError = ActionMessageError | ActionPermissionError;

/**
 * Server boundary for explicit usage measurement-mode authoring.
 *
 * Changing a service configuration between additive consumption and
 * period-total reporting is a semantic transition, not a relabel: entries and
 * one replaceable period count cannot coexist for the same service/period.
 * The guards below keep history billable and never orphan records:
 *
 *  - switching TO period_total is refused while unbilled additive entries are
 *    attributed to the (line, service) — those entries would otherwise never
 *    bill because the engine stops treating the service as additive;
 *  - switching TO additive is refused while an unbilled (recorded) period
 *    total exists for the configuration — the reported count would otherwise
 *    never be billed.
 *
 * Billed history is untouched: already-invoiced additive entries and already
 * consumed period totals remain evidence of past reporting under their own
 * semantics.
 */
export const setUsageMeasurementMode = withAuth(
  async (
    user,
    { tenant },
    input: {
      config_id: string;
      contract_line_id: string;
      service_id: string;
      measurement_mode: UsageMeasurementMode;
      effective_period_start?: string;
    },
  ): Promise<{ measurement_mode: UsageMeasurementMode } | ContractLineSemanticsActionError> => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      return permissionError('Permission denied: billing update required');
    }
    if (input.measurement_mode !== 'additive' && input.measurement_mode !== 'period_total') {
      return actionError('Measurement mode must be additive or period_total.');
    }
    try {
      const { knex } = await createTenantKnex();
      const result = await knex.transaction(async (trx) => {
        const transition = await setUsageMeasurementModeInTransaction({ trx, tenant, input });
        if (!transition.ok) {
          return actionError(transition.error);
        }
        return { measurement_mode: transition.measurement_mode };
      });
      revalidatePath('/msp/billing');
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Permission denied:')) {
        return permissionError(error.message);
      }
      throw error;
    }
  },
);

export const getNextContractServiceBoundary = withAuth(async (user, {tenant}, contractLineId: string) => {
  if (!(await hasPermission(user, 'billing', 'read'))) return permissionError('Permission denied: billing read required');
  const {knex} = await createTenantKnex();
  return knex.transaction(trx => resolveNextUnbilledSeatBoundary({trx, tenant, contractLineId}));
});
