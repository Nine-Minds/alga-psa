import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions permission wiring', () => {
  it('enforces billing update permission for queue mutation actions', () => {
    expect(source).toContain("const requireBillingUpdatePermission = (user: unknown): void => {");
    expect(source).toContain("if (!hasPermission(user as any, 'billing', 'update')) {");
    expect(source).toContain("throw new Error('Permission denied: Cannot update renewals queue');");

    expect(source).toContain("export const markRenewalQueueItemRenewing = withAuth(async (");
    expect(source).toContain("export const markRenewalQueueItemNonRenewing = withAuth(async (");
    expect(source).toContain("export const createRenewalDraftForQueueItem = withAuth(async (");
    expect(source).toContain("export const snoozeRenewalQueueItem = withAuth(async (");
    expect(source).toContain("export const assignRenewalQueueItemOwner = withAuth(async (");
    expect(source).toContain("export const completeRenewalQueueItemForActivation = withAuth(async (");
    expect(source).toContain("export const completeRenewalQueueItemForNonRenewal = withAuth(async (");
    expect(source).toContain("export const retryRenewalQueueTicketCreation = withAuth(async (");

    const permissionCallCount = source.split('requireBillingUpdatePermission(user);').length - 1;
    expect(permissionCallCount).toBe(8);
  });
});
