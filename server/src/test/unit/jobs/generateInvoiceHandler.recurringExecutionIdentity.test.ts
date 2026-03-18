import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  generateInvoiceMock,
  generateInvoiceForSelectionInputMock,
} = vi.hoisted(() => ({
  generateInvoiceMock: vi.fn(),
  generateInvoiceForSelectionInputMock: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  generateInvoice: generateInvoiceMock,
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
    expect(generateInvoiceMock).not.toHaveBeenCalled();
  });

  it('keeps the legacy billingCycleId bridge for client-cadence jobs', async () => {
    await generateInvoiceHandler({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      billingCycleId: 'cycle-1',
    });

    expect(generateInvoiceMock).toHaveBeenCalledWith('cycle-1');
  });
});
