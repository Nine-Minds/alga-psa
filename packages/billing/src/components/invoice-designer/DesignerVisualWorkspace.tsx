'use client';

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { AsyncSearchableSelect } from '@alga-psa/ui/components/AsyncSearchableSelect';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { fetchInvoicesPaginated, getInvoiceForRendering } from '@alga-psa/billing/actions/invoiceQueries';
import { runAuthoritativeInvoiceTemplatePreview } from '@alga-psa/billing/actions/invoiceTemplatePreview';
import { mapDbInvoiceToWasmViewModel } from '@alga-psa/billing/lib/adapters/invoiceAdapters';
import type { IInvoiceTemplate } from '@alga-psa/types';
import { exportWorkspaceToInvoiceTemplateAst } from './ast/workspaceAst';
import PaperInvoice from '../billing-dashboard/PaperInvoice';
import { TemplateRenderer } from '../billing-dashboard/TemplateRenderer';
import { DesignerShell } from './DesignerShell';
import TransformsWorkspace from './transforms/TransformsWorkspace';
import { useInvoiceDesignerStore } from './state/designerStore';
import {
  createInitialPreviewSessionState,
  previewSessionReducer,
  type PreviewSourceKind,
} from './preview/previewSessionState';
import {
  derivePreviewPipelineDisplayStatuses,
  hasRenderablePreviewOutput,
  hasValidPreviewSelectionForSource,
} from './preview/previewStatus';
import {
  DEFAULT_PREVIEW_SAMPLE_ID,
  getPreviewSampleScenarioById,
  INVOICE_PREVIEW_SAMPLE_SCENARIOS,
} from './preview/sampleScenarios';

type VisualWorkspaceTab = 'design' | 'transforms' | 'preview';

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

const PREVIEW_SOURCE_OPTIONS: { value: PreviewSourceKind; label: string }[] = [
  { value: 'sample', label: 'Sample' },
  { value: 'existing', label: 'Existing' },
];

