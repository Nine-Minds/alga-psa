'use client';

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { TemplateAst } from '@alga-psa/types';
import {
  runAuthoritativeTemplatePreview,
  saveDocumentTemplate,
} from '../../../actions/documentTemplateActions';
import {
  getDocumentTypeRegistryEntry,
  isDocumentType,
} from '../../../lib/document-templates/registry';
import { DesignerShell } from '../../invoice-designer/DesignerShell';
import TransformsWorkspace from '../../invoice-designer/transforms/TransformsWorkspace';
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

/**
 * The shape the management page hands the editor. Mirrors the quote editor's working template, but
 * generic over document type — a row from the generic template list, a standard seeded as a new copy,
 * or a blank starting from the type's default standard AST.
 */
export interface DocumentTemplateDraft {
  /** Present only for an existing custom template (update in place); absent for new / seeded copies. */
  template_id?: string;
  name?: string;
  version?: number;
  templateAst?: TemplateAst;
  source?: 'standard' | 'custom';
  /** Save as a brand-new custom row even if seeded from an existing template (standard or clone). */
  isClone?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface DocumentTemplateEditorProps {
  documentType: string;
  template: DocumentTemplateDraft;
  /** Called with the saved custom template id once a save succeeds. */
  onSave: (savedTemplateId: string) => void;
  onCancel: () => void;
}

type EditorTab = 'visual' | 'code';
type VisualWorkspaceTab = 'design' | 'transforms' | 'preview';

const isDocumentTemplateActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const useDebouncedValue = <T,>(value: T, delayMs: number) => {
  const [debounced, setDebounced] = React.useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

const DocumentTemplateEditor: React.FC<DocumentTemplateEditorProps> = ({
  documentType,
  template: initialTemplate,
  onSave,
  onCancel,
}) => {
  const { formatDate } = useFormatters();
  const typeLabel = useMemo(
    () => (isDocumentType(documentType) ? getDocumentTypeRegistryEntry(documentType).label : 'Document'),
    [documentType],
  );

  const [template, setTemplate] = useState<DocumentTemplateDraft>(initialTemplate);
  const isNewTemplate = !initialTemplate.template_id;
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
  const [designerHydrated, setDesignerHydrated] = useState(false);

  // Transforms workspace shares the quote editor's preview-session reducer for its source/sample
  // controls. The generic preview itself is driven by the server action, not these scenarios.
  const [previewState, dispatch] = useReducer(previewSessionReducer, undefined, createInitialPreviewSessionState);

  // Generic authoritative preview ({ html }, rendered server-side against the type's sample model).
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const debouncedNodes = useDebouncedValue(designerNodes, 200);

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

  // Hydrate designer workspace from the draft AST (once).
  useEffect(() => {
    if (designerHydrated) {
      return;
    }
    const templateAst = initialTemplate.templateAst;
    if (templateAst && typeof templateAst === 'object') {
      try {
        designerLoadWorkspace(importTemplateAstToWorkspace(templateAst));
        setDesignerHydrated(true);
        return;
      } catch {
        // fall through to reset
      }
    }
    designerResetWorkspace();
    setDesignerHydrated(true);
  }, [designerHydrated, designerLoadWorkspace, designerResetWorkspace, initialTemplate.templateAst]);

  // Code editor height calculation
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
  }, []);

  // Authoritative preview pipeline — export the workspace and render it server-side.
  useEffect(() => {
    if (!designerHydrated || editorTab !== 'visual' || visualWorkspaceTab !== 'preview') {
      return;
    }

    let cancelled = false;
    const run = async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const ast = exportWorkspaceToTemplateAst(designerExportWorkspace());
        const result = await runAuthoritativeTemplatePreview(documentType, ast);
        if (cancelled) return;
        if (isDocumentTemplateActionError(result)) {
          setPreviewHtml(null);
          setPreviewError(getErrorMessage(result));
          return;
        }
        setPreviewHtml(result.html);
      } catch (err) {
        if (cancelled) return;
        setPreviewHtml(null);
        setPreviewError(err instanceof Error ? err.message : 'Failed to generate preview.');
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    designerHydrated,
    designerExportWorkspace,
    documentType,
    editorTab,
    visualWorkspaceTab,
    previewNonce,
    debouncedNodes,
  ]);

