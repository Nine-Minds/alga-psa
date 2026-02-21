import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions completion-on-non-renewal wiring', () => {
  it('marks non-renewing work items completed after finalization confirmation', () => {
    expect(source).toContain('export const completeRenewalQueueItemForNonRenewal = withAuth(async (');
    expect(source).toContain("throw new Error('Client contract id is required');");
    expect(source).toContain("throw new Error('Renewals queue status column is not available');");
    expect(source).toContain("throw new Error('Renewal work item not found');");
    expect(source).toContain("if (previousStatus !== 'non_renewing') {");
    expect(source).toContain('Only non_renewing work items can be completed after non-renewal finalization');
    expect(source).toContain("status: 'completed',");
    expect(source).toContain('previous_status: previousStatus,');
  });
});
