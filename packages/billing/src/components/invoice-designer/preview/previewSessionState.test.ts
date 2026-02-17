import { describe, expect, it } from 'vitest';
import {
  createInitialPreviewSessionState,
  previewSessionReducer,
} from './previewSessionState';

describe('previewSessionState', () => {
  it('initializes with expected defaults', () => {
    const state = createInitialPreviewSessionState();
    expect(state.sourceKind).toBe('sample');
    expect(state.selectedSampleId).toBeTypeOf('string');
    expect(state.selectedInvoiceId).toBeNull();
    expect(state.isInvoiceListLoading).toBe(false);
    expect(state.isInvoiceDetailLoading).toBe(false);
    expect(state.invoiceListError).toBeNull();
    expect(state.invoiceDetailError).toBeNull();
    expect(state.shapeStatus).toBe('idle');
    expect(state.renderStatus).toBe('idle');
    expect(state.verifyStatus).toBe('idle');
    expect(state.shapeError).toBeNull();
    expect(state.renderError).toBeNull();
    expect(state.verifyError).toBeNull();
  });

  it('supports source and selector transitions', () => {
    let state = createInitialPreviewSessionState();
    state = previewSessionReducer(state, { type: 'set-source', source: 'existing' });
    expect(state.sourceKind).toBe('existing');

    state = previewSessionReducer(state, { type: 'set-search-term', value: 'acme' });
    expect(state.invoiceSearchTerm).toBe('acme');
    expect(state.invoiceListPage).toBe(1);

    state = previewSessionReducer(state, { type: 'set-list-page', page: 3 });
    expect(state.invoiceListPage).toBe(3);

    state = previewSessionReducer(state, {
      type: 'detail-load-success',
      payload: {
        invoiceNumber: 'INV-1',
        issueDate: '2026-01-01',
        dueDate: '2026-01-31',
        currencyCode: 'USD',
        poNumber: null,
        customer: { name: 'Acme', address: '123 Main' },
        tenantClient: null,
        items: [],
        subtotal: 100,
        tax: 10,
        total: 110,
      },
    });

    state = previewSessionReducer(state, { type: 'select-existing-invoice', invoiceId: 'inv-1' });
    expect(state.selectedInvoiceId).toBe('inv-1');
    expect(state.selectedInvoiceData?.invoiceNumber).toBe('INV-1');

    state = previewSessionReducer(state, { type: 'clear-existing-invoice' });
    expect(state.selectedInvoiceId).toBeNull();
    expect(state.selectedInvoiceData).toBeNull();
  });

  it('preserves sample selection when toggling between sample and existing sources', () => {
    let state = createInitialPreviewSessionState();
    const initialSampleId = state.selectedSampleId;
    expect(initialSampleId).toBeTruthy();

    state = previewSessionReducer(state, { type: 'set-source', source: 'existing' });
    state = previewSessionReducer(state, { type: 'select-existing-invoice', invoiceId: 'inv-1' });
    state = previewSessionReducer(state, {
      type: 'detail-load-success',
      payload: {
        invoiceNumber: 'INV-EXISTING',
        issueDate: '2026-02-01',
        dueDate: '2026-02-15',
        currencyCode: 'USD',
        poNumber: null,
        customer: { name: 'Acme', address: '123 Main' },
        tenantClient: null,
        items: [],
        subtotal: 50,
        tax: 5,
        total: 55,
      },
    });

    state = previewSessionReducer(state, { type: 'set-source', source: 'sample' });
    expect(state.sourceKind).toBe('sample');
    expect(state.selectedSampleId).toBe(initialSampleId);
    expect(state.selectedInvoiceId).toBe('inv-1');
  });

  it('tracks list/detail async state transitions', () => {
    let state = createInitialPreviewSessionState();
    state = previewSessionReducer(state, { type: 'list-load-start' });
    expect(state.isInvoiceListLoading).toBe(true);
    expect(state.invoiceListError).toBeNull();

    state = previewSessionReducer(state, {
      type: 'list-load-success',
      payload: {
        invoices: [],
        totalPages: 4,
        totalCount: 36,
        page: 2,
      },
    });
    expect(state.isInvoiceListLoading).toBe(false);
    expect(state.invoiceListTotalPages).toBe(4);
    expect(state.invoiceListTotalCount).toBe(36);
    expect(state.invoiceListPage).toBe(2);

    state = previewSessionReducer(state, { type: 'detail-load-start' });
    expect(state.isInvoiceDetailLoading).toBe(true);
    expect(state.selectedInvoiceData).toBeNull();

    state = previewSessionReducer(state, { type: 'detail-load-error', error: 'Boom' });
    expect(state.isInvoiceDetailLoading).toBe(false);
    expect(state.invoiceDetailError).toBe('Boom');
  });

  it('retains prior existing invoice data while replacement detail request is in flight', () => {
    let state = createInitialPreviewSessionState();
    const previousInvoice = {
      invoiceNumber: 'INV-OLD',
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      currencyCode: 'USD',
      poNumber: null,
      customer: { name: 'Acme', address: '123 Main' },
      tenantClient: null,
      items: [],
      subtotal: 100,
      tax: 10,
      total: 110,
    };

    state = previewSessionReducer(state, { type: 'set-source', source: 'existing' });
    state = previewSessionReducer(state, { type: 'detail-load-success', payload: previousInvoice });
    state = previewSessionReducer(state, { type: 'select-existing-invoice', invoiceId: 'inv-new' });
    state = previewSessionReducer(state, { type: 'detail-load-start' });

    expect(state.isInvoiceDetailLoading).toBe(true);
    expect(state.selectedInvoiceData?.invoiceNumber).toBe('INV-OLD');

    state = previewSessionReducer(state, { type: 'detail-load-error', error: 'Timeout' });
    expect(state.isInvoiceDetailLoading).toBe(false);
    expect(state.invoiceDetailError).toBe('Timeout');
    expect(state.selectedInvoiceData?.invoiceNumber).toBe('INV-OLD');
  });

  it('tracks shape/render/verify lifecycle statuses', () => {
    let state = createInitialPreviewSessionState();

    state = previewSessionReducer(state, { type: 'pipeline-phase-start', phase: 'shape' });
    expect(state.shapeStatus).toBe('running');
    expect(state.shapeError).toBeNull();

    state = previewSessionReducer(state, { type: 'pipeline-phase-success', phase: 'shape' });
    expect(state.shapeStatus).toBe('success');

    state = previewSessionReducer(state, { type: 'pipeline-phase-start', phase: 'render' });
    state = previewSessionReducer(state, { type: 'pipeline-phase-error', phase: 'render', error: 'Render failed' });
    expect(state.renderStatus).toBe('error');
    expect(state.renderError).toBe('Render failed');

    state = previewSessionReducer(state, { type: 'pipeline-phase-start', phase: 'verify' });
    state = previewSessionReducer(state, { type: 'pipeline-phase-success', phase: 'verify' });
    expect(state.verifyStatus).toBe('success');
    expect(state.verifyError).toBeNull();

    state = previewSessionReducer(state, { type: 'pipeline-reset' });
    expect(state.shapeStatus).toBe('idle');
    expect(state.renderStatus).toBe('idle');
    expect(state.verifyStatus).toBe('idle');
    expect(state.shapeError).toBeNull();
    expect(state.renderError).toBeNull();
    expect(state.verifyError).toBeNull();
  });
});
