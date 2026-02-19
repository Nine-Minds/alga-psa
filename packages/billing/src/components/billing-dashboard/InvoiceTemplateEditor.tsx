'use client'

// server/src/components/billing-dashboard/InvoiceTemplateEditor.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react'; // Added useRef
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardContent, CardFooter } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input'; // Import Input component
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert'; // Import Alert components
import { getInvoiceTemplate, saveInvoiceTemplate } from '@alga-psa/billing/actions/invoiceTemplates'; // Correct function name
import { IInvoiceTemplate } from '@alga-psa/types';
import BackNav from '@alga-psa/ui/components/BackNav'; // Import BackNav
import { Editor } from '@monaco-editor/react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { DesignerVisualWorkspace } from '../invoice-designer/DesignerVisualWorkspace';
import { useInvoiceDesignerStore } from '../invoice-designer/state/designerStore';
import {
  exportWorkspaceToInvoiceTemplateAst,
  exportWorkspaceToInvoiceTemplateAstJson,
  importInvoiceTemplateAstToWorkspace,
} from '../invoice-designer/ast/workspaceAst';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';

interface InvoiceTemplateEditorProps {
  templateId: string | null; // null indicates a new template
}

const InvoiceTemplateEditor: React.FC<InvoiceTemplateEditorProps> = ({ templateId }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { enabled: guiDesignerEnabled, loading: guiDesignerLoading, error: guiDesignerError } = useFeatureFlag(
    'invoice-template-gui-designer'
  );
  const [template, setTemplate] = useState<Partial<IInvoiceTemplate> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); // For generic errors
  const [templateAstText, setTemplateAstText] = useState<string>(''); // JSON editor for non-visual editing
  const isNewTemplate = templateId === null;
  const editorContainerRef = useRef<HTMLDivElement>(null); // Ref for editor container
  const [editorHeight, setEditorHeight] = useState<string | number>('320px'); // Default height (like h-80)
  const [editorTab, setEditorTab] = useState<'visual' | 'code'>('code');
  const [visualWorkspaceTab, setVisualWorkspaceTab] = useState<'design' | 'preview'>('design');
  const designerLoadWorkspace = useInvoiceDesignerStore((state) => state.loadWorkspace);
  const designerResetWorkspace = useInvoiceDesignerStore((state) => state.resetWorkspace);
  const designerExportWorkspace = useInvoiceDesignerStore((state) => state.exportWorkspace);
  const designerNodes = useInvoiceDesignerStore((state) => state.nodes);
  const designerSnapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);
  const designerGridSize = useInvoiceDesignerStore((state) => state.gridSize);
  const designerShowGuides = useInvoiceDesignerStore((state) => state.showGuides);
  const designerShowRulers = useInvoiceDesignerStore((state) => state.showRulers);
  const designerCanvasScale = useInvoiceDesignerStore((state) => state.canvasScale);
  const [designerHydratedFor, setDesignerHydratedFor] = useState<string | null>(null);
  const forceLocalDesignerOverride = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const hostname = window.location.hostname;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    if (!isLocalHost) {
      return false;
    }
    const override = searchParams?.get('forceInvoiceDesigner');
    return override === '1' || override === 'true';
  }, [searchParams]);

  const canUseDesigner = forceLocalDesignerOverride || (guiDesignerEnabled && !guiDesignerLoading && !guiDesignerError);
  const generatedCodeViewSource = useMemo(() => {
    if (!canUseDesigner) {
      return null;
    }

    try {
      return exportWorkspaceToInvoiceTemplateAstJson(designerExportWorkspace());
    } catch {
      return null;
    }
  }, [
    canUseDesigner,
    designerExportWorkspace,
    designerCanvasScale,
    designerGridSize,
    designerNodes,
    designerShowGuides,
    designerShowRulers,
    designerSnapToGrid,
  ]);

  // Effect for fetching template data
  useEffect(() => {
    if (!isNewTemplate && templateId) {
      setIsLoading(true);
      getInvoiceTemplate(templateId) // Correct function name
        .then((data: IInvoiceTemplate | null) => { // Add explicit type for data
          setTemplate(data);
          setTemplateAstText(
            JSON.stringify(
              data?.templateAst ?? {
                kind: 'invoice-template-ast',
                version: INVOICE_TEMPLATE_AST_VERSION,
                layout: { id: 'root', type: 'document', children: [] },
              },
              null,
              2
            )
          );
          setError(null);
        })
        .catch((err: Error) => { // Add explicit type for err
          console.error("Error fetching template:", err);
          setError("Failed to load template data.");
          setTemplate(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      // Initialize with default values for a new template
      const emptyAst = {
        kind: 'invoice-template-ast',
        version: INVOICE_TEMPLATE_AST_VERSION,
        layout: { id: 'root', type: 'document', children: [] },
      } as any;
      setTemplate({ name: '', version: 1, isStandard: false, templateAst: emptyAst });
      setTemplateAstText(JSON.stringify(emptyAst, null, 2));
    }
  }, [templateId, isNewTemplate]);

  useEffect(() => {
    if (canUseDesigner) {
      setEditorTab((prev) => (prev === 'code' ? 'visual' : prev));
      return;
    }
    setEditorTab('code');
  }, [canUseDesigner]);

  useEffect(() => {
    if (!canUseDesigner || !template) {
      return;
    }

    const hydrationKey = templateId ?? 'new';
    if (designerHydratedFor === hydrationKey) {
      return;
    }

    const templateAst = (template as Record<string, unknown>)?.templateAst;
    if (templateAst && typeof templateAst === 'object') {
      try {
        const importedWorkspace = importInvoiceTemplateAstToWorkspace(templateAst as any);
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
    canUseDesigner,
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
      setError("Template name is required.");
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

      if (canUseDesigner) {
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
          const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
          (dataToSave as Record<string, unknown>).templateAst = ast;
        } catch (compilerError) {
          const message = compilerError instanceof Error ? compilerError.message : 'Unknown AST export error';
          setError(`Failed to export template AST from visual workspace: ${message}`);
          setIsLoading(false);
          return;
        }
      } else {
        try {
          (dataToSave as Record<string, unknown>).templateAst = JSON.parse(templateAstText);
        } catch (parseError) {
          setError('Template AST must be valid JSON.');
          setIsLoading(false);
          return;
        }
      }

      // Call the updated save action
      const result = await saveInvoiceTemplate(dataToSave as IInvoiceTemplate); // Type assertion might be needed

      if (result.success) {
        // Navigate back to the templates list after successful save
        handleBack();
      } else {
        setError((result as any).error || 'Failed to save template.');
      }
    } catch (err) {
      // Catch unexpected errors during the action call itself
      console.error("Unexpected error during saveInvoiceTemplate call:", err);
      setError("An unexpected error occurred while saving.");
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

  // Basic placeholder form
  return (
    <Card>
       <CardHeader>
         <div className="flex items-center">
           <BackNav>
             ← Back to Templates List
           </BackNav>
         </div>
         <h2 className="text-xl font-semibold mt-2">{isNewTemplate ? 'Create New Invoice Template' : `Edit Template: ${template?.name || templateId}`}</h2>
       </CardHeader>
       <CardContent>
         <div className="mt-4">
           <label htmlFor="templateName" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">Template Name</label>
           <Input
             type="text"
             id="templateName" // Keep ID for label association
             value={template?.name || ''}
             onChange={(e) => setTemplate(prev => ({ ...prev, name: e.target.value }))}
             disabled={isLoading}
             className="mt-1" // Add margin-top consistent with label
           />
           {/* Display validation/save errors using Alert */}
           {error && (
             <Alert variant="destructive" className="mt-2" id="template-editor-error-alert"> {/* Add ID and margin */}
               <AlertDescription>{error}</AlertDescription>
             </Alert>
           )}
         </div>
         {!canUseDesigner ? (
           <div className="mt-4">
               <label htmlFor="templateAstJson" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">Template AST (JSON)</label>
               {/* Removed h-80, added ref */}
               <div ref={editorContainerRef} className="mt-1 border rounded-md overflow-hidden">
                 <Editor
                   height={editorHeight} // Use calculated height state
                   defaultLanguage="json"
                   value={templateAstText}
                   onChange={(value) => setTemplateAstText(value || '')}
                   options={{
                     minimap: { enabled: true },
                     scrollBeyondLastLine: false,
                     automaticLayout: true,
                     fontSize: 14,
                     readOnly: isLoading
                   }}
                   theme="vs-dark"
                 />
               </div>
           </div>
         ) : (
           <div className="mt-4">
             <Tabs value={editorTab} onValueChange={(value) => setEditorTab(value as 'visual' | 'code')}>
               <TabsList>
                 <TabsTrigger value="visual" data-automation-id="invoice-template-editor-visual-tab">Visual</TabsTrigger>
                 <TabsTrigger value="code" data-automation-id="invoice-template-editor-code-tab">Code</TabsTrigger>
               </TabsList>
               <TabsContent value="visual" className="pt-4 space-y-3">
                 {forceLocalDesignerOverride && !guiDesignerEnabled && (
                   <Alert variant="info" data-automation-id="invoice-template-editor-local-designer-override">
                     <AlertDescription>
                       Local QA override active via <code>forceInvoiceDesigner=1</code>.
                     </AlertDescription>
                   </Alert>
                 )}
                 <div className="border rounded overflow-hidden bg-card" id="invoice-template-visual-designer">
                   <DesignerVisualWorkspace
                     visualWorkspaceTab={visualWorkspaceTab}
                     onVisualWorkspaceTabChange={setVisualWorkspaceTab}
                   />
                 </div>
               </TabsContent>
               <TabsContent value="code" className="pt-4">
                 {canUseDesigner && (
                   <Alert variant="info" className="mb-3" data-automation-id="invoice-template-editor-code-readonly-alert">
                     <AlertDescription>
                       Code view is generated from Visual workspace state and is read-only while GUI designer is enabled.
                     </AlertDescription>
                   </Alert>
                 )}
                 <label htmlFor="templateAssemblyScriptSource" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
                   Template AST (JSON)
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
                       readOnly: isLoading || canUseDesigner
                     }}
                     theme="vs-dark"
                   />
                 </div>
               </TabsContent>
             </Tabs>
           </div>
         )}
        </CardContent>
        <CardFooter className="flex justify-between items-center gap-2"> {/* Updated class for layout */}
           <div className="text-sm text-muted-foreground"> {/* Container for timestamps */}
             {template?.created_at && (
               <p id="template-created-at"> {/* Add id */}
                 Created: {new Date(template.created_at).toLocaleString()}
               </p>
             )}
             {template?.updated_at && (
               <p id="template-updated-at"> {/* Add id */}
                 Last Updated: {new Date(template.updated_at).toLocaleString()}
               </p>
             )}
           </div>
           <div className="flex gap-2"> {/* Container for buttons */}
             <Button id="cancel-template-edit-button" variant="outline" onClick={handleBack} disabled={isLoading}>Cancel</Button> {/* Add id */}
             <Button id="save-template-button" onClick={handleSave} disabled={isLoading}> {/* Add id */}
               {isLoading ? 'Saving...' : 'Save Template'}
             </Button>
           </div>
       </CardFooter>
    </Card>
  );
};

export default InvoiceTemplateEditor;
