import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('multi-active billing cycles summary wiring', () => {
  it('T045: BillingCycles keeps multiple active assignments per client instead of collapsing to one row', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/BillingCycles.tsx'),
      'utf8',
    );

    expect(source).toContain('const existingAssignments = clientContractsMap[contract.client_id] ?? [];');
    expect(source).toContain('existingAssignments.push({');
    expect(source).toContain('clientContractId: contract.client_contract_id');
    expect(source).toContain('const assignments = clientContracts[value] ?? [];');
    expect(source).toContain('No active assignments');
    expect(source).toContain('Assignment {assignment.clientContractId.slice(0, 8)}');
  });
});
