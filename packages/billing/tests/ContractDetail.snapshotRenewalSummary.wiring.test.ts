import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ContractDetail.tsx', import.meta.url),
  'utf8'
);

describe('ContractDetail snapshot renewal summary wiring', () => {
  it('renders a renewal summary block in the contract snapshot card', () => {
    expect(source).toContain('assignments.find((assignment) => assignment.client_contract_id === clientContractId) ??');
    expect(source).toContain('assignments[0] ??');
    expect(source).toContain("{t('contractDetail.headerCard.renewalHeading', { defaultValue: 'Renewal' })}");
    expect(source).toContain("{t('renewal.labels.source', { defaultValue: 'Renewal Source' })}");
    expect(source).toContain("{t('renewal.labels.decisionDue', { defaultValue: 'Decision Due' })}");
  });

  it('handles ongoing contracts in the top renewal summary', () => {
    expect(source).toContain('Ongoing (no end date)');
  });
});
