'use client';

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Editor } from '@monaco-editor/react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { TEMPLATE_AST_VERSION, type IQuoteDocumentTemplate } from '@alga-psa/types';
import { getQuoteDocumentTemplate, saveQuoteDocumentTemplate } from '../../../actions/quoteDocumentTemplates';
import { runAuthoritativeQuoteTemplatePreview } from '../../../actions/quoteTemplatePreview';
import { getStandardQuoteTemplateAstByCode } from '../../../lib/quote-template-ast/standardTemplates';
import { DesignerShell } from '../../invoice-designer/DesignerShell';
import TransformsWorkspace from '../../invoice-designer/transforms/TransformsWorkspace';
import PaperInvoice from '../PaperInvoice';
import { TemplateRenderer } from '../TemplateRenderer';
import { useInvoiceDesignerStore } from '../../invoice-designer/state/designerStore';
import {
  exportWorkspaceToTemplateAst,
  exportWorkspaceToTemplateAstJson,
  importTemplateAstToWorkspace,
} from '../../invoice-designer/ast/workspaceAst';
import {
  createInitialPreviewSessionState,
  previewSessionReducer,
} from '../../invoice-designer/preview/previewSessionState';
import {
  derivePreviewPipelineDisplayStatuses,
  hasRenderablePreviewOutput,
} from '../../invoice-designer/preview/previewStatus';
import {
  DEFAULT_QUOTE_PREVIEW_SAMPLE_ID,
  getQuotePreviewSampleScenarioById,
  QUOTE_PREVIEW_SAMPLE_SCENARIOS,
} from '../../invoice-designer/preview/quoteSampleScenarios';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface QuoteDocumentTemplateEditorProps {
  templateId: string | null;
  standardCode?: string | null;
  onBack?: () => void;
}

type EditorTab = 'visual' | 'code';
type VisualWorkspaceTab = 'design' | 'transforms' | 'preview';

