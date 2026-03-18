import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvoiceService } from '../../../lib/api/services/InvoiceService';

const mocks = vi.hoisted(() => ({
  previewInvoice: vi.fn(),
  previewInvoiceForSelectionInput: vi.fn(),
  generateInvoice: vi.fn(),
  generateInvoiceForSelectionInput: vi.fn(),
  generateInvoiceNumber: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  previewInvoice: mocks.previewInvoice,
  previewInvoiceForSelectionInput: mocks.previewInvoiceForSelectionInput,
  generateInvoice: mocks.generateInvoice,
  generateInvoiceForSelectionInput: mocks.generateInvoiceForSelectionInput,
  generateInvoiceNumber: mocks.generateInvoiceNumber,
}));

describe('InvoiceService recurring selector-input routing', () => {
  const context = { tenant: 'tenant-1', userId: 'user-1' } as any;
  const compatibilityCycleId = '44444444-4444-4444-8444-444444444444';
  const selectorInput = {
    clientId: '11111111-1111-4111-8111-111111111111',
    windowStart: '2025-02-08',
    windowEnd: '2025-03-08',
    executionWindow: {
      kind: 'contract_cadence_window',
      identityKey: 'contract:11111111-1111-4111-8111-111111111111:2025-02-08:2025-03-08',
      cadenceOwner: 'contract',
      clientId: '11111111-1111-4111-8111-111111111111',
      contractId: '22222222-2222-4222-8222-222222222222',
      contractLineId: '33333333-3333-4333-8333-333333333333',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T065: InvoiceService preview path no longer queries client_billing_cycles directly for unbridged contract-cadence requests', async () => {
    const service = new InvoiceService();
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getKnex').mockRejectedValue(new Error('getKnex should not be called'));
    mocks.previewInvoiceForSelectionInput.mockResolvedValue({
      success: true,
      data: { invoiceNumber: 'PREVIEW-1' },
    });

    const result = await service.generatePreview({ selector_input: selectorInput }, context);

    expect(mocks.previewInvoiceForSelectionInput).toHaveBeenCalledWith(selectorInput);
    expect(mocks.previewInvoice).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: { invoiceNumber: 'PREVIEW-1' },
    });
  });

  it('T061/T063: API preview service accepts selector-input requests and preserves billing_cycle_id compatibility routing', async () => {
    const service = new InvoiceService();
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);

    mocks.previewInvoiceForSelectionInput.mockResolvedValueOnce({
      success: true,
      data: { invoiceNumber: 'PREVIEW-SELECTOR' },
    });
    mocks.previewInvoice.mockResolvedValueOnce({
      success: true,
      data: { invoiceNumber: 'PREVIEW-COMPAT' },
    });

    const selectorResult = await service.previewInvoice({ selector_input: selectorInput }, context);
    const compatibilityResult = await service.previewInvoice({ billing_cycle_id: compatibilityCycleId }, context);

    expect(mocks.previewInvoiceForSelectionInput).toHaveBeenCalledWith(selectorInput);
    expect(mocks.previewInvoice).toHaveBeenCalledWith(compatibilityCycleId);
    expect(selectorResult).toEqual({
      success: true,
      data: { invoiceNumber: 'PREVIEW-SELECTOR' },
    });
    expect(compatibilityResult).toEqual({
      success: true,
      data: { invoiceNumber: 'PREVIEW-COMPAT' },
    });
  });

  it('T062/T064: API generation service accepts selector-input requests and preserves billing_cycle_id compatibility routing', async () => {
    const service = new InvoiceService();
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);

    mocks.generateInvoiceForSelectionInput.mockResolvedValueOnce({
      invoice_id: 'invoice-selector-1',
    });
    mocks.generateInvoice.mockResolvedValueOnce({
      invoice_id: 'invoice-compat-1',
    });

    const selectorResult = await service.generateFromBillingCycle({ selector_input: selectorInput }, context);
    const compatibilityResult = await service.generateFromBillingCycle({ billing_cycle_id: compatibilityCycleId }, context);

    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenCalledWith(selectorInput);
    expect(mocks.generateInvoice).toHaveBeenCalledWith(compatibilityCycleId);
    expect(selectorResult).toEqual({
      invoice_id: 'invoice-selector-1',
    });
    expect(compatibilityResult).toEqual({
      invoice_id: 'invoice-compat-1',
    });
  });
});
