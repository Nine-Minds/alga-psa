// server/src/components/billing-dashboard/InvoiceTemplateEditor.tsx
import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from 'server/src/components/ui/Button';
import { Card, CardHeader, CardContent, CardFooter } from 'server/src/components/ui/Card';
import { getInvoiceTemplate, saveInvoiceTemplate } from 'server/src/lib/actions/invoiceTemplates'; // Correct function name
import { IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import BackNav from 'server/src/components/ui/BackNav'; // Import BackNav
import { Editor } from '@monaco-editor/react';

interface InvoiceTemplateEditorProps {
  templateId: string | null; // null indicates a new template
}

const InvoiceTemplateEditor: React.FC<InvoiceTemplateEditorProps> = ({ templateId }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [template, setTemplate] = useState<Partial<IInvoiceTemplate> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNewTemplate = templateId === null;

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

  const handleSave = async () => {
    if (!template) return;
    setIsLoading(true);
    try {
      // Add logic to prepare the template data for saving
      const dataToSave = { ...template };
      // Remove template_id if it's a new template being created
      if (isNewTemplate) {
        delete dataToSave.template_id;
      }

      await saveInvoiceTemplate(dataToSave as IInvoiceTemplate); // Type assertion might be needed depending on saveInvoiceTemplate signature
      setError(null);
      // Navigate back to the templates list after saving
      handleBack();
    } catch (err) {
      console.error("Error saving template:", err);
      setError("Failed to save template.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('templateId'); // Remove templateId to go back to the list view
    router.push(`/msp/billing?${params.toString()}`);
  };

  if (isLoading && !isNewTemplate) {
    return <div>Loading template...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  // Basic placeholder form
  return (
    <Card>
       <CardHeader>
         <BackNav> {/* Remove onClick prop */}
           &larr; Back to Templates List
         </BackNav>
         <h2 className="text-xl font-semibold mt-2">{isNewTemplate ? 'Create New Invoice Template' : `Edit Template: ${template?.name || templateId}`}</h2>
       </CardHeader>
       <CardContent>
         <p>Template Editor Placeholder</p>
         {/* Add form fields for template name, content, etc. here */}
         <div className="mt-4">
           <label htmlFor="templateName" className="block text-sm font-medium text-gray-700">Template Name</label>
           <input
             type="text"
             id="templateName"
             value={template?.name || ''}
             onChange={(e) => setTemplate(prev => ({ ...prev, name: e.target.value }))}
             className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
             disabled={isLoading}
           />
          </div>
          <div className="mt-4">
             <label htmlFor="templateAssemblyScriptSource" className="block text-sm font-medium text-gray-700">AssemblyScript Source</label>
             <div className="mt-1 h-80 border rounded-md overflow-hidden">
               <Editor
                 height="100%"
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
         </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
           <Button id="cancel-template-edit-button" variant="outline" onClick={handleBack} disabled={isLoading}>Cancel</Button> {/* Add id */}
           <Button id="save-template-button" onClick={handleSave} disabled={isLoading}> {/* Add id */}
             {isLoading ? 'Saving...' : 'Save Template'}
           </Button>
       </CardFooter>
    </Card>
  );
};

export default InvoiceTemplateEditor;