// server/src/components/InvoiceTemplateManager.tsx
import React, { useState } from 'react';
// Import the type expected by the renderer
import type { WasmInvoiceViewModel as RendererInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
// Import the type used by sample data, aliasing it
import type { IInvoiceTemplate, InvoiceViewModel as SampleInvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
import { TemplateRenderer } from './TemplateRenderer';
import { sampleInvoices } from 'server/src/utils/sampleInvoiceData'; // This uses SampleInvoiceViewModel
import PaperInvoice from './PaperInvoice';
// Removed unused imports: TextArea, Button, Input, parseInvoiceTemplate, saveInvoiceTemplate
import { Button } from 'server/src/components/ui/Button'; // Keep Button if needed elsewhere, otherwise remove

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
  const [localTemplates, setLocalTemplates] = useState<IInvoiceTemplate[]>(templates);
  // State now holds the type expected by the renderer
  const [selectedSampleInvoice, setSelectedSampleInvoice] = useState<RendererInvoiceViewModel | null>(null);
  // Removed isSaving state

  // Function to map sample data to renderer data structure
  const mapSampleToRendererViewModel = (sample: SampleInvoiceViewModel): RendererInvoiceViewModel => {
    return {
      invoiceNumber: sample.invoice_number,
      // Convert Temporal dates to ISO strings
      issueDate: sample.invoice_date.toString(),
      dueDate: sample.due_date.toString(),
      tenantClient: {
        name: sample.client?.name || null, // Use client name from sample
        address: sample.client?.address || null, // Use client address
        logoUrl: sample.client?.logo || null // Use client logo if available
      },
      customer: {
        name: sample.contact?.name || 'N/A', // Use contact name for customer name
        address: sample.contact?.address || 'N/A', // Use contact address
      },
      items: sample.invoice_charges.map(item => ({
        id: item.item_id || `item-${Math.random()}`, // Ensure an ID exists
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        total: item.total_price, // Use total_price from sample item
        // Add optional fields if needed/available in sample
      })),
      subtotal: sample.subtotal,
      tax: sample.tax,
      total: sample.total,
      currencyCode: sample.currencyCode || 'USD',
      // Removed notes mapping as it doesn't exist on SampleInvoiceViewModel
      // Add timeEntries if available in sample data and needed by renderer type
    };
  };

  // Initialize state with the first sample invoice mapped to the correct type
  useState(() => {
      setSelectedSampleInvoice(mapSampleToRendererViewModel(sampleInvoices[0]));
  });


  const handleTemplatesUpdate = (updatedTemplates: IInvoiceTemplate[]) => {
    setLocalTemplates(updatedTemplates);
    // If you need to update templates in a parent component, you can add a prop for that
    // onTemplatesUpdate(updatedTemplates);
  };

  const handleSampleInvoiceSelect = (invoice_number: string) => {
    const selectedSample = sampleInvoices.find(invoice => invoice.invoice_number === invoice_number);
    if (selectedSample) {
      // Map the selected sample data to the renderer's expected format
      setSelectedSampleInvoice(mapSampleToRendererViewModel(selectedSample));
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
                  selectedSampleInvoice?.invoiceNumber === invoice.invoice_number ? 'bg-blue-50 border-blue-300' : '' // Compare with mapped data
                }`}
                onClick={() => handleSampleInvoiceSelect(invoice.invoice_number)}
              >
                Invoice #{invoice.invoice_number} - {invoice.client?.name} {/* Display client name from sample */}
              </div>
            ))}
          </div>
        </div>
        
        {/* Removed the entire "Edit Template" section (Name Input, DSL TextArea, Save Button) */}
        {/* as editing is now handled by AssemblyScriptTemplateEditorComponent via navigation */}
      </div>

      {/* Render preview if a template and sample invoice are selected */}
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
