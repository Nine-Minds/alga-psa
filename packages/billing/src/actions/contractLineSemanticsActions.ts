'use server';

import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
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
function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export const setUsageMeasurementMode = withAuth(
  async (
    user,
    { tenant },
    input: {
      config_id: string;
      contract_line_id: string;
      service_id: string;
      measurement_mode: UsageMeasurementMode;
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
        const config = await tenantScopedTable(trx, tenant, 'contract_line_service_configuration')
          .where({
            tenant,
            config_id: input.config_id,
            contract_line_id: input.contract_line_id,
            service_id: input.service_id,
            configuration_type: 'Usage',
          })
          .first('config_id');
        if (!config) {
          return actionError('The selected service configuration is not a Usage configuration on that contract line.');
        }

        const usageConfig = await tenantScopedTable(trx, tenant, 'contract_line_service_usage_config')
          .where({ tenant, config_id: input.config_id })
          .first<{ measurement_mode: string | null }>('measurement_mode');
        const currentMode = usageConfig?.measurement_mode ?? 'additive';
        if (currentMode === input.measurement_mode) {
          return { measurement_mode: input.measurement_mode };
        }

        if (input.measurement_mode === 'period_total') {
          const orphanedEntries = await tenantScopedTable(trx, tenant, 'usage_tracking')
            .where({ tenant, service_id: input.service_id, contract_line_id: input.contract_line_id, invoiced: false })
            .first('usage_id');
          if (orphanedEntries) {
            return actionError(
              'This service still has unbilled additive entries on the contract line. Bill or remove them before switching to period-total reporting, or use a new configuration.',
            );
          }
        }

        if (input.measurement_mode === 'additive') {
          const recordedTotal = await tenantScopedTable(trx, tenant, 'usage_period_totals')
            .where({
              tenant,
              client_contract_line_id: input.contract_line_id,
              service_id: input.service_id,
              config_id: input.config_id,
              lifecycle_state: 'recorded',
            })
            .first('period_total_id');
          if (recordedTotal) {
            return actionError(
              'This service has a recorded period total that is not yet invoiced. Bill it before switching back to additive consumption.',
            );
          }
        }

        await tenantScopedTable(trx, tenant, 'contract_line_service_usage_config')
          .where({ tenant, config_id: input.config_id })
          .update({ measurement_mode: input.measurement_mode });
        return { measurement_mode: input.measurement_mode };
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
