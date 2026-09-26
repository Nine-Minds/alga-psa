import { describe, expect, it, vi } from 'vitest';

const { start, signal, describeStatus } = vi.hoisted(() => ({ start: vi.fn(), signal: vi.fn(), describeStatus: vi.fn() }));
vi.mock('../../lib/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => ({ workflow: {
    start,
    getHandle: vi.fn(() => ({ signal, describe: describeStatus })),
  } })),
}));

import { signalInvoiceAutopay, startInvoiceAutopay } from '../../lib/temporal/invoiceAutopay';

describe('invoice auto-pay Temporal client helpers', () => {
  it('starts with the stable id and treats duplicate starts as success', async () => {
    const duplicate = new Error('already started');
    duplicate.name = 'WorkflowExecutionAlreadyStartedError';
    start.mockRejectedValueOnce(duplicate);
    await expect(startInvoiceAutopay('tenant-1', 'invoice-1')).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledWith('invoiceAutopayWorkflow', expect.objectContaining({
      workflowId: 'invoice-autopay:tenant-1:invoice-1',
      taskQueue: 'tenant-workflows',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
    }));
  });

  it('swallows a missing workflow when sending a signal', async () => {
    const missing = new Error('not found');
    missing.name = 'WorkflowNotFoundError';
    describeStatus.mockRejectedValueOnce(missing);
    await expect(signalInvoiceAutopay('tenant-1', 'invoice-1', 'invoiceSettled')).resolves.toBe(false);
  });

  it('does not report success for a completed workflow', async () => {
    describeStatus.mockResolvedValueOnce({ status: { name: 'COMPLETED' } });
    await expect(signalInvoiceAutopay('tenant-1', 'invoice-1', 'chargeNow')).resolves.toBe(false);
    expect(signal).not.toHaveBeenCalled();
  });
});
