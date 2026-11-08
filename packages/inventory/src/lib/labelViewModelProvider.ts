import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  recordUrl,
  type LabelRequestContext,
  type LabelViewModel,
  type LabelViewModelProvider,
} from '@alga-psa/types';

/**
 * Stock-unit identity label data. Read-only; no side effects. Inventory records are governed by
 * `inventory:read` RBAC (there is no finer record-level policy for stock units today); a missing
 * unit and a caller without permission are both `null`.
 *
 * A stock unit's serial number IS its identity, so it is the label's identifier. Status, location and
 * cost are not printed: they change, and a printed label cannot.
 *
 * RMA and project / project-task labels are not provided yet (no label class, no data access in C1).
 */
export const stockUnitLabelViewModelProvider: LabelViewModelProvider = {
  entityType: 'stock_unit',
  labelClass: 'stock-unit-identity',

  async getLabelViewModels(context: LabelRequestContext, ids: readonly string[]) {
    if (!(await hasPermission(context.user, 'inventory', 'read'))) {
      return ids.map(() => null);
    }
    const { knex } = await createTenantKnex(context.tenant);

    return Promise.all(
      ids.map(async (unitId): Promise<LabelViewModel | null> => {
        const facade = tenantDb(knex, context.tenant);
        const query = facade
          .table('stock_units as u')
          .where('u.unit_id', unitId)
          .select('u.unit_id', 'u.serial_number', 'sc.service_name');
        facade.tenantJoin(query, 'service_catalog as sc', 'u.service_id', 'sc.service_id', { type: 'left' });
        const row = (await query.first()) as
          | { unit_id: string; serial_number: string | null; service_name: string | null }
          | undefined;
        if (!row) {
          return null;
        }
        return {
          labelClass: 'stock-unit-identity',
          entityType: 'stock_unit',
          recordId: row.unit_id,
          url: recordUrl('stock_unit', row.unit_id, context.baseUrl),
          identifier: row.serial_number ?? row.unit_id,
          code128Value: null,
          title: row.service_name ?? null,
          clientName: null,
          detail: null,
          secondaryIdentifier: null,
          serialSuffix: null,
        };
      })
    );
  },
};
