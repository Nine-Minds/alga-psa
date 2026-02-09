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
    expect(state.compileStatus).toBe('idle');
    expect(state.renderStatus).toBe('idle');
    expect(state.verifyStatus).toBe('idle');
    expect(state.compileError).toBeNull();
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

    state = previewSessionReducer(state, { type: 'select-existing-invoice', invoiceId: 'inv-1' });
    expect(state.selectedInvoiceId).toBe('inv-1');

    state = previewSessionReducer(state, { type: 'clear-existing-invoice' });
    expect(state.selectedInvoiceId).toBeNull();
    expect(state.selectedInvoiceData).toBeNull();
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

    state = previewSessionReducer(state, { type: 'detail-load-error', error: 'Boom' });
    expect(state.isInvoiceDetailLoading).toBe(false);
    expect(state.invoiceDetailError).toBe('Boom');
  });

  it('tracks compile/render/verify lifecycle statuses', () => {
    let state = createInitialPreviewSessionState();

    state = previewSessionReducer(state, { type: 'pipeline-phase-start', phase: 'compile' });
    expect(state.compileStatus).toBe('running');
    expect(state.compileError).toBeNull();

    state = previewSessionReducer(state, { type: 'pipeline-phase-success', phase: 'compile' });
    expect(state.compileStatus).toBe('success');

    state = previewSessionReducer(state, { type: 'pipeline-phase-start', phase: 'render' });
    state = previewSessionReducer(state, { type: 'pipeline-phase-error', phase: 'render', error: 'Render failed' });
    expect(state.renderStatus).toBe('error');
    expect(state.renderError).toBe('Render failed');

    state = previewSessionReducer(state, { type: 'pipeline-phase-start', phase: 'verify' });
    state = previewSessionReducer(state, { type: 'pipeline-phase-success', phase: 'verify' });
    expect(state.verifyStatus).toBe('success');
    expect(state.verifyError).toBeNull();

    state = previewSessionReducer(state, { type: 'pipeline-reset' });
    expect(state.compileStatus).toBe('idle');
    expect(state.renderStatus).toBe('idle');
    expect(state.verifyStatus).toBe('idle');
    expect(state.compileError).toBeNull();
    expect(state.renderError).toBeNull();
    expect(state.verifyError).toBeNull();
  });
});
