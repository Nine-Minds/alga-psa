'use client'
import React, { useState } from 'react';
import { generateManualInvoice } from '@/lib/actions/manualInvoiceActions';
import { updateInvoiceManualItems } from '@/lib/actions/invoiceActions';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LineItem } from './LineItem';
import { CompanyPicker } from '../companies/CompanyPicker';
import { ICompany } from '../../interfaces';
import { ErrorBoundary } from 'react-error-boundary';
import { IService } from '../../interfaces/billing.interfaces';
import { InvoiceViewModel } from '@/interfaces/invoice.interfaces';
import type { JSX } from 'react';
import { v4 as uuidv4 } from 'uuid';

// Use a constant for environment check since process.env is not available
const IS_DEVELOPMENT = typeof window !== 'undefined' && 
  globalThis.window.location.hostname === 'localhost';

interface ServiceWithRate extends Pick<IService, 'service_id' | 'service_name'> {
  rate: number;  // Maps to default_rate from IService
}

interface SelectOption {
  value: string;
  label: string;
}

interface InvoiceItem {
  service_id: string;
  quantity: number;
  description: string;
  rate: number;
  item_id?: string;
}

interface ManualInvoicesProps {
  companies: ICompany[];
  services: ServiceWithRate[];
  onGenerateSuccess: () => void;
  invoice?: InvoiceViewModel;
  loading?: boolean; // Add loading prop
}

interface EditableInvoiceItem extends InvoiceItem {
  item_id?: string;
  isExisting?: boolean;
  isRemoved?: boolean;
}

