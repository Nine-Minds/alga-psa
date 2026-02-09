'use client';

import React, { useEffect, useMemo, useReducer, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { fetchInvoicesPaginated, getInvoiceForRendering } from '@alga-psa/billing/actions/invoiceQueries';
import { mapDbInvoiceToWasmViewModel } from '@alga-psa/billing/lib/adapters/invoiceAdapters';
import { DesignerShell } from './DesignerShell';
import { DesignCanvas } from './canvas/DesignCanvas';
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
  const canvasScale = useInvoiceDesignerStore((state) => state.canvasScale);
  const showRulers = useInvoiceDesignerStore((state) => state.showRulers);
  const gridSize = useInvoiceDesignerStore((state) => state.gridSize);
  const snapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);

  const [previewState, dispatch] = useReducer(previewSessionReducer, undefined, createInitialPreviewSessionState);
  const debouncedSearchTerm = useDebouncedValue(previewState.invoiceSearchTerm, 300);
  const debouncedNodes = useDebouncedValue(nodes, 140);
  const detailRequestSequence = useRef(0);

  const activeSampleId = previewState.selectedSampleId ?? DEFAULT_PREVIEW_SAMPLE_ID;
  const activeSample = useMemo(() => getPreviewSampleScenarioById(activeSampleId), [activeSampleId]);
  const previewData = previewState.sourceKind === 'sample' ? activeSample?.data ?? null : previewState.selectedInvoiceData;

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
                  <Input
                    id="preview-existing-search"
                    value={previewState.invoiceSearchTerm}
                    onChange={(event) => dispatch({ type: 'set-search-term', value: event.target.value })}
                    placeholder="Search by invoice number or client..."
                    data-automation-id="invoice-designer-preview-existing-search"
                  />
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

        <div className="border rounded overflow-hidden bg-white" data-automation-id="invoice-designer-preview-canvas">
          <DesignCanvas
            nodes={debouncedNodes}
            selectedNodeId={null}
            showGuides={false}
            showRulers={showRulers}
            gridSize={gridSize}
            canvasScale={canvasScale}
            snapToGrid={snapToGrid}
            guides={[]}
            isDragActive={false}
            forcedDropTarget={null}
            droppableId="designer-preview-canvas"
            onPointerLocationChange={() => {
              // no-op in preview mode
            }}
            onNodeSelect={() => {
              // no-op in preview mode
            }}
            onResize={() => {
              // no-op in preview mode
            }}
            readOnly
            previewData={previewData}
          />
        </div>
      </TabsContent>
    </Tabs>
  );
};
