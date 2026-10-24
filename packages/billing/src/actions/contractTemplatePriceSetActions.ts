'use server';

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isSupportedCurrency } from '@alga-psa/core/formatters';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  deleteTemplatePriceSet,
  listTemplateCurrencies,
  resolveTemplateAmounts,
  writeTemplatePriceSet,
  type TemplateAmountSlot,
} from '@alga-psa/shared/billingClients/templateAmounts';

export type ContractTemplatePriceSetActionError = ActionMessageError | ActionPermissionError;

export interface ContractTemplatePricingSet {
  currency_code: string;
  /** slot_key -> minor units, only the slots this set stores. */
  amounts: Record<string, number>;
  /** Required slots of the template's current structure the set lacks. */
  missing_slot_keys: string[];
}

export interface ContractTemplatePricing {
  template_id: string;
  base_currency: string;
  /** Every amount slot of the template, with its base-currency amount. */
  slots: TemplateAmountSlot[];
  sets: ContractTemplatePricingSet[];
  /** Whether the caller may save, relabel or delete (drives the editor's controls). */
  can_edit: boolean;
}

const normalizeCurrency = (value: unknown): string | null => {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(code) && isSupportedCurrency(code) ? code : null;
};

const invalidCurrency = (value: unknown) =>
  actionError(
    `"${String(value)}" is not a valid ISO 4217 currency code`,
    'msp/contracts:errors.wizard.invalidTemplateCurrency',
    { currency: String(value) },
  );

const templateNotFound = () =>
  actionError('Template not found', 'msp/contracts:errors.wizard.templateNotFound');

function errorFrom(error: unknown): ContractTemplatePriceSetActionError | null {
  if (!(error instanceof Error)) return null;
  if (error.message.startsWith('Permission denied')) return permissionError(error.message);
  if (error.message.includes('not found')) return templateNotFound();
  if (
    error.message.includes("template's base currency") ||
    error.message.startsWith('Slot "') ||
    error.message.startsWith('Rate for slot') ||
    error.message.startsWith('Invalid currency code')
  ) {
    return actionError(error.message);
  }
  return null;
}

export const getContractTemplatePricing = withAuth(async (
  user,
  { tenant },
  templateId: string,
): Promise<ContractTemplatePricing | ContractTemplatePriceSetActionError> => {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    return permissionError('Permission denied: Cannot view template pricing');
  }
  const { knex } = await createTenantKnex();
  try {
    const resolved = await resolveTemplateAmounts(knex, tenant, templateId, null);
    const summary = (await listTemplateCurrencies(knex, tenant, [templateId])).get(templateId);
    const requiredKeys = resolved.slots.filter((slot) => slot.required).map((slot) => slot.slot_key);

    const rows = resolved.price_set_currencies.length
      ? ((await tenantDb(knex, tenant)
          .table('contract_template_prices')
          .where({ template_id: templateId })
          .select('currency_code', 'slot_key', 'rate')) as Array<{ currency_code: string; slot_key: string; rate: number }>)
      : [];
    const known = new Set(resolved.slots.map((slot) => slot.slot_key));
    const sets = resolved.price_set_currencies.map((currency): ContractTemplatePricingSet => {
      const amounts: Record<string, number> = {};
      for (const row of rows) {
        if (row.currency_code.toUpperCase() === currency && known.has(row.slot_key)) {
          amounts[row.slot_key] = Number(row.rate);
        }
      }
      return {
        currency_code: currency,
        amounts,
        missing_slot_keys: requiredKeys.filter((key) => amounts[key] === undefined),
      };
    });

    return {
      template_id: templateId,
      base_currency: summary?.base ?? resolved.template_currency,
      slots: resolved.slots,
      sets,
      can_edit: await hasPermission(user, 'billing', 'update'),
    };
  } catch (error) {
    const expected = errorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const saveContractTemplatePriceSet = withAuth(async (
  user,
  { tenant },
  templateId: string,
  currency: string,
  amounts: Record<string, number>,
): Promise<{ success: true } | ContractTemplatePriceSetActionError> => {
  if (!(await hasPermission(user, 'billing', 'update'))) {
    return permissionError('Permission denied: Cannot edit template pricing');
  }
  const code = normalizeCurrency(currency);
  if (!code) return invalidCurrency(currency);
  const { knex } = await createTenantKnex();
  try {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await writeTemplatePriceSet(trx, tenant, templateId, code, amounts, user.user_id ?? null);
    });
    return { success: true };
  } catch (error) {
    const expected = errorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const deleteContractTemplatePriceSet = withAuth(async (
  user,
  { tenant },
  templateId: string,
  currency: string,
): Promise<{ success: true } | ContractTemplatePriceSetActionError> => {
  if (!(await hasPermission(user, 'billing', 'delete'))) {
    return permissionError('Permission denied: Cannot delete template pricing');
  }
  const code = normalizeCurrency(currency);
  if (!code) return invalidCurrency(currency);
  const { knex } = await createTenantKnex();
  try {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await deleteTemplatePriceSet(trx, tenant, templateId, code);
    });
    return { success: true };
  } catch (error) {
    const expected = errorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Relabel a template's base currency. The stored amounts are NOT converted: they
 * keep their numeric value and are now read as `newCurrency`. Rejected while a
 * price set for `newCurrency` exists (the caller deletes that set first), so a
 * currency never has two sources of truth.
 */
export const updateContractTemplateCurrency = withAuth(async (
  user,
  { tenant },
  templateId: string,
  newCurrency: string,
): Promise<{ success: true; currency_code: string } | ContractTemplatePriceSetActionError> => {
  if (!(await hasPermission(user, 'billing', 'update'))) {
    return permissionError('Permission denied: Cannot edit template pricing');
  }
  const code = normalizeCurrency(newCurrency);
  if (!code) return invalidCurrency(newCurrency);
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const template = (await db.table('contract_templates').where({ template_id: templateId }).first('currency_code')) as
        | { currency_code: string }
        | undefined;
      if (!template) return templateNotFound();
      if (template.currency_code === code) return { success: true as const, currency_code: code };

      const existingSet = await db
        .table('contract_template_price_sets')
        .where({ template_id: templateId, currency_code: code })
        .first('currency_code');
      if (existingSet) {
        return actionError(
          `This template already has a ${code} price set. Delete it before making ${code} the base currency.`,
          'msp/contracts:errors.wizard.templateCurrencyHasPriceSet',
          { currency: code },
        );
      }

      await db
        .table('contract_templates')
        .where({ template_id: templateId })
        .update({ currency_code: code, updated_at: trx.fn.now() });
      return { success: true as const, currency_code: code };
    });
  } catch (error) {
    const expected = errorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
