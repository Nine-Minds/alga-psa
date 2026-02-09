'use client';

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { fetchInvoicesPaginated, getInvoiceForRendering } from '@alga-psa/billing/actions/invoiceQueries';
import { runAuthoritativeInvoiceTemplatePreview } from '@alga-psa/billing/actions/invoiceTemplatePreview';
import { mapDbInvoiceToWasmViewModel } from '@alga-psa/billing/lib/adapters/invoiceAdapters';
import { DesignerShell } from './DesignerShell';
import { useInvoiceDesignerStore } from './state/designerStore';
import {
  createInitialPreviewSessionState,
  previewSessionReducer,
  type PreviewSourceKind,
} from './preview/previewSessionState';
import {
  DEFAULT_PREVIEW_SAMPLE_ID,
  getPreviewSampleScenarioById,
  INVOICE_PREVIEW_SAMPLE_SCENARIOS,
} from './preview/sampleScenarios';

type VisualWorkspaceTab = 'design' | 'preview';

type DesignerVisualWorkspaceProps = {
  visualWorkspaceTab: VisualWorkspaceTab;
  onVisualWorkspaceTabChange: (tab: VisualWorkspaceTab) => void;
};

const useDebouncedValue = <T,>(value: T, delayMs: number) => {
  const [debounced, setDebounced] = React.useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

const PreviewSourceToggle: React.FC<{
  sourceKind: PreviewSourceKind;
  onSourceChange: (next: PreviewSourceKind) => void;
}> = ({ sourceKind, onSourceChange }) => (
  <div
    className="inline-flex rounded-md border border-slate-200 bg-white p-1"
    role="group"
    aria-label="Preview source"
    data-automation-id="invoice-designer-preview-source-toggle"
  >
    <Button
      id="invoice-designer-preview-source-sample-button"
      variant={sourceKind === 'sample' ? 'default' : 'ghost'}
      size="sm"
      onClick={() => onSourceChange('sample')}
      data-automation-id="invoice-designer-preview-source-sample"
    >
      Sample
    </Button>
    <Button
      id="invoice-designer-preview-source-existing-button"
      variant={sourceKind === 'existing' ? 'default' : 'ghost'}
      size="sm"
      onClick={() => onSourceChange('existing')}
      data-automation-id="invoice-designer-preview-source-existing"
    >
      Existing
    </Button>
  </div>
);

export const DesignerVisualWorkspace: React.FC<DesignerVisualWorkspaceProps> = ({
  visualWorkspaceTab,
  onVisualWorkspaceTabChange,
}) => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const constraints = useInvoiceDesignerStore((state) => state.constraints);
  const canvasScale = useInvoiceDesignerStore((state) => state.canvasScale);
  const showGuides = useInvoiceDesignerStore((state) => state.showGuides);
  const showRulers = useInvoiceDesignerStore((state) => state.showRulers);
  const gridSize = useInvoiceDesignerStore((state) => state.gridSize);
  const snapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);

  const [previewState, dispatch] = useReducer(previewSessionReducer, undefined, createInitialPreviewSessionState);
  const [authoritativePreview, setAuthoritativePreview] = useState<
    Awaited<ReturnType<typeof runAuthoritativeInvoiceTemplatePreview>> | null
  >(null);
  const [manualRunNonce, setManualRunNonce] = useState(0);
  const debouncedSearchTerm = useDebouncedValue(previewState.invoiceSearchTerm, 300);
  const debouncedNodes = useDebouncedValue(nodes, 140);
  const detailRequestSequence = useRef(0);
  const previewRunSequence = useRef(0);
  const lastManualRunNonceRef = useRef(0);

  const activeSampleId = previewState.selectedSampleId ?? DEFAULT_PREVIEW_SAMPLE_ID;
  const activeSample = useMemo(() => getPreviewSampleScenarioById(activeSampleId), [activeSampleId]);
  const previewData = previewState.sourceKind === 'sample' ? activeSample?.data ?? null : previewState.selectedInvoiceData;
  const isPreviewRunning =
    previewState.compileStatus === 'running' ||
    previewState.renderStatus === 'running' ||
    previewState.verifyStatus === 'running';

  useEffect(() => {
    if (previewState.sourceKind !== 'existing') {
      return;
    }

    let isMounted = true;
    dispatch({ type: 'list-load-start' });

    fetchInvoicesPaginated({
      page: previewState.invoiceListPage,
      pageSize: previewState.invoiceListPageSize,
      searchTerm: debouncedSearchTerm,
      status: 'all',
      sortBy: 'invoice_date',
      sortOrder: 'desc',
    })
      .then((result) => {
        if (!isMounted) {
          return;
        }
        dispatch({
          type: 'list-load-success',
          payload: {
            invoices: result.invoices,
            totalPages: result.totalPages,
            totalCount: result.total,
            page: result.page,
          },
        });
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load invoices.';
        dispatch({ type: 'list-load-error', error: message });
      });

    return () => {
      isMounted = false;
    };
  }, [
    debouncedSearchTerm,
    previewState.invoiceListPage,
    previewState.invoiceListPageSize,
    previewState.sourceKind,
  ]);

  useEffect(() => {
    if (previewState.sourceKind !== 'existing' || !previewState.selectedInvoiceId) {
      return;
    }

    const requestId = ++detailRequestSequence.current;
    dispatch({ type: 'detail-load-start' });

    getInvoiceForRendering(previewState.selectedInvoiceId)
      .then((invoice) => {
        if (requestId !== detailRequestSequence.current) {
          return;
        }
        const mapped = mapDbInvoiceToWasmViewModel(invoice);
        if (!mapped) {
          throw new Error('Could not map invoice details for preview.');
        }
        dispatch({ type: 'detail-load-success', payload: mapped });
      })
      .catch((error) => {
        if (requestId !== detailRequestSequence.current) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load invoice details.';
        dispatch({ type: 'detail-load-error', error: message });
      });
  }, [previewState.selectedInvoiceId, previewState.sourceKind]);

  useEffect(() => {
    if (visualWorkspaceTab !== 'preview') {
      return;
    }

    if (!previewData) {
      setAuthoritativePreview(null);
      dispatch({ type: 'pipeline-reset' });
      return;
    }

    const requestId = ++previewRunSequence.current;
    const bypassCompileCache = manualRunNonce !== lastManualRunNonceRef.current;
    lastManualRunNonceRef.current = manualRunNonce;

    dispatch({ type: 'pipeline-reset' });
    dispatch({ type: 'pipeline-phase-start', phase: 'compile' });
    dispatch({ type: 'pipeline-phase-start', phase: 'render' });
    dispatch({ type: 'pipeline-phase-start', phase: 'verify' });

    runAuthoritativeInvoiceTemplatePreview({
      workspace: {
        nodes: debouncedNodes,
        constraints,
        snapToGrid,
        gridSize,
        showGuides,
        showRulers,
        canvasScale,
      },
      invoiceData: previewData,
      bypassCompileCache,
    })
      .then((result) => {
        if (requestId !== previewRunSequence.current) {
          return;
        }

        setAuthoritativePreview(result);

        if (result.compile.status === 'error') {
          dispatch({ type: 'pipeline-phase-error', phase: 'compile', error: result.compile.error ?? 'Compile failed.' });
        } else if (result.compile.status === 'success') {
          dispatch({ type: 'pipeline-phase-success', phase: 'compile' });
        }

        if (result.render.status === 'error') {
          dispatch({ type: 'pipeline-phase-error', phase: 'render', error: result.render.error ?? 'Render failed.' });
        } else if (result.render.status === 'success') {
          dispatch({ type: 'pipeline-phase-success', phase: 'render' });
        }

        if (result.verification.status === 'error') {
          dispatch({
            type: 'pipeline-phase-error',
            phase: 'verify',
            error: result.verification.error ?? 'Verification failed.',
          });
        } else if (result.verification.status === 'pass' || result.verification.status === 'issues') {
          dispatch({ type: 'pipeline-phase-success', phase: 'verify' });
        }
      })
      .catch((error) => {
        if (requestId !== previewRunSequence.current) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Preview pipeline failed.';
        setAuthoritativePreview(null);
        dispatch({ type: 'pipeline-phase-error', phase: 'compile', error: message });
      });
  }, [
    canvasScale,
    constraints,
    debouncedNodes,
    gridSize,
    manualRunNonce,
    previewData,
    showGuides,
    showRulers,
    snapToGrid,
    visualWorkspaceTab,
  ]);

  return (
    <Tabs
      value={visualWorkspaceTab}
      onValueChange={(value) => onVisualWorkspaceTabChange(value as VisualWorkspaceTab)}
      data-automation-id="invoice-designer-visual-workspace-tabs"
    >
      <TabsList>
        <TabsTrigger value="design" data-automation-id="invoice-designer-design-tab">
          Design
        </TabsTrigger>
        <TabsTrigger value="preview" data-automation-id="invoice-designer-preview-tab">
          Preview
        </TabsTrigger>
      </TabsList>

      <TabsContent value="design" className="pt-3">
        <DesignerShell />
      </TabsContent>

      <TabsContent value="preview" className="pt-3 space-y-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <PreviewSourceToggle
              sourceKind={previewState.sourceKind}
              onSourceChange={(source) => dispatch({ type: 'set-source', source })}
            />
          </div>

          {previewState.sourceKind === 'sample' ? (
            <div className="space-y-1">
              <label htmlFor="preview-sample-select" className="text-xs font-semibold text-slate-700">
                Sample Scenario
              </label>
              <select
                id="preview-sample-select"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={activeSample?.id ?? ''}
                onChange={(event) => dispatch({ type: 'set-sample', sampleId: event.target.value })}
                data-automation-id="invoice-designer-preview-sample-select"
              >
                {INVOICE_PREVIEW_SAMPLE_SCENARIOS.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </option>
                ))}
              </select>
              {activeSample && (
                <p className="text-xs text-slate-500" data-automation-id="invoice-designer-preview-sample-description">
                  {activeSample.description}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-1">
                  <label htmlFor="preview-existing-search" className="text-xs font-semibold text-slate-700">
                    Search Existing Invoices
                  </label>
                  <div data-automation-id="invoice-designer-preview-existing-search">
                    <Input
                      id="preview-existing-search"
                      aria-label="Search Existing Invoices"
                      value={previewState.invoiceSearchTerm}
                      onChange={(event) => dispatch({ type: 'set-search-term', value: event.target.value })}
                      placeholder="Search by invoice number or client..."
                      data-automation-id="invoice-designer-preview-existing-search-input"
                    />
                  </div>
                </div>
                <Button
                  id="invoice-designer-preview-existing-clear-button"
                  variant="outline"
                  size="sm"
                  onClick={() => dispatch({ type: 'clear-existing-invoice' })}
                  data-automation-id="invoice-designer-preview-existing-clear"
                >
                  Clear
                </Button>
              </div>

              {previewState.isInvoiceListLoading && (
                <p
                  className="text-xs text-slate-500"
                  data-automation-id="invoice-designer-preview-existing-loading"
                >
                  Loading invoices...
                </p>
              )}

              {!previewState.isInvoiceListLoading && previewState.invoiceListError && (
                <p
                  className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700"
                  data-automation-id="invoice-designer-preview-existing-error"
                >
                  {previewState.invoiceListError}
                </p>
              )}

              {!previewState.isInvoiceListLoading &&
                !previewState.invoiceListError &&
                previewState.invoiceList.length === 0 && (
                  <p
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500"
                    data-automation-id="invoice-designer-preview-existing-empty"
                  >
                    No invoices matched this search.
                  </p>
                )}

              {previewState.invoiceList.length > 0 && (
                <div className="space-y-2">
                  <label htmlFor="preview-existing-select" className="text-xs font-semibold text-slate-700">
                    Select Invoice
                  </label>
                  <select
                    id="preview-existing-select"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={previewState.selectedInvoiceId ?? ''}
                    onChange={(event) => {
                      const invoiceId = event.target.value;
                      if (!invoiceId) {
                        dispatch({ type: 'clear-existing-invoice' });
                        return;
                      }
                      dispatch({ type: 'select-existing-invoice', invoiceId });
                    }}
                    data-automation-id="invoice-designer-preview-existing-select"
                  >
                    <option value="">Select invoice...</option>
                    {previewState.invoiceList.map((invoice) => (
                      <option key={invoice.invoice_id} value={invoice.invoice_id}>
                        {invoice.invoice_number} · {invoice.client.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span data-automation-id="invoice-designer-preview-existing-pagination-status">
                      Page {previewState.invoiceListPage} of {Math.max(1, previewState.invoiceListTotalPages || 1)}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        id="invoice-designer-preview-existing-prev-page-button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          dispatch({ type: 'set-list-page', page: Math.max(1, previewState.invoiceListPage - 1) })
                        }
                        disabled={previewState.invoiceListPage <= 1 || previewState.isInvoiceListLoading}
                        data-automation-id="invoice-designer-preview-existing-prev-page"
                      >
                        Previous
                      </Button>
                      <Button
                        id="invoice-designer-preview-existing-next-page-button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          dispatch({
                            type: 'set-list-page',
                            page: previewState.invoiceListPage + 1,
                          })
                        }
                        disabled={
                          previewState.invoiceListTotalPages === 0 ||
                          previewState.invoiceListPage >= previewState.invoiceListTotalPages ||
                          previewState.isInvoiceListLoading
                        }
                        data-automation-id="invoice-designer-preview-existing-next-page"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {previewState.sourceKind === 'existing' && previewState.isInvoiceDetailLoading && (
            <p
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500"
              data-automation-id="invoice-designer-preview-existing-detail-loading"
            >
              Loading invoice details...
            </p>
          )}

          {previewState.sourceKind === 'existing' && previewState.invoiceDetailError && (
            <p
              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700"
              data-automation-id="invoice-designer-preview-existing-detail-error"
            >
              {previewState.invoiceDetailError}
            </p>
          )}

          {previewState.sourceKind === 'existing' && !previewState.selectedInvoiceId && (
            <p
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500"
              data-automation-id="invoice-designer-preview-existing-detail-empty"
            >
              Select an invoice to preview data-bound output.
            </p>
          )}
        </div>

        <div
          className="rounded-md border border-slate-200 bg-white px-3 py-2 space-y-2"
          data-automation-id="invoice-designer-preview-pipeline-status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold">Compile</span>
              <span
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 uppercase"
                data-automation-id="invoice-designer-preview-compile-status"
              >
                {previewState.compileStatus}
              </span>
              <span className="font-semibold">Render</span>
              <span
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 uppercase"
                data-automation-id="invoice-designer-preview-render-status"
              >
                {previewState.renderStatus}
              </span>
              <span className="font-semibold">Verify</span>
              <span
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 uppercase"
                data-automation-id="invoice-designer-preview-verify-status"
              >
                {previewState.verifyStatus}
              </span>
              {authoritativePreview?.compile.status === 'success' && (
                <span
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5"
                  data-automation-id="invoice-designer-preview-compile-cache-hit"
                >
                  Cache: {authoritativePreview.compile.cacheHit ? 'Hit' : 'Miss'}
                </span>
              )}
            </div>
            <Button
              id="invoice-designer-preview-rerun-button"
              variant="outline"
              size="sm"
              disabled={!previewData || isPreviewRunning}
              onClick={() => setManualRunNonce((value) => value + 1)}
              data-automation-id="invoice-designer-preview-rerun"
            >
              Re-run
            </Button>
          </div>

          {authoritativePreview?.compile.status === 'error' && (
            <div
              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 space-y-1"
              data-automation-id="invoice-designer-preview-compile-error"
            >
              <p>{authoritativePreview.compile.error ?? 'Compilation failed.'}</p>
              {authoritativePreview.compile.details && (
                <p className="text-[11px] text-red-600">{authoritativePreview.compile.details}</p>
              )}
            </div>
          )}

          {authoritativePreview?.compile.diagnostics?.length > 0 && (
            <ul
              className="space-y-1 text-xs"
              data-automation-id="invoice-designer-preview-compile-diagnostics-list"
            >
              {authoritativePreview.compile.diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.raw}-${index}`}
                  className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900"
                  data-automation-id="invoice-designer-preview-compile-diagnostic-item"
                >
                  <span className="font-semibold uppercase">{diagnostic.severity}</span>{' '}
                  <span>{diagnostic.message}</span>
                  {diagnostic.nodeId && <span className="text-amber-700"> (node: {diagnostic.nodeId})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="border rounded overflow-hidden bg-white min-h-[320px]"
          data-automation-id="invoice-designer-preview-render-output"
        >
          {!previewData && (
            <div className="p-4 text-sm text-slate-500" data-automation-id="invoice-designer-preview-empty-state">
              Select sample or existing invoice data to generate an authoritative preview.
            </div>
          )}

          {previewData && isPreviewRunning && (
            <div className="p-4 text-sm text-slate-500" data-automation-id="invoice-designer-preview-loading-state">
              Compiling and rendering preview...
            </div>
          )}

          {previewData && authoritativePreview?.render.status === 'error' && (
            <div
              className="p-4 text-sm text-red-700 bg-red-50 border-t border-red-200"
              data-automation-id="invoice-designer-preview-render-error"
            >
              {authoritativePreview.render.error ?? 'Preview rendering failed.'}
            </div>
          )}

          {previewData && authoritativePreview?.render.status === 'success' && authoritativePreview.render.html && (
            <iframe
              title="Invoice Preview Output"
              className="w-full min-h-[640px] border-0"
              srcDoc={`<style>${authoritativePreview.render.css ?? ''}</style>${authoritativePreview.render.html}`}
              data-automation-id="invoice-designer-preview-render-iframe"
            />
          )}
        </div>

        <div
          className="rounded-md border border-slate-200 bg-white px-3 py-2 space-y-2"
          data-automation-id="invoice-designer-preview-verification-summary"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Layout Verification</p>
            <span
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs uppercase"
              data-automation-id="invoice-designer-preview-verification-badge"
            >
              {authoritativePreview?.verification.status ?? 'idle'}
            </span>
          </div>

          {authoritativePreview?.verification.status === 'error' && (
            <p
              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700"
              data-automation-id="invoice-designer-preview-verification-error"
            >
              {authoritativePreview.verification.error ?? 'Verification failed to execute.'}
            </p>
          )}

          {authoritativePreview?.verification.mismatches?.length ? (
            <ul
              className="space-y-1"
              data-automation-id="invoice-designer-preview-verification-mismatch-list"
            >
              {authoritativePreview.verification.mismatches.map((mismatch) => (
                <li
                  key={mismatch.constraintId}
                  className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
                  data-automation-id="invoice-designer-preview-verification-mismatch-item"
                >
                  <span className="font-semibold">{mismatch.constraintId}</span>{' '}
                  <span>
                    expected {mismatch.expected}, actual {mismatch.actual ?? 'missing'}, delta{' '}
                    {mismatch.delta ?? 'n/a'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            authoritativePreview?.verification.status === 'pass' && (
              <p
                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800"
                data-automation-id="invoice-designer-preview-verification-pass"
              >
                All layout constraints are within tolerance.
              </p>
            )
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
};
