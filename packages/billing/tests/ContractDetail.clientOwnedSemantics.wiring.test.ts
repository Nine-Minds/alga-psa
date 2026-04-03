import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detailSource = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ContractDetail.tsx', import.meta.url),
  'utf8'
);
const switcherSource = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ContractDetailSwitcher.tsx', import.meta.url),
  'utf8'
);

describe('Contract detail client-owned semantics wiring', () => {
  it('T027: resolves live contract detail from clientContractId context before loading the header', () => {
    expect(detailSource).toContain("const clientContractId = searchParams?.get('clientContractId') ?? resolvedClientContractId ?? null;");
    expect(detailSource).toContain('getClientContractByIdForBilling(clientContractId)');
    expect(detailSource).toContain('const detailContractId = selectedClientContract?.contract_id ?? contractId;');
    expect(switcherSource).toContain('resolvedClientContractId={clientContractId}');
  });

  it('T028: separates owner/assignment semantics from contract-header editing affordances', () => {
    expect(detailSource).toContain('Contract Header');
    expect(detailSource).toContain('Client Ownership');
    expect(detailSource).toContain('Owner Client');
    expect(detailSource).toContain("Live client status is controlled by the assignment lifecycle below.");
    expect(detailSource).toContain("{isLiveClientContract ? 'Assignment Status' : 'Status'}");
  });
});
