'use client'
import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileTextIcon, GearIcon } from '@radix-ui/react-icons';
import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu';
import { fetchAllInvoices, getInvoiceTemplates, getInvoiceLineItems } from '@/lib/actions/invoiceActions';
import { getAllCompanies } from '@/lib/actions/companyActions';
import { getServices } from '@/lib/actions/serviceActions';
import { InvoiceViewModel, IInvoiceTemplate } from '@/interfaces/invoice.interfaces';
import TemplateRenderer from './TemplateRenderer';
import PaperInvoice from './PaperInvoice';
import CustomSelect from '@/components/ui/CustomSelect';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import ManualInvoices from './ManualInvoices';
import { ICompany } from '@/interfaces';
import { IService } from '@/interfaces/billing.interfaces';
import BackNav from '../ui/BackNav';

interface ServiceWithRate extends Pick<IService, 'service_id' | 'service_name'> {
  rate: number;
}

const Invoices: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [invoices, setInvoices] = useState<InvoiceViewModel[]>([]);
  const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [services, setServices] = useState<ServiceWithRate[]>([]);

  // Get state from URL parameters
  const selectedInvoiceId = searchParams?.get('invoiceId');
  const selectedTemplateId = searchParams?.get('templateId');
  const managingInvoiceId = searchParams?.get('managingInvoiceId');

  // Derive selected objects from IDs
  const selectedInvoice = selectedInvoiceId ? invoices.find(inv => inv.invoice_id === selectedInvoiceId) || null : null;
  const selectedTemplate = selectedTemplateId ? templates.find(temp => temp.template_id === selectedTemplateId) || null : null;
  const managingInvoice = managingInvoiceId ? invoices.find(inv => inv.invoice_id === managingInvoiceId) || null : null;

  // Function to update URL parameters
  const updateUrlParams = (params: { [key: string]: string | null }) => {
    const newParams = new URLSearchParams(searchParams?.toString() || '');
    Object.entries(params).forEach(([key, value]) => {
      if (value === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    router.push(`/msp/billing?${newParams.toString()}`);
  };

  const loadData = async () => {
    try {
      const [
        fetchedInvoices,
        fetchedTemplates,
        fetchedCompanies,
        fetchedServices
      ] = await Promise.all([
        fetchAllInvoices(),
        getInvoiceTemplates(),
        getAllCompanies(false), // false to get only active companies
        getServices()
      ]);

      setInvoices(fetchedInvoices);
      setTemplates(fetchedTemplates);
      setCompanies(fetchedCompanies);
      setServices(fetchedServices.map((service): ServiceWithRate => ({
        service_id: service.service_id,
        service_name: service.service_name,
        rate: service.default_rate
      })));
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleInvoiceSelect = (invoice: InvoiceViewModel) => {
    const defaultTemplateId = templates.length > 0 ? templates[0].template_id : null;
    updateUrlParams({
      invoiceId: invoice.invoice_id,
      templateId: defaultTemplateId,
      managingInvoiceId: null
    });
  };

  const handleTemplateSelect = (templateId: string) => {
    updateUrlParams({ templateId });
  };

  const handleManageItemsClick = (invoice: InvoiceViewModel) => {
    updateUrlParams({
      managingInvoiceId: invoice.invoice_id,
      invoiceId: null,
      templateId: null
    });
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
      render: (value) => {
        // Convert cents to dollars and handle potential null/undefined
        const amount = typeof value === 'number' ? value / 100 : 0;
        return `$${amount.toFixed(2)}`;
      },
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`invoice-actions-menu-${record.invoice_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`manage-items-menu-item-${record.invoice_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleManageItemsClick(record);
              }}
            >
              {record.is_manual ? 'Manage Items' : 'Manage Manual Items'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (managingInvoice) {
    return (
      <div className="space-y-8">
        <div className="flex justify-between items-center">
          <div className="flex gap-4">
          <BackNav>Back to Invoices</BackNav>          
            <h2 className="text-2xl font-bold">
              {managingInvoice.is_manual 
                ? `Manage Items - Invoice ${managingInvoice.invoice_number}`
                : `Manage Manual Items - Invoice ${managingInvoice.invoice_number}`}
            </h2>
          </div>
        </div>
        <ManualInvoices
          companies={companies}
          services={services}
          invoice={managingInvoice}
          onGenerateSuccess={() => {
            updateUrlParams({
              managingInvoiceId: null
            });
            loadData();
          }}
        />
      </div>
    );
  }

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