const useDebouncedValue = <T,>(value: T, delayMs: number) => {
  const [debounced, setDebounced] = React.useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

const QuoteDocumentTemplateEditor: React.FC<QuoteDocumentTemplateEditorProps> = ({ templateId, standardCode, onBack }) => {
  const { t } = useTranslation('msp/quotes');
  const { formatDate } = useFormatters();
  const router = useRouter();
  const handleBack = () => onBack ? onBack() : router.push('/msp/billing?tab=quote-templates');
  const isNewTemplate = !templateId;
  const [template, setTemplate] = useState<Partial<IQuoteDocumentTemplate> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>('visual');
  const [visualWorkspaceTab, setVisualWorkspaceTab] = useState<VisualWorkspaceTab>('design');
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState<string | number>('320px');

  // Designer store
  const designerLoadWorkspace = useInvoiceDesignerStore((state) => state.loadWorkspace);
  const designerResetWorkspace = useInvoiceDesignerStore((state) => state.resetWorkspace);
  const designerExportWorkspace = useInvoiceDesignerStore((state) => state.exportWorkspace);
  const designerNodes = useInvoiceDesignerStore((state) => state.nodes);
  const designerSnapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);
  const designerGridSize = useInvoiceDesignerStore((state) => state.gridSize);
  const designerShowGuides = useInvoiceDesignerStore((state) => state.showGuides);
  const designerShowRulers = useInvoiceDesignerStore((state) => state.showRulers);
  const designerCanvasScale = useInvoiceDesignerStore((state) => state.canvasScale);
  const designerTransforms = useInvoiceDesignerStore((state) => state.transforms);
  const designerRootId = useInvoiceDesignerStore((state) => state.rootId);
  const [designerHydratedFor, setDesignerHydratedFor] = useState<string | null>(null);

  // Preview state
  const [previewState, dispatch] = useReducer(previewSessionReducer, undefined, createInitialPreviewSessionState);
  const [authoritativePreview, setAuthoritativePreview] = useState<
    Awaited<ReturnType<typeof runAuthoritativeQuoteTemplatePreview>> | null
  >(null);
  const [manualRunNonce, setManualRunNonce] = useState(0);
  const debouncedNodes = useDebouncedValue(designerNodes, 140);
  const previewRunSequence = useRef(0);

  const activeSampleId = previewState.selectedSampleId ?? DEFAULT_QUOTE_PREVIEW_SAMPLE_ID;
  const activeSample = useMemo(() => getQuotePreviewSampleScenarioById(activeSampleId), [activeSampleId]);
  const previewData = previewState.sourceKind === 'sample' ? activeSample?.data ?? null : null;

  const generatedCodeViewSource = useMemo(() => {
    try {
      return exportWorkspaceToTemplateAstJson(designerExportWorkspace());
    } catch {
      return null;
    }
  }, [
    designerExportWorkspace,
    designerCanvasScale,
    designerGridSize,
    designerNodes,
    designerShowGuides,
    designerShowRulers,
    designerSnapToGrid,
    designerTransforms,
  ]);

  const previewWorkspace = useMemo(
    () => ({
      rootId: designerRootId,
      nodesById: Object.fromEntries(
        debouncedNodes.map((node) => [
          node.id,
          { id: node.id, type: node.type, props: node.props, children: node.children },
        ])
      ),
      transforms: designerTransforms,
      snapToGrid: designerSnapToGrid,
      gridSize: designerGridSize,
      showGuides: designerShowGuides,
      showRulers: designerShowRulers,
      canvasScale: designerCanvasScale,
    }),
    [designerCanvasScale, debouncedNodes, designerGridSize, designerRootId, designerShowGuides, designerShowRulers, designerSnapToGrid, designerTransforms]
  );

  const previewTemplate = useMemo(() => {
    if (!previewData) {
      return null;
    }
    try {
      const templateAst = exportWorkspaceToTemplateAst(previewWorkspace as any);
      return {
        template_id: `quote-designer-preview-${previewWorkspace.rootId ?? 'root'}-${manualRunNonce}`,
        name: 'Quote Designer Preview',
        version: 1,
        isStandard: false,
        templateAst,
      };
    } catch {
      return null;
    }
  }, [manualRunNonce, previewData, previewWorkspace]);

  const hasRenderedPreviewOutput = hasRenderablePreviewOutput({
    previewData,
    renderStatus: authoritativePreview?.render.status ?? 'idle',
    html: authoritativePreview?.render.html ?? null,
  });

  const displayStatuses = derivePreviewPipelineDisplayStatuses({
    statuses: {
      shapeStatus: previewState.shapeStatus,
      renderStatus: previewState.renderStatus,
      verifyStatus: previewState.verifyStatus,
    },
    canDisplaySuccessStates: Boolean(previewData) && hasRenderedPreviewOutput,
  });

  const shapeDiagnostics = authoritativePreview?.compile.diagnostics ?? [];
  const authoritativeRenderOutput =
    authoritativePreview?.render.status === 'success' &&
    typeof authoritativePreview.render.html === 'string' &&
    typeof authoritativePreview.render.css === 'string'
      ? { html: authoritativePreview.render.html, css: authoritativePreview.render.css }
      : null;
  const isPreviewRunning =
    previewState.shapeStatus === 'running' ||
    previewState.renderStatus === 'running' ||
    previewState.verifyStatus === 'running';

  // Load template
  useEffect(() => {
    const loadTemplate = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (templateId) {
          const loadedResult = await getQuoteDocumentTemplate(templateId);
          if (loadedResult && typeof loadedResult === 'object' && 'permissionError' in loadedResult) {
            throw new Error(loadedResult.permissionError);
          }
          if (!loadedResult) {
            throw new Error(
              t('templateEditor.errors.notFound', {
                defaultValue: 'Quote document template not found.',
              }),
            );
          }
          setTemplate(loadedResult as IQuoteDocumentTemplate);
          return;
        }

        const initialAst = getStandardQuoteTemplateAstByCode(standardCode || 'standard-quote-default')
          ?? getStandardQuoteTemplateAstByCode('standard-quote-default')
          ?? { kind: 'invoice-template-ast', version: TEMPLATE_AST_VERSION, layout: { id: 'root', type: 'document', children: [] } };
        const standardName = standardCode
          ? standardCode.replace(/^standard-quote-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          : t('templateEditor.defaults.standardTemplate', { defaultValue: 'Standard Template' });
        setTemplate({
          name: standardCode
            ? t('templateEditor.defaults.copyOf', {
              defaultValue: 'Copy of {{name}}',
              name: standardName,
            })
            : '',
          version: 1,
          is_default: false,
          templateAst: initialAst,
        });
      } catch (loadError) {
        console.error('Error loading quote template editor:', loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : t('templateEditor.errors.load', {
              defaultValue: 'Failed to load quote template editor',
            }),
        );
      } finally {
        setIsLoading(false);
      }
    };

    void loadTemplate();
  }, [standardCode, t, templateId]);

  // Hydrate designer workspace from template AST
  useEffect(() => {
    if (!template) {
      return;
    }

    const hydrationKey = templateId ?? 'new';
    if (designerHydratedFor === hydrationKey) {
      return;
    }

    const templateAst = (template as Record<string, unknown>)?.templateAst;
    if (templateAst && typeof templateAst === 'object') {
      try {
        const importedWorkspace = importTemplateAstToWorkspace(templateAst as any);
        designerLoadWorkspace(importedWorkspace);
        setDesignerHydratedFor(hydrationKey);
        return;
      } catch {
        // fall through to reset
      }
    }

    designerResetWorkspace();
    setDesignerHydratedFor(hydrationKey);
  }, [designerHydratedFor, designerLoadWorkspace, designerResetWorkspace, template, templateId]);

  // Editor height calculation
  useEffect(() => {
    const calculateHeight = () => {
      if (editorContainerRef.current) {
        const rect = editorContainerRef.current.getBoundingClientRect();
        const calculatedHeight = window.innerHeight - rect.top - 100;
        setEditorHeight(Math.max(calculatedHeight, 200));
      }
    };
    calculateHeight();
    window.addEventListener('resize', calculateHeight);
    return () => window.removeEventListener('resize', calculateHeight);
  }, [isLoading]);

  // Preview pipeline
  useEffect(() => {
    if (visualWorkspaceTab !== 'preview' || editorTab !== 'visual') {
      return;
    }

    if (!previewData) {
      previewRunSequence.current += 1;
      dispatch({ type: 'pipeline-reset' });
      setAuthoritativePreview(null);
      return;
    }

    const requestId = ++previewRunSequence.current;
    dispatch({ type: 'pipeline-reset' });
    dispatch({ type: 'pipeline-phase-start', phase: 'shape' });
    dispatch({ type: 'pipeline-phase-start', phase: 'render' });
    dispatch({ type: 'pipeline-phase-start', phase: 'verify' });

    runAuthoritativeQuoteTemplatePreview({
      workspace: previewWorkspace as any,
      quoteData: previewData,
    })
      .then((result) => {
        if (requestId !== previewRunSequence.current) return;
        setAuthoritativePreview(result);
        dispatch({ type: result.compile.status === 'error' ? 'pipeline-phase-error' : 'pipeline-phase-success', phase: 'shape', ...(result.compile.status === 'error' ? { error: result.compile.error ?? t('templateEditor.pipeline.shapeFailed', { defaultValue: 'Shape failed.' }) } : {}) } as any);
        dispatch({ type: result.render.status === 'error' ? 'pipeline-phase-error' : 'pipeline-phase-success', phase: 'render', ...(result.render.status === 'error' ? { error: result.render.error ?? t('templateEditor.pipeline.renderFailed', { defaultValue: 'Render failed.' }) } : {}) } as any);
        dispatch({ type: 'pipeline-phase-success', phase: 'verify' });
      })
      .catch((catchError) => {
        if (requestId !== previewRunSequence.current) return;
        const message = catchError instanceof Error ? catchError.message : t('templateEditor.errors.previewPipeline', { defaultValue: 'Preview pipeline failed.' });
        setAuthoritativePreview(null);
        dispatch({ type: 'pipeline-phase-error', phase: 'shape', error: message });
      });
  }, [editorTab, manualRunNonce, previewData, previewWorkspace, t, visualWorkspaceTab]);

  const handleSave = async () => {
    if (!template) return;

    if (!template.name || template.name.trim() === '') {
      setError(
        t('templateEditor.errors.nameRequired', {
          defaultValue: 'Template name is required.',
        }),
      );
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const workspace = designerExportWorkspace();
      let ast;
      try {
        ast = exportWorkspaceToTemplateAst(workspace);
      } catch (compilerError) {
        const message = compilerError instanceof Error ? compilerError.message : t('templateEditor.errors.unknownAstExport', { defaultValue: 'Unknown AST export error' });
        setError(
          t('templateEditor.errors.exportAst', {
            defaultValue: 'Failed to export template AST from visual workspace: {{message}}',
            message,
          }),
        );
        return;
      }

      const result = await saveQuoteDocumentTemplate({
        ...template,
        template_id: template.template_id,
        templateAst: ast as any,
      });

      if (result && typeof result === 'object' && 'permissionError' in result) {
        throw new Error(result.permissionError);
      }

      const saveResult = result as { success: boolean; template?: IQuoteDocumentTemplate; error?: string };
      if (!saveResult.success || !saveResult.template) {
        throw new Error(
          saveResult.error
            || t('templateEditor.errors.saveFailed', {
              defaultValue: 'Failed to save quote template',
            }),
        );
      }

      setTemplate(saveResult.template);
      router.push(`/msp/billing?tab=quote-templates&templateId=${saveResult.template.template_id}`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t('templateEditor.errors.saveFailed', {
            defaultValue: 'Failed to save quote template',
          }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {isNewTemplate
              ? t('templateEditor.headings.newLayout', { defaultValue: 'New Quote Layout' })
              : t('templateEditor.headings.editLayout', { defaultValue: 'Edit Quote Layout' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('templateEditor.description', {
              defaultValue: 'Design the quote layout using the visual editor, then preview with sample data.',
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button id="quote-template-editor-back" variant="outline" onClick={() => handleBack()}>
            {t('templateEditor.actions.backToLayouts', { defaultValue: 'Back to Layouts' })}
          </Button>
          <Button id="quote-template-editor-save" onClick={() => void handleSave()} disabled={isSaving || isLoading}>
            {isSaving
              ? t('common.states.saving', { defaultValue: 'Saving...' })
              : t('templateEditor.actions.saveLayout', { defaultValue: 'Save Layout' })}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('templateEditor.title', { defaultValue: 'Quote Layout Editor' })}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('templateEditor.fields.layoutDetails', { defaultValue: 'Layout Details' })}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            {t('templateEditor.fields.templateName', { defaultValue: 'Template Name' })}
            <Input
              value={template?.name || ''}
              onChange={(event) => setTemplate((current) => ({ ...(current ?? {}), name: event.target.value }))}
              placeholder={t('templateEditor.placeholders.templateName', { defaultValue: 'Quote Template' })}
              disabled={isLoading}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            {t('templateEditor.fields.version', { defaultValue: 'Version' })}
            <Input
              type="number"
              min="1"
              step="1"
              value={String(template?.version || 1)}
              onChange={(event) => setTemplate((current) => ({ ...(current ?? {}), version: Math.max(1, Number(event.target.value) || 1) }))}
              disabled={isLoading}
            />
          </label>
        </CardContent>
      </Card>

      <Tabs value={editorTab} onValueChange={(value) => setEditorTab(value as EditorTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="visual" data-automation-id="quote-template-editor-visual-tab">{t('templateEditor.tabs.visual', { defaultValue: 'Visual' })}</TabsTrigger>
          <TabsTrigger value="code" data-automation-id="quote-template-editor-code-tab">{t('templateEditor.tabs.code', { defaultValue: 'Code' })}</TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className="pt-4 space-y-3">
          <div className="border rounded overflow-hidden bg-card" id="quote-template-visual-designer">
            <Tabs
              value={visualWorkspaceTab}
              onValueChange={(value) => setVisualWorkspaceTab(value as VisualWorkspaceTab)}
              data-automation-id="quote-designer-visual-workspace-tabs"
            >
              <TabsList>
                <TabsTrigger value="design" data-automation-id="quote-designer-design-tab">{t('templateEditor.tabs.design', { defaultValue: 'Design' })}</TabsTrigger>
                <TabsTrigger value="transforms" data-automation-id="quote-designer-transforms-tab">{t('templateEditor.tabs.transforms', { defaultValue: 'Transforms' })}</TabsTrigger>
                <TabsTrigger value="preview" data-automation-id="quote-designer-preview-tab">{t('templateEditor.tabs.preview', { defaultValue: 'Preview' })}</TabsTrigger>
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
                  onExistingInvoiceChange={() => {}}
                  onClearExistingInvoice={() => {}}
                  loadExistingInvoiceOptions={async () => ({ options: [], total: 0 })}
                />
              </TabsContent>

              <TabsContent value="preview" className="pt-3 space-y-3">
                <div className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-card))] px-4 py-3 space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="quote-preview-sample-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t('templateEditor.preview.sampleScenario', { defaultValue: 'Sample Scenario' })}
                    </label>
                    <div className="w-fit">
                      <CustomSelect
                        id="quote-designer-preview-sample-select"
                        options={QUOTE_PREVIEW_SAMPLE_SCENARIOS.map((scenario) => ({
                          value: scenario.id,
                          label: scenario.label,
                        }))}
                        value={activeSample?.id ?? ''}
                        onValueChange={(value: string) => dispatch({ type: 'set-sample', sampleId: value })}
                        placeholder={t('templateEditor.preview.selectScenario', { defaultValue: 'Select scenario...' })}
                      />
                    </div>
                    {activeSample && (
                      <p className="text-xs text-slate-500" data-automation-id="quote-designer-preview-sample-description">
                        {activeSample.description}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2"
                  data-automation-id="quote-designer-preview-pipeline-status"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <span className="font-semibold">{t('templateEditor.pipeline.shape', { defaultValue: 'Shape' })}</span>
                      <span className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] px-2 py-0.5 uppercase">
                        {displayStatuses.shapeStatus}
                      </span>
                      <span className="font-semibold">{t('templateEditor.pipeline.render', { defaultValue: 'Render' })}</span>
                      <span className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] px-2 py-0.5 uppercase">
                        {displayStatuses.renderStatus}
                      </span>
                    </div>
                    <Button
                      id="quote-designer-preview-rerun-button"
                      variant="outline"
                      size="sm"
                      disabled={!previewData || isPreviewRunning}
                      onClick={() => setManualRunNonce((value) => value + 1)}
                    >
                      {t('templateEditor.actions.rerun', { defaultValue: 'Re-run' })}
                    </Button>
                  </div>

                  {authoritativePreview?.compile.status === 'error' && (
                    <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive space-y-1">
                      <p>{authoritativePreview.compile.error ?? t('templateEditor.pipeline.shapingFailed', { defaultValue: 'Shaping failed.' })}</p>
                      {authoritativePreview.compile.details && (
                        <p className="text-[11px] text-destructive">{authoritativePreview.compile.details}</p>
                      )}
                    </div>
                  )}

                  {shapeDiagnostics.length > 0 && (
                    <ul className="space-y-1 text-xs">
                      {shapeDiagnostics.map((diagnostic, index) => (
                        <li
                          key={`${diagnostic.raw}-${index}`}
                          className="rounded border border-warning/30 bg-warning/10 px-2 py-1 text-warning"
                        >
                          <span className="font-semibold uppercase">{diagnostic.severity}</span>{' '}
                          <span>{diagnostic.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border dark:border-[rgb(var(--color-border-200))] rounded overflow-hidden bg-white dark:bg-[rgb(var(--color-card))] min-h-[320px]">
                  {!previewData && (
                    <div className="p-4 text-sm text-slate-500">
                      {t('templateEditor.preview.selectScenarioPrompt', {
                        defaultValue: 'Select a sample scenario to generate an authoritative preview.',
                      })}
                    </div>
                  )}

                  {previewData && isPreviewRunning && (
                    <div className="p-4 text-sm text-slate-500">
                      {t('templateEditor.preview.rendering', { defaultValue: 'Shaping and rendering preview...' })}
                    </div>
                  )}

                  {previewData && !previewTemplate && (
                    <Alert variant="destructive" className="rounded-none border-x-0 border-b-0">
                      <AlertDescription className="text-sm">
                        {t('templateEditor.preview.templateGenerationFailed', {
                          defaultValue: 'Preview template could not be generated from the current workspace.',
                        })}
                      </AlertDescription>
                    </Alert>
                  )}

                  {previewData && previewTemplate && authoritativePreview?.render.status === 'error' && (
                    <Alert variant="destructive" className="rounded-none border-x-0 border-b-0">
                      <AlertDescription className="text-sm">
                        {authoritativePreview.render.error ?? t('templateEditor.preview.renderFailed', { defaultValue: 'Preview rendering failed.' })}
                      </AlertDescription>
                    </Alert>
                  )}

                  {previewData && previewTemplate && authoritativeRenderOutput && (
                    <div className="p-2">
                      <PaperInvoice templateAst={previewTemplate.templateAst ?? null}>
                        <TemplateRenderer
                          template={previewTemplate as any}
                          invoiceData={previewData as any}
                          renderOverride={authoritativeRenderOutput}
                        />
                      </PaperInvoice>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </TabsContent>

        <TabsContent value="code" className="pt-4">
          <Alert variant="info" className="mb-3">
            <AlertDescription>
              {t('templateEditor.codeReadonly', {
                defaultValue: 'Code view is generated from the Visual workspace and is read-only.',
              })}
            </AlertDescription>
          </Alert>
          <div ref={editorContainerRef} className="mt-1 border rounded-md overflow-hidden">
            <Editor
              height={editorHeight}
              defaultLanguage="json"
              value={generatedCodeViewSource ?? ''}
              onChange={() => {}}
              options={{
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontSize: 14,
                readOnly: true,
              }}
              theme="vs-dark"
            />
          </div>
        </TabsContent>
      </Tabs>

      <CardFooter className="flex justify-between items-center gap-2 px-0">
        <div className="text-sm text-muted-foreground">
          {template?.created_at && (
            <p>{t('templateEditor.footer.created', { defaultValue: 'Created:' })} {formatDate(template.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          )}
          {template?.updated_at && (
            <p>{t('templateEditor.footer.lastUpdated', { defaultValue: 'Last Updated:' })} {formatDate(template.updated_at, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          )}
        </div>
      </CardFooter>
    </div>
  );
};

export default QuoteDocumentTemplateEditor;
