// server/src/components/InvoiceTemplateManager.tsx
import React, { useState } from 'react';
// Import the type expected by the renderer
import type { InvoiceViewModel as RendererInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
// Import the type used by sample data, aliasing it
import type { IInvoiceItem, IInvoiceTemplate, InvoiceViewModel as SampleInvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
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
      customer: {
        name: sample.contact?.name || 'N/A', // Use contact name for customer name
        address: sample.contact?.address || 'N/A', // Use contact address
      },
      // Map sample items to conform to IInvoiceItem interface
      items: sample.invoice_items.map((item): IInvoiceItem => ({
        // Map existing fields
        item_id: item.item_id || `sample-item-${Math.random().toString(36).substring(7)}`, // Use item_id, generate sample if missing
        invoice_id: sample.invoice_id, // Use invoice_id from parent sample invoice
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        // Add required fields from IInvoiceItem with defaults/placeholders
        tenant: item.tenant || 'sample-tenant', // Add tenant (required by TenantEntity)
        rate: item.rate ?? item.unit_price, // Add rate (required by NetAmountItem), fallback to unit_price
        tax_amount: item.tax_amount ?? 0, // Add tax_amount (required), default to 0
        net_amount: item.net_amount ?? item.total_price, // Add net_amount (required), fallback to total_price
        is_manual: item.is_manual === true ? true : false, // Add is_manual (required), default to false
        // Map optional fields if they exist in the sample item structure
        service_id: item.service_id,
        plan_id: item.plan_id,
        tax_region: item.tax_region,
        tax_rate: item.tax_rate,
        is_taxable: item.is_taxable,
        is_discount: item.is_discount,
        discount_type: item.discount_type,
        discount_percentage: item.discount_percentage,
        applies_to_item_id: item.applies_to_item_id,
        applies_to_service_id: item.applies_to_service_id,
        company_bundle_id: item.company_bundle_id,
        bundle_name: item.bundle_name,
        is_bundle_header: item.is_bundle_header,
        parent_item_id: item.parent_item_id,
        created_by: item.created_by,
        updated_by: item.updated_by,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })),
      subtotal: sample.subtotal,
      tax: sample.tax,
      total: sample.total,
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
                Invoice #{invoice.invoice_number} - {invoice.company?.name} {/* Display company name from sample */}
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
