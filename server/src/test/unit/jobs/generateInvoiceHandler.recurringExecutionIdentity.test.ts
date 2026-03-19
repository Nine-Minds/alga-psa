import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  generateInvoiceForSelectionInputMock,
} = vi.hoisted(() => ({
  generateInvoiceForSelectionInputMock: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  generateInvoiceForSelectionInput: generateInvoiceForSelectionInputMock,
}));

import { generateInvoiceHandler } from '../../../lib/jobs/handlers/generateInvoiceHandler';

afterEach(() => {
  vi.clearAllMocks();
});

describe('generateInvoiceHandler recurring execution identity', () => {
  it('T271: source-backed job handling no longer requires a raw billingCycleId when a selector input and contract execution window are provided', async () => {
    const selectorInput = {
      clientId: 'client-1',
      windowStart: '2025-02-08T00:00:00Z',
      windowEnd: '2025-03-08T00:00:00Z',
      executionWindow: {
        kind: 'contract_cadence_window',
        cadenceOwner: 'contract',
        clientId: 'client-1',
        contractId: 'contract-1',
        contractLineId: 'line-1',
        windowStart: '2025-02-08T00:00:00Z',
        windowEnd: '2025-03-08T00:00:00Z',
        identityKey: 'contract_cadence_window:contract:client-1:contract-1:line-1:2025-02-08T00:00:00Z:2025-03-08T00:00:00Z',
      },
    } as any;

    await generateInvoiceHandler({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      executionWindow: selectorInput.executionWindow,
      selectorInput,
    });

    expect(generateInvoiceForSelectionInputMock).toHaveBeenCalledWith(selectorInput);
  });

  it('rejects recurring jobs that omit canonical selector input payloads', async () => {
    await expect(() =>
      generateInvoiceHandler({
        tenantId: 'tenant-1',
        clientId: 'client-1',
        executionWindow: {
          kind: 'client_cadence_window',
          cadenceOwner: 'client',
          clientId: 'client-1',
          scheduleKey: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
          periodKey: 'period:2025-02-01:2025-03-01',
          windowStart: '2025-02-01T00:00:00Z',
          windowEnd: '2025-03-01T00:00:00Z',
          identityKey:
            'client_cadence_window:client:client-1:schedule:tenant-1:client_contract_line:assignment-1:client:advance:period:2025-02-01:2025-03-01:2025-02-01T00:00:00Z:2025-03-01T00:00:00Z',
        },
      } as any),
    ).rejects.toThrow('Recurring invoice job is missing selectorInput.');
  });
});
