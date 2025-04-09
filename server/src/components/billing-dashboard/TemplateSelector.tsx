import React, { useState, useEffect } from 'react';
import { IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import { getInvoiceTemplates, saveInvoiceTemplate } from 'server/src/lib/actions/invoiceTemplates';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { TextArea } from 'server/src/components/ui/TextArea';
import { parseInvoiceTemplate } from 'server/src/lib/invoice-dsl/templateLanguage';

interface TemplateSelectorProps {
    onTemplateSelect: (template: IInvoiceTemplate) => void;
    templates: IInvoiceTemplate[];
    onTemplatesUpdate: (templates: IInvoiceTemplate[]) => void;
    selectedTemplate: IInvoiceTemplate | null;
}

const TemplateSelector: React.FC<TemplateSelectorProps> = ({ onTemplateSelect, templates, onTemplatesUpdate, selectedTemplate }) => {
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const [customTemplate, setCustomTemplate] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchTemplates();
    }, []);

    useEffect(() => {
        if (selectedTemplate) {
            setSelectedTemplateId(selectedTemplate.template_id);
            setCustomTemplate(selectedTemplate.dsl);
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
            setCustomTemplate(selected.dsl);
        }
    };

    const handleCustomTemplateChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setCustomTemplate(e.target.value);
        setError(null);
    };

    const handleSaveCustomTemplate = async () => {
        try {
            const parsedTemplate = parseInvoiceTemplate(customTemplate);
            const newTemplate: Omit<IInvoiceTemplate, 'tenant'> = {
                template_id: `new-${Date.now()}`,
                name: 'Custom Template',
                version: 1,
                dsl: customTemplate,
                parsed: parsedTemplate,
            };
            const savedTemplate = await saveInvoiceTemplate(newTemplate);
            onTemplatesUpdate([...templates, savedTemplate]);
            setSelectedTemplateId(savedTemplate.template_id);
            onTemplateSelect(savedTemplate);
        } catch (err) {
            setError('Invalid template syntax. Please check your DSL.');
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
            <TextArea
                value={customTemplate}
                onChange={handleCustomTemplateChange}
                placeholder="Enter custom template DSL here..."
                rows={10}
            />
            {error && <p className="text-red-500">{error}</p>}
            <Button id='save-custom-template-button' onClick={handleSaveCustomTemplate}>Save Custom Template</Button>
        </div>
    );
};

export default TemplateSelector;
