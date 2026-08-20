import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../../../../');

function source(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('prepaid replenishment pending-state lifecycle wiring', () => {
  it('clears the pending state when the authenticated void path cancels an invoice', () => {
    const voidSource = source('packages/billing/src/actions/voidInvoiceActions.ts');
    expect(voidSource).toContain('suppressPrepaidReplenishmentForVoidedInvoice(trx, tenant, invoiceId)');
  });

  it('clears the pending state before hard deletion and on API invoice deletion', () => {
    const modificationSource = source('packages/billing/src/actions/invoiceModification.ts');
    const invoiceServiceSource = source('server/src/lib/api/services/InvoiceService.ts');
    const inboundSource = source('packages/billing/src/actions/inboundActions.ts');
    expect(modificationSource).toContain('clearPrepaidReplenishmentForInvoice(trx, tenant, invoiceId)');
    expect(invoiceServiceSource).toContain('clearPrepaidReplenishmentForInvoice(trx, context.tenant, id)');
    expect(inboundSource).toContain('clearPrepaidReplenishmentForInvoice(trx, tenant, lookup.algaEntityId)');
  });

  it('clears the pending state when manual or external payment settles the invoice', () => {
    const invoiceServiceSource = source('server/src/lib/api/services/InvoiceService.ts');
    const externalPaymentSource = source('packages/billing/src/services/accountingSync/recordExternalPayment.ts');
    expect(invoiceServiceSource).toContain("if (newStatus === 'paid')");
    expect(invoiceServiceSource).toContain('clearPrepaidReplenishmentForInvoice(trx, context.tenant, data.invoice_id)');
    expect(invoiceServiceSource).toContain('clearPrepaidReplenishmentForInvoice(trx, context.tenant, id)');
    expect(externalPaymentSource).toContain("if (status === 'paid')");
    expect(externalPaymentSource).toContain('clearPrepaidReplenishmentForInvoice(trx, tenantId, input.invoiceId)');
  });

  it('keeps hourly replenishment on the additive hour-block purchase core', () => {
    const replenishmentSource = source('packages/billing/src/lib/prepaidAutoReplenishment.ts');
    const hourBlockSource = source('packages/billing/src/actions/hourBlockActions.ts');
    expect(replenishmentSource).toContain('createHourBlockPurchaseInvoiceInternal');
    expect(replenishmentSource).toContain('hours: input.amount / 60');
    expect(hourBlockSource).toContain('source_invoice_id: invoiceId');
  });
});
