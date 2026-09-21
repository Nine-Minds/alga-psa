import { beforeEach, expect, it, vi } from 'vitest';
const activities = vi.hoisted(() => ({ cleanupCoManagedCustomer: vi.fn(), bootstrapCoManagedCustomer: vi.fn(), deliverCoManagedAdministratorInvitation: vi.fn() }));
vi.mock('@temporalio/workflow', () => ({ proxyActivities: () => activities }));
import { coManagedProvisioningCleanupWorkflow } from '../../../../temporal-workflows/src/workflows/co-managed-provisioning-workflow';
beforeEach(() => vi.resetAllMocks());
it('waits for actual cleanup acknowledgment and never starts provisioning or sends an invitation', async () => {
  const input = { sponsorTenant: 'sponsor', operationId: 'operation' };
  await coManagedProvisioningCleanupWorkflow(input);
  expect(activities.cleanupCoManagedCustomer).toHaveBeenCalledWith(input);
  expect(activities.bootstrapCoManagedCustomer).not.toHaveBeenCalled(); expect(activities.deliverCoManagedAdministratorInvitation).not.toHaveBeenCalled();
  activities.cleanupCoManagedCustomer.mockRejectedValueOnce(new Error('Cleanup incomplete'));
  await expect(coManagedProvisioningCleanupWorkflow(input)).rejects.toThrow('Cleanup incomplete');
});