  const handleSave = async () => {
    const trimmedName = (template.name ?? '').trim();
    if (!trimmedName) {
      setError('Template name is required.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      let ast: TemplateAst;
      try {
        ast = exportWorkspaceToTemplateAst(designerExportWorkspace());
      } catch (compileErr) {
        const message = compileErr instanceof Error ? compileErr.message : 'Unknown AST export error';
        setError(`Failed to export template from the visual workspace: ${message}`);
        return;
      }

      const result = await saveDocumentTemplate(documentType, {
        template_id: template.template_id,
        name: trimmedName,
        version: template.version ?? 1,
        templateAst: ast,
        isClone: template.isClone,
      });

      if (isDocumentTemplateActionError(result)) {
        const message = getErrorMessage(result);
        setError(message);
        toast.error(message);
        return;
      }

      if (!result.success) {
        throw new Error(result.error ?? `Failed to save ${typeLabel} layout`);
      }

      toast.success(`${typeLabel} layout saved`);
      onSave(result.template_id);
    } catch (saveErr) {
      const message = saveErr instanceof Error ? saveErr.message : `Failed to save ${typeLabel} layout`;
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {isNewTemplate ? `New ${typeLabel} Layout` : `Edit ${typeLabel} Layout`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Design the {typeLabel.toLowerCase()} layout using the visual editor, then preview with sample data.
          </p>
        </div>
        <div className="flex gap-2">
          <Button id="document-template-editor-back" variant="outline" onClick={onCancel}>
            Back to Layouts
          </Button>
          <Button id="document-template-editor-save" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Layout'}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{typeLabel} Layout Editor</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Layout Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            Template Name
            <Input
              value={template.name || ''}
              onChange={(event) => setTemplate((current) => ({ ...current, name: event.target.value }))}
              placeholder={`${typeLabel} Template`}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            Version
            <Input
              type="number"
              min="1"
              step="1"
              value={String(template.version || 1)}
              onChange={(event) =>
                setTemplate((current) => ({ ...current, version: Math.max(1, Number(event.target.value) || 1) }))
              }
            />
          </label>
        </CardContent>
      </Card>

      <Tabs value={editorTab} onValueChange={(value) => setEditorTab(value as EditorTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="visual" data-automation-id="document-template-editor-visual-tab">Visual</TabsTrigger>
          <TabsTrigger value="code" data-automation-id="document-template-editor-code-tab">Code</TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className="pt-4 space-y-3">
          <div className="border rounded overflow-hidden bg-card" id="document-template-visual-designer">
            <Tabs
              value={visualWorkspaceTab}
              onValueChange={(value) => setVisualWorkspaceTab(value as VisualWorkspaceTab)}
              data-automation-id="document-designer-visual-workspace-tabs"
            >
              <TabsList>
                <TabsTrigger value="design" data-automation-id="document-designer-design-tab">Design</TabsTrigger>
                <TabsTrigger value="transforms" data-automation-id="document-designer-transforms-tab">Transforms</TabsTrigger>
                <TabsTrigger value="preview" data-automation-id="document-designer-preview-tab">Preview</TabsTrigger>
              </TabsList>

              <TabsContent value="design" className="pt-3">
                <DesignerShell />
              </TabsContent>

              <TabsContent value="transforms" className="pt-3">
                <TransformsWorkspace
                  previewState={previewState}
                  previewData={null}
                  activeSample={null}
                  onSourceKindChange={(source) => dispatch({ type: 'set-source', source })}
                  onSampleChange={(sampleId) => dispatch({ type: 'set-sample', sampleId })}
                  onExistingInvoiceChange={() => {}}
                  onClearExistingInvoice={() => {}}
                  loadExistingInvoiceOptions={async () => ({ options: [], total: 0 })}
                />
              </TabsContent>

              <TabsContent value="preview" className="pt-3 space-y-3">
                <div
                  className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2"
                  data-automation-id="document-designer-preview-status"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Rendered against representative {typeLabel.toLowerCase()} sample data.
                    </p>
                    <Button
                      id="document-designer-preview-rerun-button"
                      variant="outline"
                      size="sm"
                      disabled={previewLoading}
                      onClick={() => setPreviewNonce((value) => value + 1)}
                    >
                      Re-run
                    </Button>
                  </div>
                </div>

                {previewError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">{previewError}</AlertDescription>
                  </Alert>
                )}

                <div className="border dark:border-[rgb(var(--color-border-200))] rounded overflow-hidden bg-white dark:bg-[rgb(var(--color-card))] min-h-[480px]">
                  {previewLoading && (
                    <div className="p-4 text-sm text-slate-500">Shaping and rendering preview...</div>
                  )}

                  {!previewLoading && !previewError && previewHtml && (
                    <iframe
                      title={`${typeLabel} preview`}
                      srcDoc={previewHtml}
                      className="w-full min-h-[640px] border-0 bg-white"
                      data-automation-id="document-designer-preview-frame"
                    />
                  )}

                  {!previewLoading && !previewError && !previewHtml && (
                    <div className="p-4 text-sm text-slate-500">
                      Open this tab to generate an authoritative preview.
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
              Code view is generated from the Visual workspace and is read-only.
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
          {template.created_at && (
            <p>Created: {formatDate(template.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          )}
          {template.updated_at && (
            <p>Last Updated: {formatDate(template.updated_at, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          )}
        </div>
      </CardFooter>
    </div>
  );
};

export default DocumentTemplateEditor;