export const DesignerVisualWorkspace: React.FC<DesignerVisualWorkspaceProps> = ({
  visualWorkspaceTab,
  onVisualWorkspaceTabChange,
}) => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const canvasScale = useInvoiceDesignerStore((state) => state.canvasScale);
  const showGuides = useInvoiceDesignerStore((state) => state.showGuides);
  const showRulers = useInvoiceDesignerStore((state) => state.showRulers);
  const gridSize = useInvoiceDesignerStore((state) => state.gridSize);
  const snapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);
  const rootId = useInvoiceDesignerStore((state) => state.rootId);
  const transforms = useInvoiceDesignerStore((state) => state.transforms);

  const [previewState, dispatch] = useReducer(previewSessionReducer, undefined, createInitialPreviewSessionState);
  const [authoritativePreview, setAuthoritativePreview] = useState<
    Awaited<ReturnType<typeof runAuthoritativeInvoiceTemplatePreview>> | null
  >(null);
  const [manualRunNonce, setManualRunNonce] = useState(0);
  const debouncedNodes = useDebouncedValue(nodes, 140);
  const detailRequestSequence = useRef(0);
  const previewRunSequence = useRef(0);

  const activeSampleId = previewState.selectedSampleId ?? DEFAULT_PREVIEW_SAMPLE_ID;
  const activeSample = useMemo(() => getPreviewSampleScenarioById(activeSampleId), [activeSampleId]);
  const previewData = previewState.sourceKind === 'sample' ? activeSample?.data ?? null : previewState.selectedInvoiceData;
  const hasValidSelectionForSource = hasValidPreviewSelectionForSource({
    sourceKind: previewState.sourceKind,
    selectedInvoiceId: previewState.selectedInvoiceId,
    selectedInvoiceData: previewState.selectedInvoiceData,
    previewData,
  });
  const hasRenderedPreviewOutput = hasRenderablePreviewOutput({
    previewData,
    renderStatus: authoritativePreview?.render.status ?? 'idle',
    html: authoritativePreview?.render.html ?? null,
  });
  const canDisplaySuccessStates = hasValidSelectionForSource && hasRenderedPreviewOutput;
  const previewWorkspace = useMemo(
    () => ({
      rootId,
      nodesById: Object.fromEntries(
        debouncedNodes.map((node) => [
          node.id,
          { id: node.id, type: node.type, props: node.props, children: node.children },
        ])
      ),
      transforms,
      snapToGrid,
      gridSize,
      showGuides,
      showRulers,
      canvasScale,
    }),
    [canvasScale, debouncedNodes, gridSize, rootId, showGuides, showRulers, snapToGrid, transforms]
  );
  const previewTemplate = useMemo<IInvoiceTemplate | null>(() => {
    if (!previewData) {
      return null;
    }
    try {
      const templateAst = exportWorkspaceToInvoiceTemplateAst(previewWorkspace as any);
      return {
        template_id: `designer-preview-${previewWorkspace.rootId ?? 'root'}-${manualRunNonce}`,
        name: 'Designer Preview',
        version: 1,
        isStandard: false,
        templateAst,
      } as IInvoiceTemplate;
    } catch {
      return null;
    }
  }, [manualRunNonce, previewData, previewWorkspace]);
  const displayStatuses = derivePreviewPipelineDisplayStatuses({
    statuses: {
      shapeStatus: previewState.shapeStatus,
      renderStatus: previewState.renderStatus,
      verifyStatus: previewState.verifyStatus,
    },
    canDisplaySuccessStates,
  });
  const shapeDiagnostics = authoritativePreview?.compile.diagnostics ?? [];
  const authoritativeRenderOutput =
    authoritativePreview?.render.status === 'success' &&
    typeof authoritativePreview.render.html === 'string' &&
    typeof authoritativePreview.render.css === 'string'
      ? {
          html: authoritativePreview.render.html,
          css: authoritativePreview.render.css,
        }
      : null;
  const isPreviewRunning =
    previewState.shapeStatus === 'running' ||
    previewState.renderStatus === 'running' ||
    previewState.verifyStatus === 'running';
  const loadExistingInvoiceOptions = async ({
    search,
    page,
    limit,
  }: {
    search: string;
    page: number;
    limit: number;
  }) => {
    const result = await fetchInvoicesPaginated({
      page,
      pageSize: limit,
      searchTerm: search,
      status: 'all',
      sortBy: 'invoice_date',
      sortOrder: 'desc',
    });
    return {
      options: result.invoices.map((inv) => ({
        value: inv.invoice_id,
        label: `${inv.invoice_number} · ${inv.client.name}`,
      })),
      total: result.total,
    };
  };

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
      previewRunSequence.current += 1;
      dispatch({ type: 'pipeline-reset' });
      const shouldRetainPreviousRender =
        previewState.sourceKind === 'existing' &&
        (previewState.isInvoiceDetailLoading || Boolean(previewState.selectedInvoiceId));
      if (!shouldRetainPreviousRender) {
        setAuthoritativePreview(null);
      }
      return;
    }

    const requestId = ++previewRunSequence.current;

    dispatch({ type: 'pipeline-reset' });
    dispatch({ type: 'pipeline-phase-start', phase: 'shape' });
    dispatch({ type: 'pipeline-phase-start', phase: 'render' });
    dispatch({ type: 'pipeline-phase-start', phase: 'verify' });

    runAuthoritativeInvoiceTemplatePreview({
      workspace: previewWorkspace as any,
      invoiceData: previewData,
    })
      .then((result) => {
        if (requestId !== previewRunSequence.current) {
          return;
        }

        setAuthoritativePreview(result);

        if (result.compile.status === 'error') {
          dispatch({ type: 'pipeline-phase-error', phase: 'shape', error: result.compile.error ?? 'Shape failed.' });
        } else if (result.compile.status === 'success') {
          dispatch({ type: 'pipeline-phase-success', phase: 'shape' });
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
        dispatch({ type: 'pipeline-phase-error', phase: 'shape', error: message });
      });
  }, [
    manualRunNonce,
    previewData,
    previewWorkspace,
    previewState.isInvoiceDetailLoading,
    previewState.selectedInvoiceId,
    previewState.sourceKind,
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
        <TabsTrigger value="transforms" data-automation-id="invoice-designer-transforms-tab">
          Transforms
        </TabsTrigger>
        <TabsTrigger value="preview" data-automation-id="invoice-designer-preview-tab">
          Preview
        </TabsTrigger>
      </TabsList>

      <TabsContent value="design" className="pt-3">
        <DesignerShell />
      </TabsContent>

      <TabsContent value="transforms" className="pt-3">
        <TransformsWorkspace
          previewState={previewState}
          previewData={previewData}
          activeSample={activeSample}
          onSourceKindChange={(source) => dispatch({ type: 'set-source', source })}
          onSampleChange={(sampleId) => dispatch({ type: 'set-sample', sampleId })}
          onExistingInvoiceChange={(invoiceId) => dispatch({ type: 'select-existing-invoice', invoiceId })}
          onClearExistingInvoice={() => dispatch({ type: 'clear-existing-invoice' })}
          loadExistingInvoiceOptions={loadExistingInvoiceOptions}
        />
      </TabsContent>

      <TabsContent value="preview" className="pt-3 space-y-3">
        <div className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-card))] px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ViewSwitcher
              currentView={previewState.sourceKind}
              onChange={(source: PreviewSourceKind) => dispatch({ type: 'set-source', source })}
              options={PREVIEW_SOURCE_OPTIONS}
            />
          </div>

          {previewState.sourceKind === 'sample' ? (
            <div className="space-y-1">
              <label htmlFor="preview-sample-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Sample Scenario
              </label>
              <div className="w-fit">
                <CustomSelect
                  id="invoice-designer-preview-sample-select"
                  options={INVOICE_PREVIEW_SAMPLE_SCENARIOS.map((scenario) => ({
                    value: scenario.id,
                    label: scenario.label,
                  }))}
                  value={activeSample?.id ?? ''}
                  onValueChange={(value: string) => dispatch({ type: 'set-sample', sampleId: value })}
                  placeholder="Select scenario..."
                />
              </div>
              {activeSample && (
                <p className="text-xs text-slate-500" data-automation-id="invoice-designer-preview-sample-description">
                  {activeSample.description}
                </p>
              )}
            </div>
          ) : (
            <div className="w-72">
              <AsyncSearchableSelect
                id="invoice-designer-preview-existing-select"
                value={previewState.selectedInvoiceId ?? ''}
                onChange={(value: string) => {
                  if (!value) {
                    dispatch({ type: 'clear-existing-invoice' });
                    return;
                  }
                  dispatch({ type: 'select-existing-invoice', invoiceId: value });
                }}
                loadOptions={loadExistingInvoiceOptions}
                placeholder="Search invoices..."
                searchPlaceholder="Search by number or client..."
                emptyMessage="No invoices found."
                dropdownMode="overlay"
                label="Select Invoice"
              />
            </div>
          )}

          {previewState.sourceKind === 'existing' && previewState.isInvoiceDetailLoading && (
            <p
              className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-2 py-1 text-xs text-slate-500 dark:text-slate-400"
              data-automation-id="invoice-designer-preview-existing-detail-loading"
            >
              Loading invoice details...
            </p>
          )}

          {previewState.sourceKind === 'existing' && previewState.invoiceDetailError && (
            <p
              className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
              data-automation-id="invoice-designer-preview-existing-detail-error"
            >
              {previewState.invoiceDetailError}
            </p>
          )}

          {previewState.sourceKind === 'existing' && !previewState.selectedInvoiceId && (
            <p
              className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-2 py-1 text-xs text-slate-500 dark:text-slate-400"
              data-automation-id="invoice-designer-preview-existing-detail-empty"
            >
              Select an invoice to preview data-bound output.
            </p>
          )}
        </div>

        <div
          className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2"
          data-automation-id="invoice-designer-preview-pipeline-status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="font-semibold">Shape</span>
              <span
                className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] px-2 py-0.5 uppercase"
                data-automation-id="invoice-designer-preview-shape-status"
              >
                {displayStatuses.shapeStatus}
              </span>
              <span className="font-semibold">Render</span>
              <span
                className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] px-2 py-0.5 uppercase"
                data-automation-id="invoice-designer-preview-render-status"
              >
                {displayStatuses.renderStatus}
              </span>
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
              className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive space-y-1"
              data-automation-id="invoice-designer-preview-shape-error"
            >
              <p>{authoritativePreview.compile.error ?? 'Shaping failed.'}</p>
              {authoritativePreview.compile.details && (
                <p className="text-[11px] text-destructive">{authoritativePreview.compile.details}</p>
              )}
            </div>
          )}

          {shapeDiagnostics.length > 0 && (
            <ul
              className="space-y-1 text-xs"
              data-automation-id="invoice-designer-preview-shape-diagnostics-list"
            >
              {shapeDiagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.raw}-${index}`}
                  className="rounded border border-warning/30 bg-warning/10 px-2 py-1 text-warning"
                  data-automation-id="invoice-designer-preview-shape-diagnostic-item"
                >
                  <span className="font-semibold uppercase">{diagnostic.severity}</span>{' '}
                  <span>{diagnostic.message}</span>
                  {diagnostic.code && <span className="text-amber-700"> [{diagnostic.code}]</span>}
                  {diagnostic.path && <span className="text-amber-700"> path: {diagnostic.path}</span>}
                  {diagnostic.operationId && <span className="text-amber-700"> op: {diagnostic.operationId}</span>}
                  {diagnostic.nodeId && <span className="text-amber-700"> (node: {diagnostic.nodeId})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="border dark:border-[rgb(var(--color-border-200))] rounded overflow-hidden bg-white dark:bg-[rgb(var(--color-card))] min-h-[320px]"
          data-automation-id="invoice-designer-preview-render-output"
        >
          {!previewData && (
            <div className="p-4 text-sm text-slate-500" data-automation-id="invoice-designer-preview-empty-state">
              Select sample or existing invoice data to generate an authoritative preview.
            </div>
          )}

          {previewData && isPreviewRunning && (
            <div className="p-4 text-sm text-slate-500" data-automation-id="invoice-designer-preview-loading-state">
              Shaping and rendering preview...
            </div>
          )}

          {previewData && !previewTemplate && (
            <Alert
              variant="destructive"
              className="rounded-none border-x-0 border-b-0"
              data-automation-id="invoice-designer-preview-render-error"
            >
              <AlertDescription className="text-sm">
                Preview template could not be generated from the current workspace.
              </AlertDescription>
            </Alert>
          )}

          {previewData && previewTemplate && authoritativePreview?.render.status === 'error' && (
            <Alert
              variant="destructive"
              className="rounded-none border-x-0 border-b-0"
              data-automation-id="invoice-designer-preview-render-error"
            >
              <AlertDescription className="text-sm">
                {authoritativePreview.render.error ?? 'Preview rendering failed.'}
              </AlertDescription>
            </Alert>
          )}

          {previewData && previewTemplate && authoritativeRenderOutput && (
            <div className="p-2" data-automation-id="invoice-designer-preview-render-template">
              <PaperInvoice templateAst={previewTemplate.templateAst ?? null}>
                <TemplateRenderer
                  template={previewTemplate}
                  invoiceData={previewData}
                  renderOverride={authoritativeRenderOutput}
                />
              </PaperInvoice>
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
};
