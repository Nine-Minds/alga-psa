import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions completion-on-activation wiring', () => {
  it('marks renewal work item completed only when the linked renewal contract is active', () => {
    expect(source).toContain('export type RenewalCompletionResult = RenewalQueueMutationResult & {');
    expect(source).toContain('export const completeRenewalQueueItemForActivation = withAuth(async (');
    expect(source).toContain("throw new Error('Client contract id is required');");
    expect(source).toContain("throw new Error('Renewals queue status column is not available');");
    expect(source).toContain("throw new Error('Renewal work item not found');");
    expect(source).toContain("if (previousStatus !== 'renewing') {");
    expect(source).toContain('Only renewing work items can be completed after activation');
    expect(source).toContain("throw new Error('Activated renewal contract id is required');");
    expect(source).toContain("status: 'active',");
    expect(source).toContain("throw new Error('Activated renewal contract was not found in active status');");
    expect(source).toContain("status: 'completed',");
    expect(source).toContain('activated_contract_id: resolvedActivatedContractId,');
  });
});