const AutomatedItemsTable: React.FC<{
  items: Array<{
    service_name: string;
    total: number;
  }>;
}> = ({ items }) => {
  console.log('Rendering automated items table:', {
    count: items.length,
    items: items.map(item => ({
      service: item.service_name,
      total: item.total
    }))
  });
  
  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium mb-2">Automated Line Items</h3>
      <table className="w-full">
        <thead className="text-sm text-gray-500">
          <tr>
            <th className="text-left py-2">Service</th>
            <th className="text-right py-2">Total</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {items.map((item, i) => (
            <tr key={i} className="border-t">
              <td className="py-2">{item.service_name}</td>
              <td className="text-right">${(item.total / 100).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-md">
      <h2 className="text-lg font-semibold text-red-800">Something went wrong:</h2>
      <pre className="mt-2 text-sm text-red-600">{error.message}</pre>
      <Button
        id='try-again-button'
        onClick={resetErrorBoundary}
        className="mt-4"
        variant="secondary"
      >
        Try again
      </Button>
    </div>
  );
}

const ManualInvoicesContent: React.FC<ManualInvoicesProps> = ({
  companies,
  services,
  onGenerateSuccess,
  invoice,
  loading = false
}) => {
  console.log('Initializing ManualInvoices with:', {
    hasCompanies: companies?.length,
    hasServices: services?.length,
    invoice: invoice ? {
      id: invoice.invoice_id,
      number: invoice.invoice_number,
      isManual: invoice.is_manual,
      itemCount: invoice.invoice_items?.length,
      items: invoice.invoice_items?.map(item => ({
        id: item.item_id,
        isManual: item.is_manual,
        serviceId: item.service_id,
        description: item.description
      }))
    } : null
  });

  const [selectedCompany, setSelectedCompany] = useState<string>(
    invoice?.company_id || ''
  );

  const [items, setItems] = useState<EditableInvoiceItem[]>(() => {
    if (invoice) {
      // Get existing manual items
      const allItems = invoice.invoice_items || [];
      console.log('Processing invoice items:', {
        total: allItems.length,
        manual: allItems.filter(item => item.is_manual).length,
        automated: allItems.filter(item => !item.is_manual).length
      });
      
      const manualItems = allItems
        .filter(item => {
          console.log('Checking item:', {
            id: item.item_id,
            isManual: item.is_manual,
            description: item.description
          });
          return item.is_manual;
        })
        .map(item => ({
          item_id: item.item_id,
          service_id: item.service_id || '',
          quantity: item.quantity,
          description: item.description,
          rate: item.unit_price,
          isExisting: true,
          isRemoved: false
        }));

      console.log('Found manual items:', manualItems.length);

      // For new invoices or when no manual items exist, add empty item
      if (manualItems.length === 0) {
        return [{
          service_id: '',
          quantity: 1,
          description: '',
          rate: 0,
          isExisting: false,
          isRemoved: false
        }];
      }

      return manualItems;
    }
    
    // New manual invoice
    return [{
      service_id: '',
      quantity: 1,
      description: '',
      rate: 0,
      isExisting: false,
      isRemoved: false
    }];
  });
  
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const handleAddItem = () => {
    const newItems = [...items, {
      service_id: '',
      quantity: 1,
      description: '',
      rate: 0,
      isExisting: false,
      isRemoved: false
    }];
    setItems(newItems);
    // Expand only the new item
    setExpandedItems(new Set([newItems.length - 1]));
  };

  const handleRemoveItem = (index: number) => {
    console.log('Removing/restoring item:', {
      index,
      item: items[index]
    });

    const newItems = [...items];
    if (newItems[index].isExisting) {
      // Mark existing items as removed instead of actually removing them
      newItems[index] = {
        ...newItems[index],
        isRemoved: !newItems[index].isRemoved // Toggle removed state
      };
      setItems(newItems);
    } else {
      // Remove new items completely
      newItems.splice(index, 1);
      setItems(newItems);
      // Update expanded items set
      const newExpanded = new Set(expandedItems);
      newExpanded.delete(index);
      // Adjust indices for items after the removed one
      const adjustedExpanded = new Set<number>();
      newExpanded.forEach(i => {
        if (i < index) adjustedExpanded.add(i);
        else if (i > index) adjustedExpanded.add(i - 1);
      });
      setExpandedItems(adjustedExpanded);
    }
  };

  const handleItemChange = (index: number, field: keyof InvoiceItem, value: string | number) => {
    console.log('Changing item:', {
      index,
      field,
      value,
      item: items[index]
    });

    const newItems = [...items];
    if (field === 'service_id') {
      const service = services.find(s => s.service_id === value);
      if (!service) {
        if (IS_DEVELOPMENT) {
          console.warn(`Service not found for ID: ${value}`);
        }
        newItems[index] = {
          ...newItems[index],
          [field]: value as string
        };
      } else {
        // Always update rate when service changes
        newItems[index] = {
          ...newItems[index],
          [field]: value as string,
          rate: service.rate,
          description: service.service_name // Optionally pre-fill description
        };
      }
    } else if (field === 'quantity' || field === 'rate') {
      const numericValue = typeof value === 'string' ? parseFloat(value) || 0 : value;
      newItems[index] = {
        ...newItems[index],
        [field]: numericValue
      };
    } else {
      newItems[index] = {
        ...newItems[index],
        [field]: value as string
      };
    }
    setItems(newItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice && !selectedCompany) {
      setError('Please select a company');
      return;
    }

    const nonRemovedItems = items.filter(item => !item.isRemoved);
    if (nonRemovedItems.some(item => !item.service_id)) {
      setError('Please fill in all required fields');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      if (invoice) {
        console.log('Updating invoice items:', {
          invoiceId: invoice.invoice_id,
          new: items.filter(i => !i.isExisting && !i.isRemoved).length,
          updated: items.filter(i => i.isExisting && !i.isRemoved).length,
          removed: items.filter(i => i.isRemoved).length
        });

        // Separate items into new, updated, and removed
        const newItems = items.filter(item => !item.isExisting && !item.isRemoved);
        const updatedItems = items.filter(item => item.isExisting && !item.isRemoved && item.item_id);
        const removedItemIds = items
          .filter(item => item.isExisting && item.isRemoved && item.item_id)
          .map(item => item.item_id!);

        await updateInvoiceManualItems(invoice.invoice_id, {
          newItems: newItems.map(({ service_id, description, quantity, rate }) => ({
            service_id,
            description,
            quantity,
            rate: rate, // Convert to cents
            item_id: uuidv4() // Add required item_id field
          })),
          updatedItems: updatedItems.map(({ item_id, service_id, description, quantity, rate }) => ({
            item_id: item_id!,
            service_id,
            description,
            quantity,
            rate: rate // Convert to cents
          })),
          removedItemIds
        });
      } else {
        console.log('Generating new manual invoice:', {
          companyId: selectedCompany,
          itemCount: items.filter(item => !item.isRemoved).length
        });

        await generateManualInvoice({
          companyId: selectedCompany,
          items: items.filter(item => !item.isRemoved).map(({ service_id, description, quantity, rate }) => ({
            service_id,
            description,
            quantity,
            rate: rate, // Convert to cents
            item_id: uuidv4() // Add required item_id field
          }))
        });
      }
      
      onGenerateSuccess();
    } catch (err) {
      setError(`Error ${invoice ? 'updating' : 'generating'} invoice`);
      if (IS_DEVELOPMENT) {
        console.error('Error with invoice:', err);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const serviceOptions: SelectOption[] = services.map((service): SelectOption => ({
    value: service.service_id,
    label: service.service_name
  }));

  const calculateTotal = () => {
    // Calculate total in cents
    return items
      .filter(item => !item.isRemoved)
      .reduce((sum, item) => sum + (item.quantity * item.rate), 0);
  };

  const getButtonText = () => {
    if (isGenerating) return 'Processing...';
    
    const changes = [];
    const newCount = items.filter(i => !i.isExisting && !i.isRemoved).length;
    const removedCount = items.filter(i => i.isRemoved).length;
    const updatedCount = items.filter(i => i.isExisting && !i.isRemoved).length;
    
    if (newCount > 0) changes.push(`${newCount} new`);
    if (removedCount > 0) changes.push(`${removedCount} removed`);
    if (updatedCount > 0) changes.push(`${updatedCount} updated`);
    
    const changesText = changes.length > 0 ? ` (${changes.join(', ')})` : '';
    return `Save Changes${changesText}`;
  };

  return (
    <Card>
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-lg font-semibold">
                {invoice
                  ? `Manage Items - Invoice ${invoice.invoice_number}`
                  : 'Generate Manual Invoice'}
              </h2>
            </div>

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {!invoice && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Company
                  </label>
                  <CompanyPicker
                    id='company-picker'
                    companies={companies}
                    selectedCompanyId={selectedCompany}
                    onSelect={setSelectedCompany}
                    filterState={filterState}
                    onFilterStateChange={setFilterState}
                    clientTypeFilter={clientTypeFilter}
                    onClientTypeFilterChange={setClientTypeFilter}
                  />
                </div>
              )}

              {/* Show automated items for non-manual invoices */}
              {invoice && !invoice.is_manual && (
                <AutomatedItemsTable
                  items={invoice.invoice_items
                    .filter(item => !item.is_manual)
                    .map(item => ({
                      service_name: services.find(s => s.service_id === item.service_id)?.service_name || 'Unknown Service',
                      total: item.quantity * item.unit_price
                    }))
                  }
                />
              )}

              {/* Manual items section */}
              <div>
                <h3 className="text-sm font-medium mb-2">
                  {invoice && !invoice.is_manual ? 'Manual Line Items' : 'Line Items'}
                </h3>
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <LineItem
                      key={index}
                      item={item}
                      index={index}
                      isExpanded={expandedItems.has(index)}
                      serviceOptions={serviceOptions}
                      onRemove={() => handleRemoveItem(index)}
                      onChange={(field, value) => handleItemChange(index, field as keyof InvoiceItem, value)}
                      onToggleExpand={() => {
                        const newExpanded = new Set(expandedItems);
                        if (newExpanded.has(index)) {
                          newExpanded.delete(index);
                        } else {
                          newExpanded.add(index);
                        }
                        setExpandedItems(newExpanded);
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center">
                <Button
                  id='add-item-button'
                  type="button"
                  onClick={handleAddItem}
                  variant="secondary"
                >
                  Add Line Item
                </Button>
                <div className="text-lg font-semibold">
                  Total: ${(calculateTotal() / 100).toFixed(2)}
                </div>
              </div>

              <Button
                id='save-changes-button'
                type="submit"
                disabled={isGenerating || (!invoice && !selectedCompany) || items.some(item => !item.service_id)}
                className="w-full"
              >
                {getButtonText()}
              </Button>
            </form>
          </>
        )}
      </div>
    </Card>
  );
};

const ManualInvoices: React.FC<ManualInvoicesProps> = (props) => {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => {
        window.location.reload();
      }}
    >
      <ManualInvoicesContent {...props} />
    </ErrorBoundary>
  );
};

export default ManualInvoices;
