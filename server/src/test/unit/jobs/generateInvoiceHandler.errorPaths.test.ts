import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateInvoiceForSelectionInput: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  generateInvoiceForSelectionInput: mocks.generateInvoiceForSelectionInput,
}));

import { generateInvoiceHandler } from 'server/src/lib/jobs/handlers/generateInvoiceHandler';

function buildExecutionWindow(identityKey: string) {
  return {
    kind: 'contract_cadence_window',
    cadenceOwner: 'contract',
    clientId: 'client-1',
    contractId: 'contract-1',
    contractLineId: 'line-1',
    windowStart: '2026-01-01T00:00:00Z',
    windowEnd: '2026-02-01T00:00:00Z',
    identityKey,
  } as any;
}

function buildJobData(selectorIdentityKey: string, windowIdentityKey: string) {
  return {
    tenantId: 'tenant-1',
    clientId: 'client-1',
    executionWindow: buildExecutionWindow(windowIdentityKey),
    selectorInput: {
      clientId: 'client-1',
      windowStart: '2026-01-01T00:00:00Z',
      windowEnd: '2026-02-01T00:00:00Z',
      executionWindow: buildExecutionWindow(selectorIdentityKey),
    },
  } as any;
}

describe('generateInvoiceHandler error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateInvoiceForSelectionInput.mockResolvedValue(undefined);
  });

  it('should reject jobs whose selectorInput identity does not match the execution window identity', async () => {
    const data = buildJobData('identity-a', 'identity-b');

    await expect(generateInvoiceHandler(data)).rejects.toThrow(
      'Recurring invoice job selectorInput identity identity-a does not match executionWindow identity-b.',
    );

    // No invoice generation side effect may occur for a mismatched window identity.
    expect(mocks.generateInvoiceForSelectionInput).not.toHaveBeenCalled();
  });

  it('should re-throw invoice generation failures so pg-boss records the job failure', async () => {
    const failure = new Error('invoice generation failed');
    mocks.generateInvoiceForSelectionInput.mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const data = buildJobData('identity-a', 'identity-a');

    await expect(generateInvoiceHandler(data)).rejects.toBe(failure);

    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('identity-a'),
      failure,
    );
    consoleError.mockRestore();
  });

  it('should call the invoice generator exactly once per job with the canonical selector input', async () => {
    const data = buildJobData('identity-a', 'identity-a');

    await generateInvoiceHandler(data);

    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenCalledTimes(1);
    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenCalledWith(data.selectorInput);
  });
});
