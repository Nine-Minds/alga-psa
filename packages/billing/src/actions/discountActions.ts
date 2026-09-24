// server/src/lib/actions/discountActions.ts
'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  toDateOnly,
  toDisplayDiscountValue,
  toStoredDiscountValue,
  validateDiscountInput,
  type DiscountAuthoringInput,
  type DiscountAuthoringScope,
} from '../lib/billing/discountAuthoring';

/**
 * Authoring actions for configured automatic discounts on a client contract.
 *
 * These write the existing `discounts` + `contract_line_discounts` model that
 * the invoice adjustment evaluator already consumes; they are not a second
 * discount engine. Every read and write is tenant-scoped through `tenantDb`,
 * permission-checked, and validated against the contract's own lines/services
 * so a discount can never reference another contract's line.
 *
 * `discounts.value` is `decimal(10,2)`. The API boundary takes percentages in
 * percent units (`10` = 10%) and fixed discounts in decimal currency (`50` =
 * $50.00); the action stores percentages as the legacy fraction (`0.10`) and
 * fixed amounts as the decimal currency value the evaluator converts to minor
 * units at its single adapter boundary.
 */

export type ContractDiscountScope = DiscountAuthoringScope;
export type ContractDiscountInput = DiscountAuthoringInput;

export type ContractDiscountActionError = ActionMessageError | ActionPermissionError;

export interface ContractDiscountRecord {
  discount_id: string;
  discount_name: string;
  discount_type: 'percentage' | 'fixed';
  /** Percentage in percent units, or fixed decimal currency amount. */
  value: number;
  /** Stored value exactly as persisted (fraction for percentage). */
  stored_value: number;
  start_date: string | null;
  end_date: string | null;
  contract_line_id: string | null;
  contract_line_name: string | null;
  scope: ContractDiscountScope;
  scope_service_id: string | null;
  scope_service_name: string | null;
  applies_to_item_id: string | null;
  priority: number | null;
  is_active: boolean;
}

async function assertDiscountAuthorable(
  trx: Knex.Transaction,
  tenant: string,
  contractId: string,
  input: ContractDiscountInput,
): Promise<void> {
  const db = tenantDb(trx, tenant);

  const contract = await db
    .table('contracts')
    .where({ contract_id: contractId })
    .first('contract_id', 'is_system_managed_default');
  if (!contract) {
    throw new Error('The selected contract is no longer available.');
  }
  if (contract.is_system_managed_default === true) {
    throw new Error('System-managed default contracts are attribution-only; discount authoring is disabled.');
  }

  // The link line must belong to this contract; a foreign line would silently
  // make the discount ineligible or, worse, leak another contract's scoping.
  const line = await db
    .table('contract_lines')
    .where({ contract_line_id: input.contract_line_id, contract_id: contractId })
    .first('contract_line_id');
  if (!line) {
    throw new Error('The selected contract line does not belong to this contract.');
  }

  if (input.scope === 'service' && input.scope_service_id) {
    const service = await db
      .table('contract_line_services')
      .where({ contract_line_id: input.contract_line_id, service_id: input.scope_service_id })
      .first('service_id');
    if (!service) {
      throw new Error('The selected service is not part of this contract line.');
    }
  }
}

function discountActionErrorFrom(error: unknown): ContractDiscountActionError | null {
  if (error instanceof Error && error.message.startsWith('Permission denied:')) {
    return permissionError(error.message);
  }
  if (error instanceof Error) {
    const message = error.message;
    if (
      message.includes('required') ||
      message.includes('must be') ||
      message.includes('not part of this contract line') ||
      message.includes('does not belong to this contract') ||
      message.includes('no longer available') ||
      message.includes('attribution-only') ||
      message.includes('supported discount scope')
    ) {
      return actionError(message);
    }
  }
  return null;
}

/**
 * Lists the services attached to each line of a contract, for the discount
 * dialog's service-scope selector.
 */
