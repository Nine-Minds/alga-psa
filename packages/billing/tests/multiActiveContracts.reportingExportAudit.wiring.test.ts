import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string): string =>
  readFileSync(resolve(__dirname, relativePath), 'utf8');

describe('multi-active reporting/export/accounting audit wiring', () => {
  const contractReportActionsSource = read('../src/actions/contractReportActions.ts');
  const invoiceQueriesSource = read('../src/actions/invoiceQueries.ts');
  const purchaseOrderServiceSource = read('../src/services/purchaseOrderService.ts');
  const accountingExportServiceSource = read('../src/services/accountingExportService.ts');

  it('T048: keeps audited report and accounting PO surfaces assignment-scoped', () => {
    expect(contractReportActionsSource).toContain(".countDistinct('cc.client_contract_id as count')");

    expect(invoiceQueriesSource).toContain(".select('invoice_id', 'client_contract_id', 'po_number')");
    expect(invoiceQueriesSource).toContain('const clientContractId = invoice?.client_contract_id ?? null;');
    expect(invoiceQueriesSource).toContain('getClientContractPurchaseOrderContext({');
    expect(invoiceQueriesSource).toContain('getPurchaseOrderConsumedCents({ knex, tenant, clientContractId })');

    expect(purchaseOrderServiceSource).toContain('.where({ tenant, client_contract_id: clientContractId })');
  });

  it('T048: confirms audited files do not include singleton active-contract selectors', () => {
    const auditedSources = [
      contractReportActionsSource,
      invoiceQueriesSource,
      purchaseOrderServiceSource,
      accountingExportServiceSource,
    ];

    for (const source of auditedSources) {
      expect(source).not.toContain('hasActiveContractForClient');
      expect(source).not.toContain('getClientIdsWithActiveContracts');
      expect(source).not.toContain('checkClientHasActiveContract');
      expect(source).not.toContain('fetchClientIdsWithActiveContracts');
      expect(source).not.toContain('already has an active contract');
    }
  });
});
