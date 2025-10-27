'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '../../components/ui/Button'; // Corrected path
import { Input } from '../../components/ui/Input'; // Corrected path
import { Label } from '../../components/ui/Label'; // Corrected path
import { Switch } from '../../components/ui/Switch'; // Corrected path
import { TextArea } from '../../components/ui/TextArea'; // Corrected component name casing
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '../../components/ui/Card'; // Corrected path
import AssemblyScriptEditor from './AssemblyScriptEditor';
import { getInvoiceTemplate, compileAndSaveTemplate } from '@product/actions/invoiceTemplates'; // Corrected action path
import { IInvoiceTemplate } from '../../interfaces'; // Keep assumed path
import { Save, Play } from 'lucide-react';

interface AssemblyScriptTemplateEditorComponentProps {
  templateId: string;
}

const AssemblyScriptTemplateEditorComponent: React.FC<AssemblyScriptTemplateEditorComponentProps> = ({
  templateId,
}) => {
  const router = useRouter();
  const [template, setTemplate] = useState<IInvoiceTemplate | null>(null);
  const [name, setName] = useState('');
  // Removed description and tags state as they are not in IInvoiceTemplate
  const [version, setVersion] = useState<number | ''>(''); // Use number or empty string for input control
  const [isDefault, setIsDefault] = useState(false); // Replaced isActive with is_default
  const [assemblyScriptSource, setAssemblyScriptSource] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);

  const loadTemplate = useCallback(async () => {
    setIsLoading(true);
    try {
      // TODO: Add tenant context if needed by getInvoiceTemplate
      // Assuming getInvoiceTemplate returns { success: boolean, data?: IInvoiceTemplate, error?: string }
      // Assuming getInvoiceTemplate returns IInvoiceTemplate directly on success or throws error
      const data = await getInvoiceTemplate(templateId);
      if (data) { // Check if data is not null
        setTemplate(data);
        setName(data.name || '');
        setVersion(data.version ?? ''); // Use number or empty string
        setIsDefault(data.is_default || false); // Use is_default
        setAssemblyScriptSource(data.assemblyScriptSource || '');
        setIsReadOnly(data.isStandard || false); // Standard templates are read-only
      } else {
         toast.error(`Template with ID ${templateId} not found.`);
         // Optionally redirect or show an error state
      }
    } catch (error: any) { // Catch specific error type if known
      console.error('Error loading template:', error);
      toast.error(error.message || 'An unexpected error occurred while loading the template.');
    } finally {
      setIsLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  const handleSave = async () => {
    if (!template || isReadOnly || isSaving) return;

    setIsSaving(true);
    // Construct payload matching CompileTemplateMetadata
    // Omit<IInvoiceTemplate, 'tenant' | 'template_id' | 'assemblyScriptSource' | 'wasmPath' | 'isStandard'> & { template_id?: string; }
    const metadataPayload = {
      template_id: template.template_id, // Include template_id for update
      name,
      version: typeof version === 'number' ? version : parseFloat(version || '0'), // Ensure version is number
      is_default: isDefault,
      // description, tags, isActive are not part of the metadata payload
    };

    const sourcePayload = assemblyScriptSource;

    try {
      // compileAndSaveTemplate takes metadata and source, returns { success, template/error }
      const response = await compileAndSaveTemplate(metadataPayload, sourcePayload);

      if (response.success) {
        toast.success('Template saved and compiled successfully!');
        // Update state with the potentially updated template returned from the server
        setTemplate(response.template);
        setName(response.template.name || '');
        setVersion(response.template.version ?? '');
        setIsDefault(response.template.is_default || false);
        setAssemblyScriptSource(response.template.assemblyScriptSource || '');
        setIsReadOnly(response.template.isStandard || false);
      } else {
        toast.error(response.error || 'Failed to save template.', {
           duration: 6000 // Show error longer
        });
        if (response.details) {
            console.error("Compilation/Save Error Details:", response.details);
            // Optionally show details in a modal or separate toast
        }
      }
    } catch (error: any) { // Catch specific error type if known
      console.error('Error saving template:', error);
      toast.error(error.message || 'An unexpected error occurred while saving the template.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = () => {
    if (!template) return;
    // TODO: Implement preview logic
    // 1. Fetch sample invoice data (needs a new action or predefined data)
    // 2. Trigger rendering using the *saved* Wasm module associated with this template
    //    (This might involve calling another backend action that takes templateId and sample data)
    // Use correct ID field
    console.log('Preview/Test Render action triggered for template:', template.template_id);
    toast('Preview functionality not yet implemented.', { icon: 'ℹ️' });
  };

  if (isLoading) {
    return <div>Loading template...</div>; // Replace with a proper loading spinner/skeleton
  }

  if (!template) {
    return <div>Template not found or failed to load.</div>; // Replace with a proper error component
  }

  return (
    <Card id={`invoice-template-editor-${templateId}`}>
      <CardHeader>
        <CardTitle>Edit AssemblyScript Invoice Template</CardTitle>
        {isReadOnly && <p className="text-sm text-yellow-600">Standard templates are read-only.</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="template-name-field">Name</Label>
            <Input
              id="template-name-field"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              readOnly={isReadOnly}
            />
          </div>
          <div>
            <Label htmlFor="template-version-field">Version</Label>
            <Input
              id="template-version-field"
              value={version}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const value = e.target.value;
                // Allow empty string for clearing the input, otherwise parse as float
                setVersion(value === '' ? '' : parseFloat(value));
              }}
              readOnly={isReadOnly}
            />
          </div>
        </div>
        {/* Removed Description and Tags fields */}
        <div className="flex items-center space-x-2 pt-2">
           <Switch
             id="template-default-switch" // Updated ID
             checked={isDefault}
             onCheckedChange={setIsDefault} // Bind to isDefault state
             disabled={isReadOnly}
           />
           <Label htmlFor="template-default-switch">Set as Default Template</Label> {/* Updated Label */}
        </div>

        <div>
          <Label htmlFor="assemblyscript-source-editor">AssemblyScript Source</Label>
          <AssemblyScriptEditor
            value={assemblyScriptSource}
            onChange={(value) => setAssemblyScriptSource(value || '')}
            readOnly={isReadOnly}
            // Pass editorProps if specific Monaco config is needed
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-end space-x-2">
         <Button
           id="preview-template-button"
           variant="outline"
           onClick={handlePreview}
           disabled={isSaving} // Disable preview during save
         >
           <Play className="mr-2 h-4 w-4" /> Preview / Test Render
         </Button>
        {!isReadOnly && (
          <Button
            id="save-template-button"
            onClick={handleSave}
            disabled={isSaving || isLoading}
          >
            <Save className="mr-2 h-4 w-4" /> {isSaving ? 'Saving...' : 'Save Template'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

export default AssemblyScriptTemplateEditorComponent;