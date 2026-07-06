import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('multi-active recurring preview identity wiring', () => {
  it('T041: AutomaticInvoices renders explicit assignment context in contract column so same-named concurrent contracts remain distinguishable', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/AutomaticInvoices.tsx'),
      'utf8',
    );

    expect(source).toContain('const getRecurringAssignmentContext =');
    expect(source).toContain("'Assigned contract line'");
    expect(source).toContain('data-testid={`contract-assignment-context-${group.parentSummary.candidateKey}`}');
    expect(source).toContain('assignmentLabels.map((contextValue) => (');
  });
});
