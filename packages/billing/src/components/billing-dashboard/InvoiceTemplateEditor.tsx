'use client'

// server/src/components/billing-dashboard/InvoiceTemplateEditor.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardContent } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input'; // Import Input component
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert'; // Import Alert components
import { getInvoiceTemplate, saveInvoiceTemplate } from '@alga-psa/billing/actions/invoiceTemplates'; // Correct function name
import { IInvoiceTemplate } from '@alga-psa/types';
import BackNav from '@alga-psa/ui/components/BackNav'; // Import BackNav
import { Editor } from '@monaco-editor/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { DesignerVisualWorkspace } from '../invoice-designer/DesignerVisualWorkspace';
import { useInvoiceDesignerStore } from '../invoice-designer/state/designerStore';
import {
  exportWorkspaceToTemplateAst,
  exportWorkspaceToTemplateAstJson,
  importTemplateAstToWorkspace,
} from '../invoice-designer/ast/workspaceAst';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface InvoiceTemplateEditorProps {
  templateId: string | null; // null indicates a new template
}

const InvoiceTemplateEditor: React.FC<InvoiceTemplateEditorProps> = ({ templateId: requestedTemplateId }) => {
  // A new layout becomes an existing one at its first save; from then on every
  // save updates that record, whatever the URL says.
  const [createdTemplateId, setCreatedTemplateId] = useState<string | null>(null);
  const templateId = requestedTemplateId ?? createdTemplateId;
  const { t } = useTranslation('msp/invoicing');
  const { formatDate } = useFormatters();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [template, setTemplate] = useState<Partial<IInvoiceTemplate> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNewTemplate = templateId === null;
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState<string | number>('320px');
  const [editorTab, setEditorTab] = useState<'visual' | 'code'>('visual');
  const [visualWorkspaceTab, setVisualWorkspaceTab] = useState<'design' | 'transforms' | 'preview'>('design');
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
  const [designerHydratedFor, setDesignerHydratedFor] = useState<string | null>(null);
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

  // Effect for fetching template data
  useEffect(() => {
    if (!isNewTemplate && templateId) {
      setIsLoading(true);
      getInvoiceTemplate(templateId) // Correct function name
        .then((data: IInvoiceTemplate | null) => {
          setTemplate(data);
          setError(null);
        })
        .catch((err: Error) => { // Add explicit type for err
          console.error("Error fetching template:", err);
          setError(t('templateEditor.errors.loadFailed', {
            defaultValue: 'Failed to load template data.',
          }));
          setTemplate(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      // Initialize with default values for a new template
      const emptyAst = {
        kind: 'invoice-template-ast',
        version: TEMPLATE_AST_VERSION,
        layout: { id: 'root', type: 'document', children: [] },
      } as any;
      setTemplate({ name: '', version: 1, isStandard: false, templateAst: emptyAst });
    }
  }, [templateId, isNewTemplate]);

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
        // fall through to legacy hydration paths
      }
    }

    if (typeof window !== 'undefined') {
      const localKey = `alga.invoiceDesigner.workspace.${templateId ?? 'new'}`;
      const stored = localStorage.getItem(localKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as any;
          if (parsed?.nodesById) {
            designerLoadWorkspace(parsed);
            setDesignerHydratedFor(hydrationKey);
            return;
          }
          if (parsed?.nodes) {
            designerLoadWorkspace(parsed);
            setDesignerHydratedFor(hydrationKey);
            return;
          }
        } catch {
          // Fall through to reset
        }
      }
    }

    designerResetWorkspace();
    setDesignerHydratedFor(hydrationKey);
  }, [
    designerHydratedFor,
    designerLoadWorkspace,
    designerResetWorkspace,
    template,
    templateId,
  ]);

  // Effect for calculating editor height
  useEffect(() => {
    const calculateHeight = () => {
      if (editorContainerRef.current) {
        const rect = editorContainerRef.current.getBoundingClientRect();
        const offsetTop = rect.top;
        const windowHeight = window.innerHeight;
        // Estimate padding/margins below editor (CardFooter, etc.) - adjust as needed
        const bottomPadding = 100;
        const calculatedHeight = windowHeight - offsetTop - bottomPadding;
        // Set a minimum height
        const minHeight = 200;
        setEditorHeight(Math.max(calculatedHeight, minHeight));
      }
    };

    // Calculate initial height
    calculateHeight();

    // Recalculate on window resize
    window.addEventListener('resize', calculateHeight);

    // Cleanup listener on unmount
    return () => {
      window.removeEventListener('resize', calculateHeight);
    };
  }, [isLoading]); // Recalculate if loading state changes (might affect layout)


  const handleSave = async () => {
    if (!template) return;

    // --- START VALIDATION ---
    if (!template.name || template.name.trim() === '') {
      setError(t('templateEditor.errors.templateNameRequired', {
        defaultValue: 'Template name is required',
      }));
      return; // Prevent saving if name is invalid
    } else {
      setError(null); // Clear previous validation error
    }
    // --- END VALIDATION ---

    setIsLoading(true);
    setError(null); // Clear generic error before attempting save

    try {
      // Add logic to prepare the template data for saving
      const dataToSave = { ...template };
      // Remove template_id if it's a new template being created
      if (isNewTemplate) {
        delete dataToSave.template_id;
      }

      const workspace = designerExportWorkspace();

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(
            `alga.invoiceDesigner.workspace.${templateId ?? 'new'}`,
            JSON.stringify(workspace)
          );
        } catch {
          // Best-effort only
        }
      }

      try {
        const ast = exportWorkspaceToTemplateAst(workspace);
        (dataToSave as Record<string, unknown>).templateAst = ast;
      } catch (compilerError) {
        const message = compilerError instanceof Error
          ? compilerError.message
          : t('templateEditor.errors.unknownAstExport', {
            defaultValue: 'Unknown AST export error',
          });
        setError(t('templateEditor.errors.astExportFailed', {
          message,
          defaultValue: 'Failed to export template AST from visual workspace: {{message}}',
        }));
        setIsLoading(false);
        return;
      }

      // Call the updated save action
      const result = await saveInvoiceTemplate(dataToSave as IInvoiceTemplate); // Type assertion might be needed

      if (result.success) {
        toast.success(t('templateEditor.toast.saved', {
          defaultValue: 'Layout "{{name}}" saved.',
          name: template.name.trim(),
        }));
        // Saving keeps the author in the editor (Close returns to the list). A new
        // layout takes its saved id so the next save updates it; the designer is
        // already showing exactly what was saved, so it is not re-hydrated.
        const savedTemplateId = result.template?.template_id;
        if (result.template) {
          setTemplate((previous) => ({ ...previous, ...result.template }));
        }
        if (isNewTemplate && savedTemplateId) {
          setDesignerHydratedFor(savedTemplateId);
          setCreatedTemplateId(savedTemplateId);
          const params = new URLSearchParams(searchParams?.toString() ?? '');
          params.set('templateId', savedTemplateId);
          // The URL follows so a reload reopens this layout; a router navigation
          // would re-run the server render for a page already showing it.
          window.history.replaceState(window.history.state, '', `/msp/billing?${params.toString()}`);
        }
      } else {
        setError((result as any).error || t('templateEditor.errors.saveFailed', {
          defaultValue: 'Failed to save template.',
        }));
      }
    } catch (err) {
      // Catch unexpected errors during the action call itself
      console.error("Unexpected error during saveInvoiceTemplate call:", err);
      setError(t('templateEditor.errors.unexpectedSave', {
        defaultValue: 'An unexpected error occurred while saving.',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('templateId'); // Remove templateId to go back to the list view
    router.push(`/msp/billing?${params.toString()}`);
  };

  // Removed the old top-level error display
  // The loading state is now handled by disabling UI elements within the Card below.

  // One compact header row (title, name, status, actions) leaves the rest of the
  // window to the designer, so the page itself never needs to scroll while editing.
  return (
    <Card>
       <CardHeader className="pb-3">
         <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
           <BackNav>
             {t('templateEditor.actions.back', {
               defaultValue: 'Back to Invoice Layouts',
             })}
           </BackNav>
           <h2 className="text-lg font-semibold">
             {isNewTemplate
               ? t('templateEditor.titles.create', {
                 defaultValue: 'Create New Invoice Layout',
               })
               : t('templateEditor.titles.edit', {
                 name: template?.name || templateId,
                 defaultValue: 'Edit Layout: {{name}}',
               })}
           </h2>
           <div className="flex min-w-[260px] flex-1 items-center gap-2">
             <label htmlFor="templateName" className="whitespace-nowrap text-sm font-medium text-[rgb(var(--color-text-700))]">
               {t('templateEditor.fields.templateName', {
                 defaultValue: 'Template Name',
               })}
             </label>
             <Input
               type="text"
               id="templateName"
               value={template?.name || ''}
               onChange={(e) => setTemplate(prev => ({ ...prev, name: e.target.value }))}
               disabled={isLoading}
               containerClassName="flex-1"
             />
           </div>
           <div className="flex items-center gap-2">
             <span className="text-xs text-muted-foreground" aria-live="polite" id="template-save-status">
               {template?.updated_at
                 ? t('templateEditor.fields.savedAt', {
                   defaultValue: 'Saved {{time}}',
                   time: formatDate(template.updated_at, { dateStyle: 'medium', timeStyle: 'short' }),
                 })
                 : t('templateEditor.fields.notSaved', { defaultValue: 'Not saved yet' })}
             </span>
             <Button id="cancel-template-edit-button" variant="outline" onClick={handleBack} disabled={isLoading}>
               {t('templateEditor.actions.close', { defaultValue: 'Close' })}
             </Button>
             <Button id="save-template-button" onClick={handleSave} disabled={isLoading}>
               {isLoading
                 ? t('templateEditor.actions.saving', { defaultValue: 'Saving...' })
                 : t('templateEditor.actions.save', { defaultValue: 'Save Template' })}
             </Button>
           </div>
         </div>
         {error && (
           <Alert variant="destructive" className="mt-2" id="template-editor-error-alert">
             <AlertDescription>{error}</AlertDescription>
           </Alert>
         )}
       </CardHeader>
       <CardContent className="pt-0">
           <Tabs value={editorTab} onValueChange={(value) => setEditorTab(value as 'visual' | 'code')}>
             <TabsList>
               <TabsTrigger value="visual" data-automation-id="invoice-template-editor-visual-tab">
                 {t('templateEditor.tabs.visual', { defaultValue: 'Visual' })}
               </TabsTrigger>
               <TabsTrigger value="code" data-automation-id="invoice-template-editor-code-tab">
                 {t('templateEditor.tabs.code', { defaultValue: 'Code' })}
               </TabsTrigger>
             </TabsList>
             <TabsContent value="visual" className="pt-3">
               <div className="border rounded overflow-hidden bg-card" id="invoice-template-visual-designer">
                   <DesignerVisualWorkspace
                     previewPaused={isLoading}
                     visualWorkspaceTab={visualWorkspaceTab}
                     onVisualWorkspaceTabChange={setVisualWorkspaceTab}
                   />
                 </div>
             </TabsContent>
             <TabsContent value="code" className="pt-3">
               <Alert variant="info" className="mb-3" data-automation-id="invoice-template-editor-code-readonly-alert">
                 <AlertDescription>
                   {t('templateEditor.alerts.codeReadonly', {
                     defaultValue: 'Code view is generated from the Visual workspace and is read-only.',
                   })}
                 </AlertDescription>
               </Alert>
               <label htmlFor="templateAssemblyScriptSource" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
                 {t('templateEditor.fields.templateAst', {
                   defaultValue: 'Template AST (JSON)',
                 })}
               </label>
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
                     readOnly: true
                   }}
                   theme="vs-dark"
                 />
               </div>
             </TabsContent>
           </Tabs>
        </CardContent>
    </Card>
  );
};

export default InvoiceTemplateEditor;
