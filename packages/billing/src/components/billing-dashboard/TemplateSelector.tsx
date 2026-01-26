'use client'

import React, { useState, useEffect } from 'react';
import { IInvoiceTemplate } from '@alga-psa/types';
// Import compileAndSaveTemplate instead of saveInvoiceTemplate
import { getInvoiceTemplates, compileAndSaveTemplate } from '@alga-psa/billing/actions/invoiceTemplates';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { TextArea } from '@alga-psa/ui/components/TextArea';
// Remove DSL parser import - no longer used

interface TemplateSelectorProps {
    onTemplateSelect: (template: IInvoiceTemplate) => void;
    templates: IInvoiceTemplate[];
    onTemplatesUpdate: (templates: IInvoiceTemplate[]) => void;
    selectedTemplate: IInvoiceTemplate | null;
}

const TemplateSelector: React.FC<TemplateSelectorProps> = ({ onTemplateSelect, templates, onTemplatesUpdate, selectedTemplate }) => {
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    // State now holds AssemblyScript source
    const [customTemplateSource, setCustomTemplateSource] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchTemplates();
    }, []);

    useEffect(() => {
        if (selectedTemplate) {
            setSelectedTemplateId(selectedTemplate.template_id);
            // Use assemblyScriptSource instead of dsl
            setCustomTemplateSource(selectedTemplate.assemblyScriptSource || ''); // Default to empty string if null/undefined
        } else {
            // Clear source if no template is selected
            setCustomTemplateSource('');
        }
    }, [selectedTemplate]);

    const fetchTemplates = async () => {
        const fetchedTemplates = await getInvoiceTemplates();
        onTemplatesUpdate(fetchedTemplates);
        if (fetchedTemplates.length > 0) {
            onTemplateSelect(fetchedTemplates[0]); // Select the first template by default
        }
    };

    const handleTemplateChange = (templateId: string) => {
        setSelectedTemplateId(templateId);
        const selected = templates.find(t => t.template_id === templateId);
        if (selected) {
            onTemplateSelect(selected);
            // Use assemblyScriptSource instead of dsl
            setCustomTemplateSource(selected.assemblyScriptSource || ''); // Default to empty string
        }
    };

    // Renamed handler for clarity
    const handleCustomSourceChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setCustomTemplateSource(e.target.value);
        setError(null); // Clear error on edit
    };

    const handleSaveCustomTemplate = async () => {
        // Saving now involves sending the AssemblyScript source.
        // The backend action `saveInvoiceTemplate` should handle compilation.
        // We remove the client-side parsing logic.
        setError(null); // Clear previous errors
        try {
            // Basic validation: Check if source is empty
            if (!customTemplateSource.trim()) {
                setError('Cannot save an empty template.');
                return;
            }

            // Prepare metadata for compileAndSaveTemplate
            // Type: Omit<IInvoiceTemplate, 'tenant' | 'template_id' | 'assemblyScriptSource' | 'wasmPath' | 'isStandard'> & { template_id?: string; }
            const metadata = {
                name: 'Custom Template ' + new Date().toLocaleTimeString(),
                version: 1,
                is_default: false,
                // template_id is optional here, letting the action generate one
            };

            // Call the action that compiles and saves, passing source separately
            const response = await compileAndSaveTemplate(metadata, customTemplateSource);

            if (response.success) {
                const savedTemplate = response.template;
                // Update local state
                onTemplatesUpdate([...templates, savedTemplate]); // Add the newly saved template
                setSelectedTemplateId(savedTemplate.template_id); // Select the new template
                onTemplateSelect(savedTemplate); // Notify parent component
                setCustomTemplateSource(savedTemplate.assemblyScriptSource || ''); // Update text area
            } else {
                // Handle compilation/save error
                console.error("Error saving custom template:", response.error, response.details);
                setError(`Failed to save template: ${response.error}${response.details ? ` (${response.details.substring(0, 100)}...)` : ''}`);
            }

        } catch (err) { // Catch errors from the action call itself (e.g., network)
            console.error("Error saving custom template:", err);
            const message = err instanceof Error ? err.message : "An unknown error occurred during save.";
            // Provide more specific feedback if possible (e.g., compilation error from backend)
            setError(`Failed to save template: ${message}`);
        }
    };

    return (
        <div className="space-y-4">
            <CustomSelect
                options={templates.map((t): { value: string; label: string } => ({ 
                    value: t.template_id, 
                    label: t.name 
                }))}
                onValueChange={handleTemplateChange}
                value={selectedTemplateId}
                placeholder="Select invoice template..."
            />
            {/* Text area now for AssemblyScript source */}
            <TextArea
                value={customTemplateSource}
                onChange={handleCustomSourceChange}
                placeholder="Enter custom template AssemblyScript source here..."
                rows={15} // Increase rows for source code
                className="font-mono text-sm" // Use monospace font for code
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
            <Button id='save-custom-template-button' onClick={handleSaveCustomTemplate}>Save as New Custom Template</Button>
        </div>
    );
};

export default TemplateSelector;