export interface ContractLineServiceOption {
  contract_line_id: string;
  contract_line_name: string | null;
  service_id: string;
  service_name: string | null;
}

export const getContractLineServiceOptions = withAuth(async (
  user,
  { tenant },
  contractId: string,
): Promise<ContractLineServiceOption[] | ContractDiscountActionError> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'billing', 'read', trx)) {
        throw new Error('Permission denied: Cannot read contract discounts');
      }

      const db = tenantDb(trx, tenant);
      const query = db.table('contract_line_services as cls');
      db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'cls.contract_line_id');
      db.tenantJoin(query, 'service_catalog as svc', 'svc.service_id', 'cls.service_id', { type: 'left' });

      const rows = await query
        .where('cl.contract_id', contractId)
        .orderBy('cl.display_order', 'asc')
        .orderBy('svc.service_name', 'asc')
        .select(
          'cls.contract_line_id',
          'cl.contract_line_name',
          'cls.service_id',
          'svc.service_name',
        );

      return (rows as Array<Record<string, unknown>>).map((row): ContractLineServiceOption => ({
        contract_line_id: String(row.contract_line_id),
        contract_line_name: row.contract_line_name ? String(row.contract_line_name) : null,
        service_id: String(row.service_id),
        service_name: row.service_name ? String(row.service_name) : null,
      }));
    });
  } catch (error) {
    console.error('Error fetching contract line service options:', error);
    const expected = discountActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Lists the configured discounts linked to a contract's lines. Percentages are
 * returned in percent units for the editor; `stored_value` preserves the raw
 * persisted number.
 */
export const getContractDiscounts = withAuth(async (
  user,
  { tenant },
  contractId: string,
): Promise<ContractDiscountRecord[] | ContractDiscountActionError> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'billing', 'read', trx)) {
        throw new Error('Permission denied: Cannot read contract discounts');
      }

      const db = tenantDb(trx, tenant);
      const query = db.table('discounts as d');
      db.tenantJoin(query, 'contract_line_discounts as cld', 'd.discount_id', 'cld.discount_id');
      db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'cld.contract_line_id', { type: 'left' });
      db.tenantJoin(query, 'service_catalog as svc', 'svc.service_id', 'd.scope_service_id', { type: 'left' });

      const rows = await query
        .where('cl.contract_id', contractId)
        .orderBy('d.discount_name', 'asc')
        .select(
          'd.discount_id',
          'd.discount_name',
          'd.discount_type',
          'd.value',
          'd.start_date',
          'd.end_date',
          'd.scope',
          'd.scope_service_id',
          'd.applies_to_item_id',
          'd.priority',
          'd.is_active',
          'cld.contract_line_id',
          'cl.contract_line_name',
          'svc.service_name as scope_service_name',
        );

      return (rows as Array<Record<string, unknown>>).map((row): ContractDiscountRecord => {
        const discountType = row.discount_type === 'fixed' ? 'fixed' : 'percentage';
        const storedValue = Number(row.value) || 0;
        const scope = (row.scope as ContractDiscountScope | null) ?? 'invoice';
        return {
          discount_id: String(row.discount_id),
          discount_name: String(row.discount_name),
          discount_type: discountType,
          value: toDisplayDiscountValue(discountType, storedValue),
          stored_value: storedValue,
          start_date: toDateOnly(row.start_date),
          end_date: toDateOnly(row.end_date),
          contract_line_id: row.contract_line_id ? String(row.contract_line_id) : null,
          contract_line_name: row.contract_line_name ? String(row.contract_line_name) : null,
          scope,
          scope_service_id: row.scope_service_id ? String(row.scope_service_id) : null,
          scope_service_name: row.scope_service_name ? String(row.scope_service_name) : null,
          applies_to_item_id: row.applies_to_item_id ? String(row.applies_to_item_id) : null,
          priority: row.priority == null ? null : Number(row.priority),
          is_active: Boolean(row.is_active),
        };
      });
    });
  } catch (error) {
    console.error('Error fetching contract discounts:', error);
    const expected = discountActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const createContractDiscount = withAuth(async (
  user,
  { tenant },
  contractId: string,
  input: ContractDiscountInput,
): Promise<ContractDiscountRecord | ContractDiscountActionError> => {
  try {
    const validationError = validateDiscountInput(input);
    if (validationError) {
      return actionError(validationError);
    }

    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'billing', 'create', trx)) {
        throw new Error('Permission denied: Cannot create contract discounts');
      }

      await assertDiscountAuthorable(trx, tenant, contractId, input);

      const db = tenantDb(trx, tenant);
      const discountId = trx.raw('gen_random_uuid()');
      const now = trx.fn.now();

      const inserted = await db.table('discounts').insert({
        discount_id: discountId,
        tenant,
        discount_name: input.discount_name.trim(),
        discount_type: input.discount_type,
        value: toStoredDiscountValue(input),
        start_date: `${input.start_date}T00:00:00.000Z`,
        end_date: input.end_date ? `${input.end_date}T00:00:00.000Z` : null,
        is_active: input.is_active ?? true,
        scope: input.scope,
        scope_service_id: input.scope === 'service' ? input.scope_service_id ?? null : null,
        applies_to_item_id: input.scope === 'item' ? input.applies_to_item_id ?? null : null,
        priority: input.priority ?? null,
        created_at: now,
        updated_at: now,
      }).returning('discount_id');

      const newId = String((inserted[0] as { discount_id: string }).discount_id);
      await db.table('contract_line_discounts').insert({
        discount_id: newId,
        tenant,
        contract_line_id: input.contract_line_id,
      });

      const record = await getContractDiscountById(trx, tenant, contractId, newId);
      if (!record) {
        throw new Error('The discount was created but could not be read back.');
      }
      return record;
    });
  } catch (error) {
    console.error('Error creating contract discount:', error);
    const expected = discountActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const updateContractDiscount = withAuth(async (
  user,
  { tenant },
  contractId: string,
  discountId: string,
  input: ContractDiscountInput,
): Promise<ContractDiscountRecord | ContractDiscountActionError> => {
  try {
    const validationError = validateDiscountInput(input);
    if (validationError) {
      return actionError(validationError);
    }

    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'billing', 'update', trx)) {
        throw new Error('Permission denied: Cannot update contract discounts');
      }

      await assertDiscountAuthorable(trx, tenant, contractId, input);

      const db = tenantDb(trx, tenant);
      const existing = await db
        .table('discounts as d')
        .join('contract_line_discounts as cld', function () {
          this.on('cld.discount_id', '=', 'd.discount_id').andOn('cld.tenant', '=', 'd.tenant');
        })
        .join('contract_lines as cl', function () {
          this.on('cl.contract_line_id', '=', 'cld.contract_line_id').andOn('cl.tenant', '=', 'cld.tenant');
        })
        .where({ 'd.discount_id': discountId, 'cl.contract_id': contractId })
        .first('d.discount_id');
      if (!existing) {
        throw new Error('The discount no longer exists for this contract.');
      }

      await db.table('discounts').where({ discount_id: discountId }).update({
        discount_name: input.discount_name.trim(),
        discount_type: input.discount_type,
        value: toStoredDiscountValue(input),
        start_date: `${input.start_date}T00:00:00.000Z`,
        end_date: input.end_date ? `${input.end_date}T00:00:00.000Z` : null,
        is_active: input.is_active ?? true,
        scope: input.scope,
        scope_service_id: input.scope === 'service' ? input.scope_service_id ?? null : null,
        applies_to_item_id: input.scope === 'item' ? input.applies_to_item_id ?? null : null,
        priority: input.priority ?? null,
        updated_at: trx.fn.now(),
      });

      // A discount links to exactly one contract line. Re-point the link by
      // replacing the association row rather than mutating its (tenant,
      // discount_id) primary key.
      await db.table('contract_line_discounts').where({ discount_id: discountId }).delete();
      await db.table('contract_line_discounts').insert({
        discount_id: discountId,
        tenant,
        contract_line_id: input.contract_line_id,
      });

      const record = await getContractDiscountById(trx, tenant, contractId, discountId);
      if (!record) {
        throw new Error('The discount was updated but could not be read back.');
      }
      return record;
    });
  } catch (error) {
    console.error('Error updating contract discount:', error);
    const expected = discountActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const setContractDiscountActive = withAuth(async (
  user,
  { tenant },
  contractId: string,
  discountId: string,
  isActive: boolean,
): Promise<ContractDiscountRecord | ContractDiscountActionError> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'billing', 'update', trx)) {
        throw new Error('Permission denied: Cannot update contract discounts');
      }

      const db = tenantDb(trx, tenant);
      const existing = await db
        .table('discounts as d')
        .join('contract_line_discounts as cld', function () {
          this.on('cld.discount_id', '=', 'd.discount_id').andOn('cld.tenant', '=', 'd.tenant');
        })
        .join('contract_lines as cl', function () {
          this.on('cl.contract_line_id', '=', 'cld.contract_line_id').andOn('cl.tenant', '=', 'cld.tenant');
        })
        .where({ 'd.discount_id': discountId, 'cl.contract_id': contractId })
        .first('d.discount_id');
      if (!existing) {
        throw new Error('The discount no longer exists for this contract.');
      }

      await db.table('discounts').where({ discount_id: discountId }).update({
        is_active: isActive,
        updated_at: trx.fn.now(),
      });

      const record = await getContractDiscountById(trx, tenant, contractId, discountId);
      if (!record) {
        throw new Error('The discount was updated but could not be read back.');
      }
      return record;
    });
  } catch (error) {
    console.error('Error updating contract discount activation:', error);
    const expected = discountActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

async function getContractDiscountById(
  trx: Knex.Transaction,
  tenant: string,
  contractId: string,
  discountId: string,
): Promise<ContractDiscountRecord | null> {
  const db = tenantDb(trx, tenant);
  const query = db.table('discounts as d');
  db.tenantJoin(query, 'contract_line_discounts as cld', 'd.discount_id', 'cld.discount_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'cld.contract_line_id', { type: 'left' });
  db.tenantJoin(query, 'service_catalog as svc', 'svc.service_id', 'd.scope_service_id', { type: 'left' });

  const row = await query
    .where({ 'd.discount_id': discountId, 'cl.contract_id': contractId })
    .first(
      'd.discount_id',
      'd.discount_name',
      'd.discount_type',
      'd.value',
      'd.start_date',
      'd.end_date',
      'd.scope',
      'd.scope_service_id',
      'd.applies_to_item_id',
      'd.priority',
      'd.is_active',
      'cld.contract_line_id',
      'cl.contract_line_name',
      'svc.service_name as scope_service_name',
    );
  if (!row) return null;

  const record = row as Record<string, unknown>;
  const discountType = record.discount_type === 'fixed' ? 'fixed' : 'percentage';
  const storedValue = Number(record.value) || 0;
  return {
    discount_id: String(record.discount_id),
    discount_name: String(record.discount_name),
    discount_type: discountType,
    value: toDisplayDiscountValue(discountType, storedValue),
    stored_value: storedValue,
    start_date: toDateOnly(record.start_date),
    end_date: toDateOnly(record.end_date),
    contract_line_id: record.contract_line_id ? String(record.contract_line_id) : null,
    contract_line_name: record.contract_line_name ? String(record.contract_line_name) : null,
    scope: (record.scope as ContractDiscountScope | null) ?? 'invoice',
    scope_service_id: record.scope_service_id ? String(record.scope_service_id) : null,
    scope_service_name: record.scope_service_name ? String(record.scope_service_name) : null,
    applies_to_item_id: record.applies_to_item_id ? String(record.applies_to_item_id) : null,
    priority: record.priority == null ? null : Number(record.priority),
    is_active: Boolean(record.is_active),
  };
}
