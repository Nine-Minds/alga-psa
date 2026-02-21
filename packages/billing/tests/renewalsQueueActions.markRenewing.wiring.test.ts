import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions mark-renewing wiring', () => {
  it('transitions pending renewal items to renewing with tenant-scoped validation', () => {
    expect(source).toContain('export const markRenewalQueueItemRenewing = withAuth(async (');
    expect(source).toContain("if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {");
    expect(source).toContain("throw new Error('Client contract id is required');");
    expect(source).toContain("const [hasStatusColumn, hasLastActionColumn, hasLastActionByColumn, hasLastActionAtColumn, hasLastActionNoteColumn] = await Promise.all([");
    expect(source).toContain("throw new Error('Renewals queue status column is not available');");
    expect(source).toContain("throw new Error('Renewal work item not found');");
    expect(source).toContain("if (previousStatus === 'non_renewing') {");
    expect(source).toContain('Cannot transition non_renewing work item to renewing without explicit override action');
    expect(source).toContain("if (previousStatus !== 'pending') {");
    expect(source).toContain('Only pending renewal work items can transition to renewing');
    expect(source).toContain("status: 'renewing',");
    expect(source).toContain('previous_status: previousStatus,');
  });
});
