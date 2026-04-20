'use client'

// server/src/components/InvoiceTemplateManager.tsx
import React, { useEffect, useState } from 'react';
// Import the type expected by the renderer
import type { WasmInvoiceViewModel as RendererInvoiceViewModel } from '@alga-psa/types';
import type { IInvoiceTemplate } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { TemplateRenderer } from './TemplateRenderer';
import { sampleInvoices } from '../../utils/sampleInvoiceData'; // This uses SampleInvoiceViewModel
import { mapSampleInvoiceToRendererViewModel } from '../../utils/sampleInvoicePreview';
import PaperInvoice from './PaperInvoice';
// Removed unused imports: TextArea, Button, Input, parseInvoiceTemplate, saveInvoiceTemplate

interface InvoiceTemplateManagerProps {
  // templates prop might be unused now, remove if so
  templates: IInvoiceTemplate[];
  onTemplateSelect: (template: IInvoiceTemplate) => void;
  onTemplateUpdate: (updatedTemplate: IInvoiceTemplate) => void;
  selectedTemplate: IInvoiceTemplate | null;
}

const InvoiceTemplateManager: React.FC<InvoiceTemplateManagerProps> = ({
  templates,
  onTemplateSelect,
  onTemplateUpdate,
  selectedTemplate
}) => {
  const { t } = useTranslation('msp/invoicing');
  const [localTemplates, setLocalTemplates] = useState<IInvoiceTemplate[]>(templates);
  // State now holds the type expected by the renderer
  const [selectedSampleInvoice, setSelectedSampleInvoice] = useState<RendererInvoiceViewModel | null>(null);
  // Removed isSaving state

  useEffect(() => {
    if (!selectedSampleInvoice && sampleInvoices[0]) {
      setSelectedSampleInvoice(mapSampleInvoiceToRendererViewModel(sampleInvoices[0]));
    }
  }, [selectedSampleInvoice]);


  const handleTemplatesUpdate = (updatedTemplates: IInvoiceTemplate[]) => {
    setLocalTemplates(updatedTemplates);
    // If you need to update templates in a parent component, you can add a prop for that
    // onTemplatesUpdate(updatedTemplates);
  };

  const handleSampleInvoiceSelect = (invoice_number: string) => {
    const selectedSample = sampleInvoices.find(invoice => invoice.invoice_number === invoice_number);
    if (selectedSample) {
      // Map the selected sample data to the renderer's expected format
      setSelectedSampleInvoice(mapSampleInvoiceToRendererViewModel(selectedSample));
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">
        {t('templateManager.title', { defaultValue: 'Invoice Template Manager' })}
      </h2>
      <div className="space-y-8">
        <div>
          <h3 className="text-xl font-semibold">
            {t('templateManager.sampleInvoices', { defaultValue: 'Sample Invoices' })}
          </h3>
          <div className="grid grid-cols-1 gap-2 mt-4">
            {sampleInvoices.map((invoice): React.JSX.Element => (
              <div
                key={invoice.invoice_number}
                className={`p-2 border rounded cursor-pointer hover:bg-muted ${
                  selectedSampleInvoice?.invoiceNumber === invoice.invoice_number ? 'bg-primary/10 border-primary/30' : '' // Compare with mapped data
                }`}
                onClick={() => handleSampleInvoiceSelect(invoice.invoice_number)}
              >
                {t('templateManager.invoiceNumber', {
                  number: invoice.invoice_number,
                  defaultValue: `Invoice #${invoice.invoice_number}`,
                })} - {invoice.client?.name} {/* Display client name from sample */}
              </div>
            ))}
          </div>
        </div>
        
        {/* Template editing is handled by the Invoice Template Editor screen. */}
      </div>

      {/* Render preview if a template and sample invoice are selected */}
      {selectedTemplate && selectedSampleInvoice && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">
            {t('templateManager.templatePreview', { defaultValue: 'Template Preview' })}
          </h3>
          <PaperInvoice templateAst={selectedTemplate.templateAst ?? null}>
            <TemplateRenderer template={selectedTemplate} invoiceData={selectedSampleInvoice} />
          </PaperInvoice>
        </div>
      )}
    </div>
  );
};

export default InvoiceTemplateManager;
