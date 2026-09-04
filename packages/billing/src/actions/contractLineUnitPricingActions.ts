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

async function rejectBilledBoundary(params: {
  trx: Knex.Transaction;
  tenant: string;
  contractLineId: string;
  effectivePeriodStart: string;
}): Promise<string | null> {
  const { trx, tenant, contractLineId, effectivePeriodStart } = params;
  // A billed/locked period [start, end) that CONTAINS the effective boundary
  // means the change would rewrite an invoiced or being-finalized period.
  // Boundaries exactly on a billed period's end are the legal next period.
  const conflicting = await tenantScopedTable(trx, tenant, 'recurring_service_periods')
    .where({ tenant, obligation_id: contractLineId })
    .whereIn('lifecycle_state', ['billed', 'locked'])
    .where('service_period_start', '<=', effectivePeriodStart)
    .where('service_period_end', '>', effectivePeriodStart)
    .first('record_id');
  if (conflicting) {
    return 'That effective date falls inside an already-billed or finalizing service period. Choose the next unbilled service-period boundary instead.';
  }
  return null;
}

async function resolveSeatScope(params: {
  trx: Knex.Transaction;
  tenant: string;
  input: IContractLineUnitPricingRevisionInput;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { trx, tenant, input } = params;
  const fixedConfig = await tenantScopedTable(
    trx,
    tenant,
    'contract_line_service_configuration as clsc',
  )
    .where({
      'clsc.tenant': tenant,
      'clsc.contract_line_id': input.contract_line_id,
      'clsc.service_id': input.service_id,
      'clsc.config_id': input.config_id,
      'clsc.configuration_type': 'Fixed',
    })
    .innerJoin(
      'contract_line_service_fixed_config as fc',
      'fc.config_id',
      'clsc.config_id',
    )
    .first<{ pricing_basis: string | null }>('fc.pricing_basis');
  if (!fixedConfig) {
    return { ok: false, error: 'The selected service is not a Fixed configuration on that contract line.' };
  }
  if (fixedConfig.pricing_basis !== 'unit') {
    return {
      ok: false,
      error:
        'Only explicitly unit-priced (recurring seats/units) services can carry scheduled quantity/rate changes. This service uses bundle pricing.',
    };
  }
  const line = await tenantScopedTable(trx, tenant, 'contract_lines')
    .where({ tenant, contract_line_id: input.contract_line_id, contract_line_type: 'Fixed' })
    .first('contract_line_id');
  if (!line) {
    return { ok: false, error: 'The selected contract line is not a Fixed line.' };
  }
  return { ok: true };
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
        const scope = await resolveSeatScope({ trx, tenant, input });
        if (!scope.ok) {
          return actionError(scope.error);
        }
        const boundaryConflict = await rejectBilledBoundary({
          trx,
          tenant,
          contractLineId: input.contract_line_id,
          effectivePeriodStart: effective,
        });
        if (boundaryConflict) {
          return actionError(boundaryConflict);
        }

        const existing = await tenantScopedTable(
          trx,
          tenant,
          'contract_line_unit_pricing_revisions',
        )
          .where({
            tenant,
            contract_line_id: input.contract_line_id,
            service_id: input.service_id,
            config_id: input.config_id,
            effective_period_start: effective,
          })
          .first<{ revision_id: string }>('revision_id');

        if (existing) {
          const [updated] = await tenantScopedTable(
            trx,
            tenant,
            'contract_line_unit_pricing_revisions',
          )
            .where({ tenant, revision_id: existing.revision_id })
            .update({
              quantity,
              unit_rate_cents: unitRateCents,
              created_by: user.user_id ?? null,
            })
            .returning('*');
          return updated as unknown as IContractLineUnitPricingRevision;
        }

        const [inserted] = await tenantScopedTable(
          trx,
          tenant,
          'contract_line_unit_pricing_revisions',
        )
          .insert({
            tenant,
            contract_line_id: input.contract_line_id,
            service_id: input.service_id,
            config_id: input.config_id,
            quantity,
            unit_rate_cents: unitRateCents,
            effective_period_start: effective,
            created_by: user.user_id ?? null,
          })
          .returning('*');
        return inserted as unknown as IContractLineUnitPricingRevision;
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
