'use client'

// server/src/components/billing-dashboard/InvoiceTemplateEditor.tsx
import React, { useState, useEffect, useRef } from 'react'; // Added useRef
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardContent, CardFooter } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input'; // Import Input component
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert'; // Import Alert components
import { getInvoiceTemplate, saveInvoiceTemplate } from '@alga-psa/billing/actions/invoiceTemplates'; // Correct function name
import { IInvoiceTemplate } from '@alga-psa/types';
import BackNav from '@alga-psa/ui/components/BackNav'; // Import BackNav
import { Editor } from '@monaco-editor/react';

interface InvoiceTemplateEditorProps {
  templateId: string | null; // null indicates a new template
}

const InvoiceTemplateEditor: React.FC<InvoiceTemplateEditorProps> = ({ templateId }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [template, setTemplate] = useState<Partial<IInvoiceTemplate> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); // For generic errors
  const [compilationError, setCompilationError] = useState<{ error: string; details?: string } | null>(null); // For compilation errors
  const isNewTemplate = templateId === null;
  const editorContainerRef = useRef<HTMLDivElement>(null); // Ref for editor container
  const [editorHeight, setEditorHeight] = useState<string | number>('320px'); // Default height (like h-80)

  // Effect for fetching template data
  useEffect(() => {
    if (!isNewTemplate && templateId) {
      setIsLoading(true);
      getInvoiceTemplate(templateId) // Correct function name
        .then((data: IInvoiceTemplate | null) => { // Add explicit type for data
          setTemplate(data);
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
      setTemplate({ name: '', assemblyScriptSource: '', isStandard: false }); // Use assemblyScriptSource
    }
  }, [templateId, isNewTemplate]);


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
      setCompilationError(null); // Clear previous compilation error
    }
    // --- END VALIDATION ---

    setIsLoading(true);
    setError(null); // Clear generic error before attempting save
    setCompilationError(null); // Clear compilation error before attempting save

    try {
      // Add logic to prepare the template data for saving
      const dataToSave = { ...template };
      // Remove template_id if it's a new template being created
      if (isNewTemplate) {
        delete dataToSave.template_id;
      }

      // Call the updated save action
      const result = await saveInvoiceTemplate(dataToSave as IInvoiceTemplate); // Type assertion might be needed

      if (result.success) {
        // Navigate back to the templates list after successful save
        handleBack();
      } else {
        // Handle failure: check for compilation error first
        if (result.compilationError) {
          console.error("Compilation Error:", result.compilationError);
          setCompilationError(result.compilationError);
          setError(null); // Ensure generic error is cleared
        } else {
          // If no compilation error, set a generic save error
          console.error("Generic Save Error (no compilation error returned)");
          setError("Failed to save template.");
          setCompilationError(null); // Ensure compilation error is cleared
        }
      }
    } catch (err) {
      // Catch unexpected errors during the action call itself
      console.error("Unexpected error during saveInvoiceTemplate call:", err);
      setError("An unexpected error occurred while saving.");
      setCompilationError(null); // Ensure compilation error is cleared
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
         <p>Template Editor Placeholder</p>
         {/* Add form fields for template name, content, etc. here */}
         <div className="mt-4">
           <label htmlFor="templateName" className="block text-sm font-medium text-gray-700">Template Name</label>
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
         <div className="mt-4">
             <label htmlFor="templateAssemblyScriptSource" className="block text-sm font-medium text-gray-700">AssemblyScript Source</label>
             {/* Removed h-80, added ref */}
             <div ref={editorContainerRef} className="mt-1 border rounded-md overflow-hidden">
               <Editor
                 height={editorHeight} // Use calculated height state
                 defaultLanguage="typescript"
                 value={template?.assemblyScriptSource || ''}
                 onChange={(value) => setTemplate(prev => ({ ...prev, assemblyScriptSource: value || '' }))}
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
             {/* Display Compilation Errors */}
             {compilationError && (
               <Alert variant="destructive" className="mt-4" id="template-compilation-error-alert">
                 <AlertDescription>
                   <p className="font-semibold">Compilation Failed:</p>
                   <p>{compilationError.error}</p>
                   {compilationError.details && (
                     <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto">
                       {compilationError.details}
                     </pre>
                   )}
                 </AlertDescription>
               </Alert>
             )}
         </div>
        </CardContent>
        <CardFooter className="flex justify-between items-center gap-2"> {/* Updated class for layout */}
           <div className="text-sm text-gray-500"> {/* Container for timestamps */}
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
