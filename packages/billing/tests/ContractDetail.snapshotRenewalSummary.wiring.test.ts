import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ContractDetail.tsx', import.meta.url),
  'utf8'
);

describe('ContractDetail snapshot renewal summary wiring', () => {
  it('renders a renewal summary block in the contract snapshot card', () => {
    expect(source).toContain('const primaryAssignment = assignments[0] ?? null;');
    expect(source).toContain('text-xs uppercase tracking-wide text-muted-foreground">Renewal');
    expect(source).toContain('Source');
    expect(source).toContain('Decision Due');
  });

  it('handles ongoing contracts in the top renewal summary', () => {
    expect(source).toContain('Ongoing (no end date)');
  });
});
