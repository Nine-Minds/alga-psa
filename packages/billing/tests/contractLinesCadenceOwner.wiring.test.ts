import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract detail line cadence owner editing wiring', () => {
  it('allows cadence_owner editing from ContractLines and persists it through updateContractLine when line edits are safe', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/ContractLines.tsx'),
      'utf8'
    );

    expect(source).toContain("cadence_owner?: 'client' | 'contract';");
    expect(source).toContain("cadence_owner: line.cadence_owner ?? 'client'");
    expect(source).toContain('id={`cadence-owner-${line.contract_line_id}`}');
    expect(source).toContain("value: 'contract', label: 'Contract anniversary'");
    expect(source).toContain("value: 'client', label: 'Client schedule'");
    expect(source).toContain("cadence_owner: editLineData.cadence_owner,");
  });
});
