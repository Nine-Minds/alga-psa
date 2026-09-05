'use server';

import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { revalidatePath } from 'next/cache';
import {
  IContractLineUnitPricingRevision,
  IContractLineUnitPricingRevisionInput,
} from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { scheduleSeatRevisionInTransaction } from '../lib/billing/seatRevisions';

type UnitPricingActionError = ActionMessageError | ActionPermissionError;

/**
 * Server boundary for scheduling recurring-seat quantity/unit-rate changes on
 * unit-priced Fixed lines.
 *
 * A change is stored as a prospective revision effective at an explicit
 * service-period boundary (contract_line_unit_pricing_revisions). Periods
 * whose covered start is at/after that date bill the revision; earlier periods
 * keep the configuration columns and are never rewritten — they remain
 * immutable once billed because the engine never recomputes them.
 *
 * Guards:
 *  - quantity is a whole number >= 0 (zero is an explicit zero, never a
 *    fallback to one);
 *  - the target service must be an explicitly unit-priced member of the line;
 *  - the effective boundary must not fall inside a period that is already
 *    billed or locked (finalizing). Scheduling at the next unbilled boundary is
 *    the supported direction; mid-period true-ups are out of scope.
 */

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export const scheduleUnitPricingRevision = withAuth(
  async (
    user,
    { tenant },
    input: IContractLineUnitPricingRevisionInput,
  ): Promise<IContractLineUnitPricingRevision | UnitPricingActionError> => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      return permissionError('Permission denied: billing update required');
    }
    const quantity = Number(input.quantity);
    const unitRateCents = Number(input.unit_rate_cents);
    const effective = String(input.effective_period_start);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return actionError('Quantity must be a whole number of 0 or more.');
    }
    if (!Number.isFinite(unitRateCents) || unitRateCents < 0 || !Number.isInteger(unitRateCents)) {
      return actionError('Unit rate must be a whole number of minor units (cents) of 0 or more.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
      return actionError('Effective date must be a calendar date (YYYY-MM-DD) at a service-period boundary.');
    }

    try {
      const { knex } = await createTenantKnex();
      const result = await knex.transaction(async (trx) => {
        const scheduled = await scheduleSeatRevisionInTransaction({
          trx,
          tenant,
          userId: user.user_id ?? null,
          contractLineId: input.contract_line_id,
          serviceId: input.service_id,
          configId: input.config_id,
          quantity,
          unitRateCents,
          effectivePeriodStart: effective,
        });
        if (!scheduled.ok) {
          return actionError(scheduled.error);
        }
        return scheduled.revision;
      });

      revalidatePath('/msp/billing');
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Permission denied:')) {
        return permissionError(error.message);
      }
      const dbError = error as { code?: string };
      if (dbError?.code === '22P02') {
        return actionError('The selected contract line, service, or date is invalid.');
      }
      throw error;
    }
  },
);

/**
 * Read the effective seat quantity/rate for a unit-priced service at a given
 * service-period start (the configuration value when no revision applies yet).
 */
export const getEffectiveUnitPricing = withAuth(
  async (
    user,
    { tenant },
    input: { contract_line_id: string; service_id: string; config_id: string; service_period_start: string },
  ): Promise<
    | { quantity: number; unit_rate_cents: number | null; revision: IContractLineUnitPricingRevision | null }
    | UnitPricingActionError
  > => {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      return permissionError('Permission denied: billing read required');
    }
    try {
      const { knex } = await createTenantKnex();
      const revision = await tenantScopedTable(
        knex,
        tenant,
        'contract_line_unit_pricing_revisions',
      )
        .where({
          tenant,
          contract_line_id: input.contract_line_id,
          service_id: input.service_id,
          config_id: input.config_id,
        })
        .where('effective_period_start', '<=', String(input.service_period_start))
        .orderBy('effective_period_start', 'desc')
        .orderBy('created_at', 'desc')
        .first<IContractLineUnitPricingRevision | null>();
      if (!revision) {
        const config = await tenantScopedTable(
          knex,
          tenant,
          'contract_line_service_configuration',
        )
          .where({
            tenant,
            contract_line_id: input.contract_line_id,
            service_id: input.service_id,
            config_id: input.config_id,
          })
          .first<{ quantity: number | null }>('quantity');
        const fixedConfig = await tenantScopedTable(
          knex,
          tenant,
          'contract_line_service_fixed_config',
        )
          .where({ tenant, config_id: input.config_id })
          .first<{ base_rate: number | string | null }>('base_rate');
        return {
          quantity: Number(config?.quantity ?? 0),
          unit_rate_cents:
            fixedConfig?.base_rate != null ? Number(fixedConfig.base_rate) : null,
          revision: null,
        };
      }
      const typedRevision = revision as unknown as IContractLineUnitPricingRevision;
      return {
        quantity: Number(typedRevision.quantity),
        unit_rate_cents: Number(typedRevision.unit_rate_cents),
        revision: typedRevision,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Permission denied:')) {
        return permissionError(error.message);
      }
      throw error;
    }
  },
);
