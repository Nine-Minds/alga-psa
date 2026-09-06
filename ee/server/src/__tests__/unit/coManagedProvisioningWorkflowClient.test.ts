import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startCoManagedProvisioningWorkflow } from '../../lib/co-managed/workflowClient';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), start: vi.fn() }));
vi.mock('@temporalio/client', () => ({ Connection: { connect: mocks.connect },
  Client: class { workflow = { start: mocks.start }; } }));
beforeEach(() => { vi.resetAllMocks(); mocks.connect.mockResolvedValue({ close: mocks.close }); mocks.close.mockResolvedValue(undefined); });
describe('co-managed worker scheduling', () => {
  it('uses a stable tenant-qualified workflow identity and returns without awaiting a worker result', async () => {
    const input = { sponsorTenant: 'sponsor', operationId: 'operation' };
    const result = vi.fn(); mocks.start.mockResolvedValue({ result });
    expect(await startCoManagedProvisioningWorkflow(input)).toEqual({ enqueued: true });
    expect(mocks.start).toHaveBeenCalledWith('coManagedProvisioningWorkflow', expect.objectContaining({
      workflowId: 'co-managed-provisioning:sponsor:operation', workflowIdReusePolicy: 'ALLOW_DUPLICATE', args: [input],
    }));
    expect(result).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('treats a running duplicate as enqueued and closes the connection', async () => {
    const error = new Error('Already running'); error.name = 'WorkflowExecutionAlreadyStartedError'; mocks.start.mockRejectedValue(error);
    expect(await startCoManagedProvisioningWorkflow({ sponsorTenant: 'sponsor', operationId: 'operation' })).toEqual({ enqueued: true });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('returns a safe retry state for a provider failure and closes an opened connection', async () => {
    mocks.start.mockRejectedValue(new Error('Sensitive internal provider details'));
    expect(await startCoManagedProvisioningWorkflow({ sponsorTenant: 'sponsor', operationId: 'operation' })).toEqual({ enqueued: false });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
