import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ClientContractsTab.tsx', import.meta.url),
  'utf8'
);

describe('ClientContractsTab assignment lifecycle wiring', () => {
  it('T025: renders assignment-first status and template copy for client-owned contracts', () => {
    expect(source).toContain("title: 'Source Template'");
    expect(source).toContain("dataIndex: 'assignment_status'");
    expect(source).toContain("render: (value: string | null, record) => renderStatusBadge(value ?? record.status),");
    expect(source).not.toContain('updateContract(contractId, { status:');
  });

  it('T026: routes terminate, restore, and activate actions through client contract mutations', () => {
    expect(source).toContain("from '@alga-psa/billing/actions/billingClientsActions';");
    expect(source).toContain("await updateClientContractForBilling(clientContractId, { is_active: false });");
    expect(source).toContain("await updateClientContractForBilling(clientContractId, { is_active: true });");
    expect(source).toContain("void handleTerminateContract(record.client_contract_id);");
    expect(source).toContain("void handleRestoreContract(record.client_contract_id);");
    expect(source).toContain("void handleSetToActive(record.client_contract_id);");
    expect(source).not.toContain('checkClientHasActiveContract');
  });
});
