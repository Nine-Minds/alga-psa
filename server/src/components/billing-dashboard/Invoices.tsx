// server/src/components/billing-dashboard/Invoices.tsx
'use client'
import React, { useState, useEffect } from 'react';
import { FileTextIcon, GearIcon } from '@radix-ui/react-icons';
import { fetchAllInvoices, getInvoiceTemplates } from '@/lib/actions/invoiceActions';
import { InvoiceViewModel, IInvoiceTemplate } from '@/interfaces/invoice.interfaces';
import TemplateRenderer from './TemplateRenderer';
import PaperInvoice from './PaperInvoice';
import CustomSelect from '@/components/ui/CustomSelect';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';

const Invoices: React.FC = () => {
  const [invoices, setInvoices] = useState<InvoiceViewModel[]>([]);
  const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceViewModel | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<IInvoiceTemplate | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const fetchedInvoices = await fetchAllInvoices();
        setInvoices(fetchedInvoices);
    
        const fetchedTemplates = await getInvoiceTemplates();
        setTemplates(fetchedTemplates);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    loadData();
  }, []);

  const handleInvoiceSelect = (invoice: InvoiceViewModel) => {
    setSelectedInvoice(invoice);
    if (templates.length > 0) {
      setSelectedTemplate(templates[0]);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.template_id === templateId);
    setSelectedTemplate(template || null);
  };

  const columns: ColumnDefinition<InvoiceViewModel>[] = [
    {
      title: 'Invoice Number',
      dataIndex: 'invoice_number',
    },
    {
      title: 'Company',
      dataIndex: ['company', 'name'],
    },
    {
      title: 'Amount',
      dataIndex: 'total',
      render: (value) => `$${value?.toFixed(2)}`,
    },
    {
      title: 'Status',
      dataIndex: 'status',
    },
    {
      title: 'Date',
      dataIndex: 'invoice_date',
      render: (value) => new Date(value).toLocaleDateString(),
    },
    {
      title: 'Action',
      dataIndex: 'invoice_number',
      render: (_, record) => (
        <Button id='view-button' onClick={() => handleInvoiceSelect(record)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Invoices</h2>
      <DataTable
        data={invoices}
        columns={columns}
        pagination={true}
        onRowClick={handleInvoiceSelect}
      />

      {selectedInvoice && (
        <div className="mt-8">
          <h3 className="text-xl font-semibold mb-4">Select Template</h3>
          <CustomSelect
            options={templates.map((template): { value: string; label: JSX.Element } => ({
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
            onValueChange={handleTemplateSelect}
            value={selectedTemplate?.template_id || ''}
            placeholder="Select invoice template..."
          />
        </div>
      )}

      {selectedInvoice && selectedTemplate && (
        <div className="mt-8">
          <h3 className="text-xl font-semibold mb-4">Invoice Preview</h3>
          <PaperInvoice>
            <TemplateRenderer
              template={selectedTemplate}
              invoiceData={selectedInvoice}
            />
          </PaperInvoice>
        </div>
      )}
    </div>
  );
};

export default Invoices;
