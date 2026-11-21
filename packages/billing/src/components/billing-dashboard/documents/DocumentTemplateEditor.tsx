'use client';

import { documentTypeLabel } from './documentTypeLabel';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader } from '@alga-psa/ui/components/Card';
import { Popover, PopoverContent, PopoverTrigger } from '@alga-psa/ui/components/Popover';
import { DesignerFocusSurface, DesignerFocusToggle } from '@alga-psa/ui/components/designer';
import { useDesignerFocusPreference } from '@alga-psa/user-composition/hooks/useDesignerFocusPreference';
import { Input } from '@alga-psa/ui/components/Input';
import { AsyncSearchableSelect } from '@alga-psa/ui/components/AsyncSearchableSelect';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { LOCALE_CONFIG, normalizeLocale, type SupportedLocale } from '@alga-psa/core/i18n/config';
import { PreviewLocaleSelect } from '../../invoice-designer/preview/PreviewLocaleSelect';
import { PreviewSheetFrame } from '../../invoice-designer/preview/PreviewSheetFrame';
import type { PreviewZoomMode } from '../../invoice-designer/preview/previewSheetScale';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  LABEL_CLASSES,
  LABEL_HIDEABLE_FIELDS,
  isLabelClass,
  type LabelClass,
  type LabelHideableField,
  type TemplateAst,
} from '@alga-psa/types';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  listExistingDocumentsForPreview,
  runAuthoritativeTemplatePreview,
  saveDocumentTemplate,
} from '../../../actions/documentTemplateActions';
import { DesignerShell } from '../../invoice-designer/DesignerShell';
import { DESIGNER_AREA_MIN_HEIGHT, useFitToAvailableHeight } from '../../invoice-designer/useFitToAvailableHeight';
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
  type PreviewSourceKind,
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

export const LABEL_CLASS_DEFAULT_LABELS: Record<LabelClass, string> = {
  'ticket-work-tag': 'Ticket work tag',
  'asset-identity': 'Asset label',
  'stock-unit-identity': 'Stock unit label',
  'staging-container': 'Staging box label',
  'rma-work-tag': 'RMA tag',
};

const LABEL_FIELD_DEFAULT_LABELS: Record<LabelHideableField, string> = {
  clientName: 'Client name',
  title: 'Title',
  detail: 'Detail / reason',
  secondaryIdentifier: 'Secondary identifier',
  serialSuffix: 'Serial suffix',
  custodyLocation: 'Custody location',
  nextAction: 'Next action',
  tenantLogo: 'Company logo',
  tenantName: 'Company name',
};
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

const buildPreviewSourceOptions = (
  t: (key: string, options?: Record<string, unknown>) => string,
): { value: PreviewSourceKind; label: string }[] => [
  { value: 'sample', label: t('designer.workspace.preview.source.sample', { defaultValue: 'Sample' }) },
  { value: 'existing', label: t('designer.workspace.preview.source.existing', { defaultValue: 'Existing' }) },
];

