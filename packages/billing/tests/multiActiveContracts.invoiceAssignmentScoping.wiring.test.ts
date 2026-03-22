import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('multi-active invoice assignment scoping wiring', () => {
  it('T042: invoice query and contract detail surfaces stay scoped to client_contract_id assignment identity', () => {
    const invoiceQueriesSource = readFileSync(
      resolve(__dirname, '../src/actions/invoiceQueries.ts'),
      'utf8',
    );
    const contractDetailSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/ContractDetail.tsx'),
      'utf8',
    );

    expect(invoiceQueriesSource).toContain("'invoices.client_contract_id': contractId");
    expect(invoiceQueriesSource).toContain("'invoices.client_contract_id',");

    expect(contractDetailSource).toContain('const invoiceScopeClientContractId = clientContractId ?? assignments[0]?.client_contract_id ?? null;');
    expect(contractDetailSource).toContain('fetchInvoicesByContract(invoiceScopeClientContractId)');
    expect(contractDetailSource).toContain('Failed to load invoices for this contract assignment.');
  });
});
