import { describe, expect, it } from 'vitest';
import {
  derivePreviewPipelineDisplayStatuses,
  hasRenderablePreviewOutput,
  hasValidPreviewSelectionForSource,
} from './previewStatus';

const previewInvoice = {
  invoiceNumber: 'INV-101',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: null,
  customer: { name: 'Acme', address: '123 Main' },
  tenantClient: null,
  items: [],
  subtotal: 100,
  tax: 8,
  total: 108,
};

describe('previewStatus', () => {
  it('requires selected invoice id and mapped data for existing-source validity', () => {
    expect(
      hasValidPreviewSelectionForSource({
        sourceKind: 'existing',
        selectedInvoiceId: null,
        selectedInvoiceData: previewInvoice,
        previewData: previewInvoice,
      })
    ).toBe(false);

    expect(
      hasValidPreviewSelectionForSource({
        sourceKind: 'existing',
        selectedInvoiceId: 'inv-1',
        selectedInvoiceData: previewInvoice,
        previewData: previewInvoice,
      })
    ).toBe(true);
  });

  it('treats rendered preview output as valid only when html exists and render succeeded', () => {
    expect(
      hasRenderablePreviewOutput({
        previewData: previewInvoice,
        renderStatus: 'success',
        html: '<div>ok</div>',
      })
    ).toBe(true);

    expect(
      hasRenderablePreviewOutput({
        previewData: previewInvoice,
        renderStatus: 'success',
        html: '',
      })
    ).toBe(false);
  });

  it('downgrades success phase display to idle when success cannot be legitimately shown', () => {
    const display = derivePreviewPipelineDisplayStatuses({
      statuses: {
        compileStatus: 'success',
        renderStatus: 'success',
        verifyStatus: 'success',
      },
      canDisplaySuccessStates: false,
    });

    expect(display.compileStatus).toBe('idle');
    expect(display.renderStatus).toBe('idle');
    expect(display.verifyStatus).toBe('idle');
  });

  it('preserves running and error statuses while only normalizing success states', () => {
    const display = derivePreviewPipelineDisplayStatuses({
      statuses: {
        compileStatus: 'running',
        renderStatus: 'error',
        verifyStatus: 'success',
      },
      canDisplaySuccessStates: false,
    });

    expect(display.compileStatus).toBe('running');
    expect(display.renderStatus).toBe('error');
    expect(display.verifyStatus).toBe('idle');
  });
});
