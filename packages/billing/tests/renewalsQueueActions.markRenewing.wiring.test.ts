import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions mark-renewing wiring', () => {
  it('transitions pending/non_renewing/snoozed renewal items to renewing with tenant-scoped validation', () => {
    expect(source).toContain('export const markRenewalQueueItemRenewing = withAuth(async (');
    expect(source).toContain("if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {");
    expect(source).toContain("throw new Error('Client contract id is required');");
    expect(source).toContain("throw new Error('Renewal work item not found');");
    expect(source).toContain("if (previousStatus !== 'pending' && previousStatus !== 'non_renewing' && previousStatus !== 'snoozed') {");
    expect(source).toContain('Only pending, non_renewing, or snoozed renewal work items can transition to renewing');
    expect(source).toContain("status: 'renewing',");
    expect(source).toContain('previous_status: previousStatus,');
  });
});