const DocumentTemplateEditor: React.FC<DocumentTemplateEditorProps> = ({
  documentType,
  template: initialTemplate,
  onSave,
  onCancel,
}) => {
  const { t, i18n } = useTranslation('msp/invoicing');
  const { formatDate } = useFormatters();
  // One preference for every document type: the author's choice is about the editor.
  const focus = useDesignerFocusPreference('document_layout');
  const fillHeight = focus.isFocused ? 'flex min-h-0 flex-1 flex-col' : '';
  const typeLabel = useMemo(() => documentTypeLabel(documentType, t), [documentType, t]);

  const [template, setTemplate] = useState<DocumentTemplateDraft>(initialTemplate);
  const isNewTemplate = !initialTemplate.template_id;
  const isLabelTemplate = documentType === 'work-tag';
  // Label templates: which class they print and which optional fields they show. The visual
  // workspace does not round-trip these metadata keys, so they live here and are merged on export.
  const [labelClass, setLabelClass] = useState<LabelClass>(() => {
    const value = initialTemplate.templateAst?.metadata?.labelClass;
    return isLabelClass(value) ? value : 'ticket-work-tag';
  });
  const [hiddenFields, setHiddenFields] = useState<LabelHideableField[]>(
    () => initialTemplate.templateAst?.metadata?.labelSettings?.hiddenFields ?? [],
  );
  const withLabelMetadata = (ast: TemplateAst): TemplateAst =>
    !isLabelTemplate
      ? ast
      : {
          ...ast,
          metadata: {
            ...(ast.metadata ?? {}),
            labelClass,
            labelSettings: { hiddenFields },
          },
        };
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Label-only settings do not fit a header row, so they live behind one button.
  const [isLabelSettingsOpen, setIsLabelSettingsOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>('visual');
  const [visualWorkspaceTab, setVisualWorkspaceTab] = useState<VisualWorkspaceTab>('design');
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState<string | number>('320px');
  const designerAreaRef = useRef<HTMLDivElement>(null);
  // In the normal layout the Design view takes the room left under the header instead of
  // guessing at the page chrome, so it ends where the page ends and nothing scrolls.
  const designerAreaHeight = useFitToAvailableHeight(designerAreaRef, {
    enabled: !focus.isFocused && editorTab === 'visual' && visualWorkspaceTab === 'design',
    minHeight: DESIGNER_AREA_MIN_HEIGHT,
  });
  const designerFill = focus.isFocused || designerAreaHeight !== null ? 'flex min-h-0 flex-1 flex-col' : '';

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
  // controls. The generic preview itself is driven by the server action, not these scenarios — the
  // session only tracks which source (sample vs an existing document) the author is previewing.
  const [previewState, dispatch] = useReducer(previewSessionReducer, undefined, createInitialPreviewSessionState);

  // Generic authoritative preview ({ html }, rendered server-side against the type's sample model).
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  // The preview is drawn on the printed page's sheet; 'fit' enlarges a label to fill the pane.
  const [previewZoomMode, setPreviewZoomMode] = useState<PreviewZoomMode>('fit');
  const [previewScale, setPreviewScale] = useState<number | null>(null);
  // Standard templates carry translatable labels, so an author can see the
  // document in the language each client will actually receive it in.
  const [previewLocale, setPreviewLocale] = useState<SupportedLocale>(
    () => normalizeLocale(i18n.language) ?? (LOCALE_CONFIG.defaultLocale as SupportedLocale),
  );
  const debouncedNodes = useDebouncedValue(designerNodes, 200);

  const existingDocumentId = previewState.sourceKind === 'existing' ? previewState.selectedInvoiceId : null;
  const isAwaitingExistingSelection = previewState.sourceKind === 'existing' && !existingDocumentId;

  const loadExistingDocumentOptions = async ({
    search,
    page,
    limit,
  }: {
    search: string;
    page: number;
    limit: number;
  }) => {
    const result = await listExistingDocumentsForPreview(documentType, { search, page, pageSize: limit });
    if (isDocumentTemplateActionError(result)) {
      throw new Error(getErrorMessage(result));
    }
    return result;
  };

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
  }, [focus.isFocused]);

  // Authoritative preview pipeline — export the workspace and render it server-side.
  useEffect(() => {
    if (!designerHydrated || editorTab !== 'visual' || visualWorkspaceTab !== 'preview') {
      return;
    }

    // Nothing to render until the author picks the existing document to preview against.
    if (isAwaitingExistingSelection) {
      setPreviewHtml(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const ast = withLabelMetadata(exportWorkspaceToTemplateAst(designerExportWorkspace()));
        const result = await runAuthoritativeTemplatePreview(documentType, ast, previewLocale, existingDocumentId);
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
        setPreviewError(err instanceof Error
          ? err.message
          : t('documentTemplates.editor.errors.previewFailed', { defaultValue: 'Failed to generate preview.' }));
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
    existingDocumentId,
    isAwaitingExistingSelection,
    visualWorkspaceTab,
    previewNonce,
    previewLocale,
    debouncedNodes,
    t,
  ]);

  const handleSave = async () => {
    const trimmedName = (template.name ?? '').trim();
    if (!trimmedName) {
      setError(t('documentTemplates.editor.errors.nameRequired', { defaultValue: 'Template name is required.' }));
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      let ast: TemplateAst;
      try {
        ast = withLabelMetadata(exportWorkspaceToTemplateAst(designerExportWorkspace()));
      } catch (compileErr) {
        const message = compileErr instanceof Error
          ? compileErr.message
          : t('templateEditor.errors.unknownAstExport', { defaultValue: 'Unknown AST export error' });
        setError(t('documentTemplates.editor.errors.astExportFailed', {
          defaultValue: 'Failed to export template from the visual workspace: {{message}}',
          message,
        }));
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
        // Rethrown message is surfaced to the user by the catch below, so it is translated.
        throw new Error(result.error ?? t('documentTemplates.editor.errors.saveFailed', {
          defaultValue: 'Failed to save {{type}} layout',
          type: typeLabel,
        }));
      }

      toast.success(t('documentTemplates.editor.toasts.saved', {
        defaultValue: '{{type}} layout saved',
        type: typeLabel,
      }));
      onSave(result.template_id);
    } catch (saveErr) {
      const message = saveErr instanceof Error
        ? saveErr.message
        : t('documentTemplates.editor.errors.saveFailed', {
          defaultValue: 'Failed to save {{type}} layout',
          type: typeLabel,
        });
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  // One compact header row (back, title, name, version, label settings, saved status, actions),
  // the same arrangement as the invoice and quote layout editors: the rest of the window belongs
  // to the designer, so the page never scrolls while editing.
  return (
    <DesignerFocusSurface
      id="document-template-editor-surface"
      focused={focus.isFocused}
      onFocusedChange={focus.setFocused}
      // The page margin the type's list view also uses; focus mode takes the window instead.
      className="p-6"
    >
    <Card
      id="document-template-editor-page"
      className={fillHeight ? `${fillHeight} rounded-none border-0` : undefined}
      style={focus.isFocused ? { boxShadow: 'none' } : undefined}
    >
      <CardHeader className="pb-3 shrink-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button id="document-template-editor-back" variant="soft" onClick={onCancel}>
            {t('documentTemplates.editor.actions.back', {
              defaultValue: 'Back to {{type}} Layouts',
              type: typeLabel,
            })}
          </Button>
          <h2 className="min-w-0 max-w-[20rem] truncate text-lg font-semibold">
            {isNewTemplate
              ? t('documentTemplates.editor.titles.create', { defaultValue: 'New {{type}} Layout', type: typeLabel })
              : t('documentTemplates.editor.titles.edit', {
                defaultValue: 'Edit Layout: {{name}}',
                name: template.name || typeLabel,
              })}
          </h2>
          <div className="flex min-w-[260px] flex-1 items-center gap-2">
            <label
              htmlFor="document-template-name-input"
              className="whitespace-nowrap text-sm font-medium text-[rgb(var(--color-text-700))]"
            >
              {t('templateEditor.fields.templateName', { defaultValue: 'Template Name' })}
            </label>
            <Input
              id="document-template-name-input"
              value={template.name || ''}
              onChange={(event) => setTemplate((current) => ({ ...current, name: event.target.value }))}
              placeholder={t('documentTemplates.editor.placeholders.templateName', {
                defaultValue: '{{type}} Template',
                type: typeLabel,
              })}
              containerClassName="flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="document-template-version-input"
              className="whitespace-nowrap text-sm font-medium text-[rgb(var(--color-text-700))]"
            >
              {t('documentTemplates.editor.fields.version', { defaultValue: 'Version' })}
            </label>
            <Input
              id="document-template-version-input"
              type="number"
              min="1"
              step="1"
              value={String(template.version || 1)}
              onChange={(event) =>
                setTemplate((current) => ({ ...current, version: Math.max(1, Number(event.target.value) || 1) }))
              }
              containerClassName="w-20"
            />
          </div>
          {isLabelTemplate ? (
            <Popover open={isLabelSettingsOpen} onOpenChange={setIsLabelSettingsOpen}>
              <PopoverTrigger asChild>
                <Button id="document-template-label-settings" variant="outline">
                  {t('documentTemplates.editor.actions.labelSettings', { defaultValue: 'Label settings' })}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                // Above the label class dropdown's own layer, and deaf to the clicks that
                // dropdown portals outside this popover: picking a class is not "outside".
                className="z-[10001] w-80 space-y-3"
                onInteractOutside={(event) => {
                  const target = event.target as HTMLElement | null;
                  if (target?.closest('[data-radix-popper-content-wrapper]')) {
                    event.preventDefault();
                  }
                }}
              >
                <div className="flex flex-col gap-2 text-sm font-medium text-foreground">
                  {t('documentTemplates.editor.fields.labelClass', { defaultValue: 'Label class' })}
                  <CustomSelect
                    id="document-template-label-class-select"
                    value={labelClass}
                    onValueChange={(value) => isLabelClass(value) && setLabelClass(value)}
                    options={LABEL_CLASSES.map((value) => ({
                      value,
                      label: t(`documentTemplates.labelClasses.${value}`, { defaultValue: LABEL_CLASS_DEFAULT_LABELS[value] }),
                    }))}
                  />
                </div>
                <fieldset className="flex flex-col gap-2 text-sm">
                  <legend className="font-medium text-foreground">
                    {t('documentTemplates.editor.fields.labelFields', { defaultValue: 'Fields shown on the label' })}
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    {t('documentTemplates.editor.fields.labelFieldsHint', {
                      defaultValue: 'The record link (QR code) and the identifier are always shown.',
                    })}
                  </p>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {LABEL_HIDEABLE_FIELDS.map((field) => (
                      <label key={field} className="flex items-center gap-2">
                        <input
                          id={`document-template-label-field-${field}`}
                          type="checkbox"
                          checked={!hiddenFields.includes(field)}
                          onChange={(event) =>
                            setHiddenFields((current) =>
                              event.target.checked ? current.filter((f) => f !== field) : [...current, field],
                            )
                          }
                        />
                        {t(`documentTemplates.labelFields.${field}`, { defaultValue: LABEL_FIELD_DEFAULT_LABELS[field] })}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </PopoverContent>
            </Popover>
          ) : null}
          <div className="flex items-center gap-2">
            <span
              id="document-template-save-status"
              className="text-xs text-muted-foreground"
              aria-live="polite"
              title={template.created_at
                ? t('documentTemplates.editor.fields.created', {
                  defaultValue: 'Created {{time}}',
                  time: formatDate(template.created_at, { dateStyle: 'medium', timeStyle: 'short' }),
                })
                : undefined}
            >
              {template.updated_at
                ? t('documentTemplates.editor.fields.savedAt', {
                  defaultValue: 'Saved {{time}}',
                  time: formatDate(template.updated_at, { dateStyle: 'medium', timeStyle: 'short' }),
                })
                : t('documentTemplates.editor.fields.notSaved', { defaultValue: 'Not saved yet' })}
            </span>
            <DesignerFocusToggle id="document-template-editor-focus-toggle" />
            <Button id="document-template-editor-close" variant="outline" onClick={onCancel}>
              {t('templateEditor.actions.close', { defaultValue: 'Close' })}
            </Button>
            <Button id="document-template-editor-save" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving
                ? t('templateEditor.actions.saving', { defaultValue: 'Saving...' })
                : t('documentTemplates.editor.actions.save', { defaultValue: 'Save Layout' })}
            </Button>
          </div>
        </div>
        {error ? (
          <Alert variant="destructive" className="mt-2" id="document-template-editor-error-alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardHeader>
      <CardContent className={`pt-0 ${fillHeight}`.trim()}>
      <Tabs
        value={editorTab}
        onValueChange={(value) => setEditorTab(value as EditorTab)}
        className={`space-y-4 ${fillHeight}`.trim()}
      >
        <TabsList>
          <TabsTrigger
            id="document-template-editor-visual-tab"
            value="visual"
            data-automation-id="document-template-editor-visual-tab"
          >
            {t('templateEditor.tabs.visual', { defaultValue: 'Visual' })}
          </TabsTrigger>
          <TabsTrigger
            id="document-template-editor-code-tab"
            value="code"
            data-automation-id="document-template-editor-code-tab"
          >
            {t('templateEditor.tabs.code', { defaultValue: 'Code' })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className={`pt-4 space-y-3 ${fillHeight}`.trim()}>
          <div
            ref={designerAreaRef}
            className={`border rounded overflow-hidden bg-card ${designerFill}`.trim()}
            style={designerAreaHeight === null ? undefined : { height: designerAreaHeight }}
            id="document-template-visual-designer"
          >
            <Tabs
              value={visualWorkspaceTab}
              onValueChange={(value) => setVisualWorkspaceTab(value as VisualWorkspaceTab)}
              data-automation-id="document-designer-visual-workspace-tabs"
              className={designerFill || undefined}
            >
              <TabsList>
                <TabsTrigger
                  id="document-designer-design-tab"
                  value="design"
                  data-automation-id="document-designer-design-tab"
                >
                  {t('designer.workspace.tabs.design', { defaultValue: 'Design' })}
                </TabsTrigger>
                <TabsTrigger
                  id="document-designer-transforms-tab"
                  value="transforms"
                  data-automation-id="document-designer-transforms-tab"
                >
                  {t('designer.workspace.tabs.transforms', { defaultValue: 'Transforms' })}
                </TabsTrigger>
                <TabsTrigger
                  id="document-designer-preview-tab"
                  value="preview"
                  data-automation-id="document-designer-preview-tab"
                >
                  {t('designer.workspace.tabs.preview', { defaultValue: 'Preview' })}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="design" className={`pt-3 ${designerFill}`.trim()}>
                <DesignerShell fillParent={designerAreaHeight !== null} />
              </TabsContent>

              <TabsContent
                value="transforms"
                className={`pt-3 ${focus.isFocused ? 'flex min-h-0 flex-1 flex-col overflow-y-auto' : ''}`.trim()}
              >
                <TransformsWorkspace
                  previewState={previewState}
                  previewData={null}
                  activeSample={null}
                  onSourceKindChange={(source) => dispatch({ type: 'set-source', source })}
                  onSampleChange={(sampleId) => dispatch({ type: 'set-sample', sampleId })}
                  onExistingInvoiceChange={(soId) => dispatch({ type: 'select-existing-invoice', invoiceId: soId })}
                  onClearExistingInvoice={() => dispatch({ type: 'clear-existing-invoice' })}
                  loadExistingInvoiceOptions={loadExistingDocumentOptions}
                />
              </TabsContent>

              <TabsContent
                value="preview"
                className={`pt-3 space-y-3 ${focus.isFocused ? 'min-h-0 flex-1 overflow-y-auto' : ''}`.trim()}
              >
                <div className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-card))] px-4 py-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <ViewSwitcher
                      currentView={previewState.sourceKind}
                      onChange={(source: PreviewSourceKind) => dispatch({ type: 'set-source', source })}
                      options={buildPreviewSourceOptions(t)}
                    />
                  </div>

                  {previewState.sourceKind === 'existing' && (
                    <div className="w-72">
                      <AsyncSearchableSelect
                        id="document-designer-preview-existing-select"
                        value={previewState.selectedInvoiceId ?? ''}
                        onChange={(value: string) => {
                          if (!value) {
                            dispatch({ type: 'clear-existing-invoice' });
                            return;
                          }
                          dispatch({ type: 'select-existing-invoice', invoiceId: value });
                        }}
                        loadOptions={loadExistingDocumentOptions}
                        placeholder={t('documentTemplates.editor.preview.searchDocuments', {
                          defaultValue: 'Search sales orders...',
                        })}
                        searchPlaceholder={t('documentTemplates.editor.preview.searchDocumentsHint', {
                          defaultValue: 'Search by number or client...',
                        })}
                        emptyMessage={t('documentTemplates.editor.preview.noDocumentsFound', {
                          defaultValue: 'No sales orders found.',
                        })}
                        dropdownMode="overlay"
                        label={t('documentTemplates.editor.preview.selectDocument', {
                          defaultValue: 'Select Sales Order',
                        })}
                      />
                    </div>
                  )}

                  {isAwaitingExistingSelection && (
                    <p
                      className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-2 py-1 text-xs text-slate-500 dark:text-slate-400"
                      data-automation-id="document-designer-preview-existing-empty"
                    >
                      {t('documentTemplates.editor.preview.selectDocumentHint', {
                        defaultValue: 'Select a sales order to preview data-bound output.',
                      })}
                    </p>
                  )}
                </div>

                <div
                  className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2"
                  data-automation-id="document-designer-preview-status"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {previewState.sourceKind === 'existing'
                        // Every registered type renders from sales order data, so the source is the order.
                        ? t('documentTemplates.editor.preview.existingNote', {
                          defaultValue: 'Rendered against the selected sales order.',
                        })
                        : t('documentTemplates.editor.preview.sampleNote', {
                          defaultValue: 'Rendered against representative {{type}} sample data.',
                          type: typeLabel,
                        })}
                    </p>
                    <div className="flex items-center gap-2">
                      <ViewSwitcher
                        aria-label={t('designer.workspace.preview.zoom.label', { defaultValue: 'Preview zoom' })}
                        currentView={previewZoomMode}
                        onChange={(mode: PreviewZoomMode) => setPreviewZoomMode(mode)}
                        options={[
                          {
                            value: 'fit',
                            id: 'document-designer-preview-zoom-fit',
                            label: previewZoomMode === 'fit' && previewScale !== null
                              ? t('designer.workspace.preview.zoom.fitWithScale', {
                                defaultValue: 'Fit ({{percent}}%)',
                                percent: Math.round(previewScale * 100),
                              })
                              : t('designer.workspace.preview.zoom.fit', { defaultValue: 'Fit' }),
                          },
                          {
                            value: 'actual',
                            id: 'document-designer-preview-zoom-actual',
                            label: t('designer.workspace.preview.zoom.actual', { defaultValue: '100%' }),
                          },
                        ]}
                      />
                      <PreviewLocaleSelect
                        id="document-designer-preview-locale-select"
                        value={previewLocale}
                        onChange={setPreviewLocale}
                        disabled={previewLoading}
                      />
                      <Button
                        id="document-designer-preview-rerun-button"
                        variant="outline"
                        size="sm"
                        disabled={previewLoading}
                        onClick={() => setPreviewNonce((value) => value + 1)}
                      >
                        {t('designer.workspace.preview.rerun', { defaultValue: 'Re-run' })}
                      </Button>
                    </div>
                  </div>
                </div>

                {previewError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">{previewError}</AlertDescription>
                  </Alert>
                )}

                <div className="border dark:border-[rgb(var(--color-border-200))] rounded overflow-hidden bg-white dark:bg-[rgb(var(--color-card))] min-h-[480px]">
                  {previewLoading && (
                    <div className="p-4 text-sm text-slate-500">
                      {t('designer.workspace.preview.loadingPreview', { defaultValue: 'Shaping and rendering preview...' })}
                    </div>
                  )}

                  {!previewLoading && !previewError && previewHtml && (
                    <PreviewSheetFrame
                      title={t('documentTemplates.editor.preview.frameTitle', {
                        defaultValue: '{{type}} preview',
                        type: typeLabel,
                      })}
                      html={previewHtml}
                      zoomMode={previewZoomMode}
                      onScaleChange={setPreviewScale}
                      automationId="document-designer-preview-frame"
                    />
                  )}

                  {!previewLoading && !previewError && !previewHtml && (
                    <div className="p-4 text-sm text-slate-500">
                      {isAwaitingExistingSelection
                        ? t('documentTemplates.editor.preview.selectDocumentHint', {
                          defaultValue: 'Select a sales order to preview data-bound output.',
                        })
                        : t('documentTemplates.editor.preview.empty', {
                          defaultValue: 'Open this tab to generate an authoritative preview.',
                        })}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </TabsContent>

        <TabsContent
          value="code"
          className={`pt-4 ${focus.isFocused ? 'flex min-h-0 flex-1 flex-col overflow-y-auto' : ''}`.trim()}
        >
          <Alert variant="info" className="mb-3">
            <AlertDescription>
              {t('templateEditor.alerts.codeReadonly', {
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
      </CardContent>
    </Card>
    </DesignerFocusSurface>
  );
};

export default DocumentTemplateEditor;
