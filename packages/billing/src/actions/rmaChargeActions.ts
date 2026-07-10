'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { chargeForUnreturned } from '@alga-psa/inventory/actions/rmaActions';
import { generateManualInvoice } from './manualInvoiceActions';
import {
  actionError,
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

/**
 * Advance-replacement RMA: the dead-unit-owed deadline passed, so actually BILL the
 * client for the unreturned unit (F040). Lives in billing (billing → inventory
 * dependency direction) and composes:
 *   1. inventory's chargeForUnreturned — the locked status flip dead_unit_owed →
 *      'charged'. This is the idempotency latch: a second call throws before any
 *      invoice is created.
 *   2. a DRAFT manual invoice (one line: the product at list price, editable before
 *      sending) through the existing invoice engine.
 *   3. the invoice reference stored on the case (rma_cases.charge_invoice_id).
 * If invoicing fails, the status flip is compensated back to dead_unit_owed so the
 * charge can be retried.
 */
export type RmaChargeActionError = ActionMessageError | ActionPermissionError;

function rmaChargeActionErrorFrom(error: unknown): RmaChargeActionError | null {
  if (isActionMessageError(error) || isActionPermissionError(error)) {
    return error as RmaChargeActionError;
  }
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
    if (
      error.message === 'RMA case has no client to charge' ||
      error.message === 'RMA case has no product to charge for' ||
      error.message === 'Invoice generation failed' ||
      error.message === 'Quantity must be greater than 0' ||
      error.message.startsWith('Client not found') ||
      error.message.startsWith('Service not found') ||
      error.message.startsWith('RMA status changed.') ||
      error.message.startsWith('RMA is in status')
    ) {
      return actionError(error.message);
    }
  }
  return null;
}

export const chargeRmaForUnreturned = withAuth(
  async (
    user,
    { tenant },
    rmaId: string,
  ): Promise<{ rma_id: string; status: string; invoiceId?: string; invoiced_amount_cents: number } | RmaChargeActionError> => {
    if (!(await hasPermission(user, 'billing', 'create'))) {
      return permissionError('Permission denied: billing create required');
    }

    // Step 1 — locked status flip (throws unless dead_unit_owed → idempotent).
    const rma: any = await chargeForUnreturned(rmaId);
    if (isActionMessageError(rma) || isActionPermissionError(rma)) {
      return rma as RmaChargeActionError;
    }

    const { knex: db } = await createTenantKnex();
    try {
      if (!rma?.client_id) throw new Error('RMA case has no client to charge');
      if (!rma?.service_id) throw new Error('RMA case has no product to charge for');

      const { rate, currency, serviceName } = await withTransaction(db, async (trx: Knex.Transaction) => {
        const svc = await trx('service_catalog')
          .where({ tenant, service_id: rma.service_id })
          .select('service_name', 'default_rate')
          .first();
        const replacement = rma.replacement_unit_id
          ? await trx('stock_units').where({ tenant, unit_id: rma.replacement_unit_id }).first()
          : null;
        return {
          // List price, falling back to what the replacement cost us — the draft is editable.
          rate: Number(svc?.default_rate ?? replacement?.unit_cost ?? 0),
          currency: (replacement?.cost_currency as string) || 'USD',
          serviceName: (svc?.service_name as string) || 'Unreturned unit',
        };
      });

      const result: any = await generateManualInvoice({
        clientId: rma.client_id,
        currency_code: currency,
        items: [
          {
            service_id: rma.service_id,
            quantity: 1,
            description: `Unreturned RMA unit (${rma.rma_reference || rmaId}) — ${serviceName}`,
            rate,
          },
        ],
      } as any);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        throw new Error(getErrorMessage(result));
      }
      if (result && result.success === false) {
        throw new Error(result.error || 'Invoice generation failed');
      }
      const invoiceId: string | undefined = result?.invoice?.invoice_id ?? result?.invoiceId;

      await withTransaction(db, async (trx: Knex.Transaction) => {
        await trx('rma_cases')
          .where({ tenant, rma_id: rmaId })
          .update({ charge_invoice_id: invoiceId ?? null, updated_at: trx.fn.now() });
      });

      return { rma_id: rmaId, status: 'charged', invoiceId, invoiced_amount_cents: rate };
    } catch (e) {
      // Compensate the latch so the charge can be retried.
      await withTransaction(db, async (trx: Knex.Transaction) => {
        await trx('rma_cases')
          .where({ tenant, rma_id: rmaId, status: 'charged' })
          .update({ status: 'dead_unit_owed', updated_at: trx.fn.now() });
      });
      const expected = rmaChargeActionErrorFrom(e);
      if (expected) return expected;
      throw e;
    }
  },
);
