'use client'
import React, { useState, useEffect } from 'react';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileTextIcon, GearIcon } from '@radix-ui/react-icons';
import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import CreditExpirationInfo from './CreditExpirationInfo';
import {
  fetchAllInvoices,
  getInvoiceTemplates,
  getInvoiceLineItems,
  finalizeInvoice,
  unfinalizeInvoice
} from 'server/src/lib/actions/invoiceActions';
import { scheduleInvoiceZipAction } from 'server/src/lib/actions/job-actions/scheduleInvoiceZipAction';
import { scheduleInvoiceEmailAction } from 'server/src/lib/actions/job-actions/scheduleInvoiceEmailAction';
import { getAllCompanies } from 'server/src/lib/actions/companyActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { InvoiceViewModel, IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import { TemplateRenderer } from './TemplateRenderer';
import PaperInvoice from './PaperInvoice';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import { CustomTabs } from 'server/src/components/ui/CustomTabs';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import ManualInvoices from './ManualInvoices';
import { ICompany } from 'server/src/interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import BackNav from '../ui/BackNav';

interface ServiceWithRate extends Pick<IService, 'service_id' | 'service_name'> {
  rate: number;
}

const Invoices: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [allInvoices, setAllInvoices] = useState<InvoiceViewModel[]>([]);
  const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [services, setServices] = useState<ServiceWithRate[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<'Draft' | 'Finalized'>('Draft');
  const selectedInvoiceId = searchParams?.get('invoiceId');

  // Filter invoices based on tab
  const invoices = activeTab === 'Draft'
    ? allInvoices.filter(inv => !inv.finalized_at)
    : allInvoices.filter(inv => inv.finalized_at);

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'Draft' | 'Finalized');
    setSelectedInvoices(new Set());
  };
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

      setAllInvoices(fetchedInvoices);
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

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        await loadData();
      } catch (err) {
        console.error('Error loading invoices:', err);
        setError('Failed to load invoices. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [activeTab]); // Refresh when tab changes

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

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedInvoices(new Set(invoices.map(inv => inv.invoice_id)));
    } else {
      setSelectedInvoices(new Set());
    }
  };

  const handleSelectInvoice = (invoiceId: string, checked: boolean) => {
    const newSelection = new Set(selectedInvoices);
    if (checked) {
      newSelection.add(invoiceId);
    } else {
      newSelection.delete(invoiceId);
    }
    setSelectedInvoices(newSelection);
  };

  // Define table columns
  const baseColumns: ColumnDefinition<InvoiceViewModel>[] = [
    {
      title: (
        <div className="flex items-center">
          <div onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={selectedInvoices.size > 0 && selectedInvoices.size === invoices.length}
              onChange={(e) => {
                e.stopPropagation();
                handleSelectAll(e.target.checked);
              }}
            />
          </div>
        </div>
      ),
      dataIndex: 'invoice_id', // Added to satisfy ColumnDefinition interface
      width: '50px',
      render: (_, record) => (
        <div className="flex items-center">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={selectedInvoices.has(record.invoice_id)}
            onChange={(e) => handleSelectInvoice(record.invoice_id, e.target.checked)}
          />
        </div>
      ),
    },
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
      title: 'Credit Applied',
      dataIndex: 'credit_applied',
      render: (value, record) => {
        if (!value || value === 0) return '-';
        const amount = typeof value === 'number' ? value / 100 : 0;
        return `$${amount.toFixed(2)}`;
      },
    },
    {
      title: 'Status',
      dataIndex: 'finalized_at',
      render: (value) => value ? 'Finalized' : 'Draft',
    },
    {
      title: 'Date',
      dataIndex: 'invoice_date',
      render: (value) => toPlainDate(value).toLocaleString(),
    },
    {
      title: 'Actions',
      dataIndex: 'invoice_number',
      width: '5%',
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
            {!record.finalized_at && (
              <DropdownMenuItem
                id={`manage-items-menu-item-${record.invoice_id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleManageItemsClick(record);
                }}
              >
                {record.is_manual ? 'Invoice Details' : 'Manage Manual Items'}
              </DropdownMenuItem>
            )}
            {!record.finalized_at && (
              <DropdownMenuItem
                id={`finalize-invoice-menu-item-${record.invoice_id}`}
                onClick={async (e) => {
                  e.stopPropagation();
                  setError(null);
                  try {
                    await finalizeInvoice(record.invoice_id);
                    await loadData();
                  } catch (error) {
                    console.error('Failed to finalize invoice:', error);
                    setError('Failed to finalize invoice. Please try again.');
                  }
                }}
              >
                Finalize Invoice
              </DropdownMenuItem>
            )}
            {record.finalized_at && (
              <DropdownMenuItem
                id={`unfinalize-invoice-menu-item-${record.invoice_id}`}
                onClick={async (e) => {
                  e.stopPropagation();
                  setError(null);
                  try {
                    await unfinalizeInvoice(record.invoice_id);
                    await loadData();
                  } catch (error) {
                    console.error('Failed to unfinalize invoice:', error);
                    setError('Failed to unfinalize invoice. Please try again.');
                  }
                }}
              >
                Unfinalize Invoice
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              id={`download-pdf-menu-item-${record.invoice_id}`}
              onClick={async (e) => {
                e.stopPropagation();
                setError(null);
                try {
                  const { jobId } = await scheduleInvoiceZipAction([record.invoice_id]);
                  
                  if (jobId) {
                    setActiveJobs(prev => new Set(prev).add(jobId));
                    // Finalize the invoice when PDF is downloaded
                    await finalizeInvoice(record.invoice_id);
                    await loadData();
                  }
                } catch (error) {
                  console.error('Failed to generate PDF:', error);
                  
                  // Extract specific error message
                  let errorMessage = 'Failed to generate PDF. Please try again.';
                  if (error instanceof Error) {
                    errorMessage = error.message;
                    
                    // Handle specific error types with more user-friendly messages
                    if (errorMessage.includes('Invoice is already finalized')) {
                      errorMessage = 'Cannot generate PDF for an already finalized invoice.';
                    }
                  }
                  
                  setError(errorMessage);
                }
              }}
            >
              Download PDF
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`send-email-menu-item-${record.invoice_id}`}
              onClick={async (e) => {
                e.stopPropagation();
                setError(null);
                try {
                  const { jobId } = await scheduleInvoiceEmailAction([record.invoice_id]);
                  
                  if (jobId) {
                    setActiveJobs(prev => new Set(prev).add(jobId));
                    // Finalize the invoice when email is sent
                    await finalizeInvoice(record.invoice_id);
                    await loadData();
                  }
                } catch (error) {
                  console.error('Failed to send email:', error);
                  
                  // Extract specific error message
                  let errorMessage = 'Failed to send invoice email. Please try again.';
                  if (error instanceof Error) {
                    errorMessage = error.message;
                    
                    // Handle specific error types with more user-friendly messages
                    if (errorMessage.includes('Invoice is already finalized')) {
                      errorMessage = 'Cannot send email for an already finalized invoice.';
                    }
                  }
                  
                  setError(errorMessage);
                }
              }}
            >
              Send as Email
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Add finalized date column for finalized tab
  const finalizedColumns = activeTab === 'Finalized' ? [
    ...baseColumns.slice(0, -1),
    {
      title: 'Finalized Date',
      dataIndex: 'finalized_at',
      render: (value: string) => value ? toPlainDate(value).toLocaleString() : '',
    },
    baseColumns[baseColumns.length - 1], // Action column
  ] : baseColumns;

  // Redirect to invoice list if trying to manage a finalized invoice
  if (managingInvoice?.finalized_at) {
    router.push('/msp/billing');
    return <></>;
  }

  if (managingInvoice) {
    return (
      <div className="space-y-8">
        <div className="flex justify-between items-center">
          <div className="flex gap-4">
            <BackNav>Back to Invoices</BackNav>
            <h2 className="text-2xl font-bold">
              {`Invoice Details - ${managingInvoice.invoice_number}`}
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
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Invoices</h2>
          <div className="flex items-center gap-4">
            <CustomTabs
              tabs={[
                {
                  label: 'Draft',
                  content: null
                },
                {
                  label: 'Finalized',
                  content: null
                }
              ]}
              defaultTab={activeTab}
              onTabChange={handleTabChange}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  id="invoice-actions-dropdown"
                  variant="outline"
                  disabled={selectedInvoices.size === 0}
                  className="flex items-center gap-2"
                >
                  Actions
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={async () => {
                    setError(null);
                    try {
                      const { jobId } = await scheduleInvoiceZipAction(Array.from(selectedInvoices));

                      if (jobId) {
                        setActiveJobs(prev => new Set(prev).add(jobId));
                        // Finalize all downloaded invoices
                        for (const invoiceId of selectedInvoices) {
                          await finalizeInvoice(invoiceId);
                        }
                        setSelectedInvoices(new Set());
                        await loadData();
                      }
                    } catch (error) {
                      console.error('Failed to schedule PDF generation:', error);
                      
                      // Extract specific error message
                      let errorMessage = 'Failed to generate PDFs. Please try again.';
                      if (error instanceof Error) {
                        errorMessage = error.message;
                        
                        // Handle specific error types with more user-friendly messages
                        if (errorMessage.includes('Invoice is already finalized')) {
                          errorMessage = 'Cannot generate PDFs for already finalized invoices.';
                        }
                      }
                      
                      setError(errorMessage);
                    }
                  }}
                >
                  Download PDFs
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    setError(null);
                    try {
                      const { jobId } = await scheduleInvoiceEmailAction(Array.from(selectedInvoices));

                      if (jobId) {
                        setActiveJobs(prev => new Set(prev).add(jobId));
                        // Finalize all emailed invoices
                        for (const invoiceId of selectedInvoices) {
                          await finalizeInvoice(invoiceId);
                        }
                        setSelectedInvoices(new Set());
                        await loadData();
                      }
                    } catch (error) {
                      console.error('Failed to schedule email sending:', error);
                      
                      // Extract specific error message
                      let errorMessage = 'Failed to send invoice emails. Please try again.';
                      if (error instanceof Error) {
                        errorMessage = error.message;
                        
                        // Handle specific error types with more user-friendly messages
                        if (errorMessage.includes('Invoice is already finalized')) {
                          errorMessage = 'Cannot send emails for already finalized invoices.';
                        }
                      }
                      
                      setError(errorMessage);
                    }
                  }}
                >
                  Send Emails
                </DropdownMenuItem>
                {activeTab === 'Draft' ? (
                  <DropdownMenuItem
                    id="finalize-selected-invoices-menu-item"
                    onClick={async () => {
                      setError(null);
                      try {
                        for (const invoiceId of selectedInvoices) {
                          await finalizeInvoice(invoiceId);
                        }
                        setSelectedInvoices(new Set());
                        await loadData();
                      } catch (error) {
                        console.error('Failed to finalize invoices:', error);
                        setError('Failed to finalize invoices. Please try again.');
                      }
                    }}
                  >
                    Finalize Selected Invoices
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    id="unfinalize-selected-invoices-menu-item"
                    onClick={async () => {
                      setError(null);
                      try {
                        for (const invoiceId of selectedInvoices) {
                          await unfinalizeInvoice(invoiceId);
                        }
                        setSelectedInvoices(new Set());
                        await loadData();
                      } catch (error) {
                        console.error('Failed to unfinalize invoices:', error);
                        setError('Failed to unfinalize invoices. Please try again.');
                      }
                    }}
                  >
                    Unfinalize Selected Invoices
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {error && (
          <div className="text-red-500 mb-4">{error}</div>
        )}
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          )}
          <DataTable
            data={invoices}
            columns={finalizedColumns}
            pagination={true}
            onRowClick={handleInvoiceSelect}
          />
        </div>

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
            
            {/* Show credit expiration information if credits were applied */}
            {selectedInvoice.credit_applied > 0 && (
              <CreditExpirationInfo
                creditApplied={selectedInvoice.credit_applied}
                invoiceId={selectedInvoice.invoice_id}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Invoices;
