// server/src/components/InvoiceTemplateManager.tsx
import React, { useState } from 'react';
import { IInvoiceTemplate, IInvoice, InvoiceViewModel } from '@/interfaces/invoice.interfaces';
import TemplateRenderer from './TemplateRenderer';
import { sampleInvoices } from '@/utils/sampleInvoiceData';
import PaperInvoice from './PaperInvoice';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { parseInvoiceTemplate } from '@/lib/invoice-dsl/templateLanguage';
import { saveInvoiceTemplate } from '@/lib/actions/invoiceActions';

interface InvoiceTemplateManagerProps {
  templates: IInvoiceTemplate[];
  onTemplateSelect: (template: IInvoiceTemplate) => void;
  selectedTemplate: IInvoiceTemplate | null;
}

const InvoiceTemplateManager: React.FC<InvoiceTemplateManagerProps> = ({
  templates,
  onTemplateSelect,
  selectedTemplate
}) => {
  const [localTemplates, setLocalTemplates] = useState<IInvoiceTemplate[]>(templates);
  const [selectedSampleInvoice, setSelectedSampleInvoice] = useState<InvoiceViewModel>(sampleInvoices[0]);

  const handleTemplatesUpdate = (updatedTemplates: IInvoiceTemplate[]) => {
    setLocalTemplates(updatedTemplates);
    // If you need to update templates in a parent component, you can add a prop for that
    // onTemplatesUpdate(updatedTemplates);
  };

  const handleSampleInvoiceSelect = (invoice_number: string) => {
    const selectedInvoice = sampleInvoices.find(invoice => invoice.invoice_number === invoice_number);
    if (selectedInvoice) {
      setSelectedSampleInvoice(selectedInvoice);
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Invoice Template Manager</h2>
      <div className="space-y-8">
        <div>
          <h3 className="text-xl font-semibold">Sample Invoices</h3>
          <div className="grid grid-cols-1 gap-2 mt-4">
            {sampleInvoices.map((invoice):JSX.Element => (
              <div
                key={invoice.invoice_number}
                className={`p-2 border rounded cursor-pointer hover:bg-gray-50 ${
                  selectedSampleInvoice.invoice_number === invoice.invoice_number ? 'bg-blue-50 border-blue-300' : ''
                }`}
                onClick={() => handleSampleInvoiceSelect(invoice.invoice_number)}
              >
                Invoice #{invoice.invoice_number} - {invoice.custom_fields?.project}
              </div>
            ))}
          </div>
        </div>
        
        {!selectedTemplate?.isStandard && (
          <div className="mt-8 space-y-4">
            <h3 className="text-xl font-semibold">Edit Template</h3>
            <TextArea
              value={selectedTemplate?.dsl || ''}
              onChange={(e) => {
                const updatedTemplate = {
                  ...selectedTemplate!,
                  dsl: e.target.value,
                  parsed: parseInvoiceTemplate(e.target.value)
                };
                onTemplateSelect(updatedTemplate);
              }}
              placeholder="Enter template DSL..."
              rows={10}
              className="font-mono"
            />
            <Button 
              id='save-template-button'
              onClick={async () => {
                if (selectedTemplate) {
                  await saveInvoiceTemplate(selectedTemplate);
                }
              }}
            >
              Save Template
            </Button>
          </div>
        )}
      </div>
      
      {selectedTemplate && selectedSampleInvoice && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Template Preview</h3>
          <PaperInvoice>
            <TemplateRenderer template={selectedTemplate} invoiceData={selectedSampleInvoice} />
          </PaperInvoice>
        </div>
      )}
    </div>
  );
};

export default InvoiceTemplateManager;
