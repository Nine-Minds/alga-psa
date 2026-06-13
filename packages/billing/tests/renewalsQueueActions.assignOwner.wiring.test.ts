import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions assign-owner wiring', () => {
  it('sets assigned_to on the renewal work item with tenant-scoped validation', () => {
    expect(source).toContain('export type RenewalAssignmentResult = {');
    expect(source).toContain('export const assignRenewalQueueItemOwner = withAuth(async (');
    expect(source).toContain("throw new Error('Client contract id is required');");
    expect(source).toContain("throw new Error('Assigned owner must be a user id string or null');");
    expect(source).toContain("throw new Error('Cross-tenant owner identifier is not allowed');");
    expect(source).toContain("throw new Error('Assigned owner was not found in this tenant');");
    expect(source).toContain('const normalizedAssignedTo = typeof assignedTo === \'string\' && assignedTo.trim().length > 0');
    expect(source).toContain("throw new Error('Renewal work item not found');");
    expect(source).toContain('assigned_to: normalizedAssignedTo,');
    expect(source).toContain('status: currentStatus,');
  });
});
