// InvoiceTemplates.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getInvoiceTemplates, saveInvoiceTemplate } from '@/lib/actions/invoiceActions';
import { IInvoiceTemplate } from '@/interfaces/invoice.interfaces';
import InvoiceTemplateManager from './InvoiceTemplateManager';
import CustomSelect from '../ui/CustomSelect';
import { FileTextIcon } from 'lucide-react';
import { GearIcon } from '@radix-ui/react-icons';

const InvoiceTemplates: React.FC = () => {
  const [invoiceTemplates, setInvoiceTemplates] = useState<IInvoiceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<IInvoiceTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const handleCloneTemplate = async (template: IInvoiceTemplate) => {
    try {
      const clonedTemplate = {
        ...template,
        name: `${template.name} (Copy)`,
        isClone: true,
        isStandard: false
      };
      const savedTemplate = await saveInvoiceTemplate(clonedTemplate);
      await fetchTemplates();
      setSelectedTemplate(savedTemplate);
      setError(null);
    } catch (error) {
      console.error('Error cloning template:', error);
      setError('Failed to clone template');
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const templates = await getInvoiceTemplates();
      setInvoiceTemplates(templates);
      setError(null);
    } catch (error) {
      console.error('Error fetching invoice templates:', error);
      setError('Failed to fetch invoice templates');
    }
  };

  const handleTemplateSelect = (template: IInvoiceTemplate) => {
    setSelectedTemplate(template);
  };

  const handleTemplateUpdate = async (updatedTemplate: IInvoiceTemplate) => {
    try {
      await fetchTemplates();
      setSelectedTemplate(updatedTemplate);
      setError(null);
    } catch (error) {
      console.error('Error updating templates:', error);
      setError('Failed to refresh templates');
    }
  };


  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Invoice Templates</h3>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
            {error}
          </div>
        )}
        <div className="space-y-4">
          <div className="flex gap-4 items-center">
            <div className="w-[400px]">
              <CustomSelect
                options={invoiceTemplates.map((template): { value: string; label: JSX.Element } => ({
                  value: template.template_id,
                  label: (
                    <div className="flex items-center gap-2">
                      {template.isStandard ? (
                        <><FileTextIcon className="w-4 h-4" /> {template.name} (Standard)</>
                      ) : (
                        <><GearIcon className="w-4 h-4" /> {template.name}</>
                      )}
                    </div>
                  )
                }))}
                onValueChange={(value) => handleTemplateSelect(invoiceTemplates.find(t => t.template_id === value)!)}
                value={selectedTemplate?.template_id || ''}
                placeholder="Select invoice template..."
              />
            </div>
            {selectedTemplate && (
              <Button
                id='clone-template-button'
                onClick={() => handleCloneTemplate(selectedTemplate)}
                variant="outline"
                size="sm"
              >
                Clone Template
              </Button>
            )}
          </div>
          {selectedTemplate && (
            <InvoiceTemplateManager
              templates={invoiceTemplates}
              onTemplateSelect={handleTemplateSelect}
              onTemplateUpdate={handleTemplateUpdate}
              selectedTemplate={selectedTemplate}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default InvoiceTemplates;
