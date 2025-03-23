import React, { useState, useEffect } from 'react';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { updateInvoiceManualItems, getInvoiceLineItems } from 'server/src/lib/actions/invoiceActions';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LineItem, ServiceOption } from './LineItem';
import { CompanyPicker } from '../companies/CompanyPicker';
import { ICompany } from '../../interfaces';
import { ErrorBoundary } from 'react-error-boundary';
import { IService } from '../../interfaces/billing.interfaces';
import { InvoiceViewModel, DiscountType } from 'server/src/interfaces/invoice.interfaces';
import type { JSX } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { PlusIcon, MinusCircleIcon } from 'lucide-react';

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
  is_discount?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
}

interface ManualInvoicesProps {
  companies: ICompany[];
  services: ServiceWithRate[];
  onGenerateSuccess: () => void;
  invoice?: InvoiceViewModel;
}

interface EditableInvoiceItem extends InvoiceItem {
  item_id?: string;
  isExisting?: boolean;
  isRemoved?: boolean;
  invoice_number?: string;
}

const defaultItem: EditableInvoiceItem = {
  service_id: '',
  quantity: 1,
  description: '',
  rate: 0,
  is_discount: false,
  isExisting: false,
  isRemoved: false,
  invoice_number: ''
};


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
}) => {
  const [selectedCompany, setSelectedCompany] = useState<string | null>(
    invoice?.company_id || null
  );
  const [invoiceNumber, setInvoiceNumber] = useState<string>(invoice?.invoice_number || '');

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
            description: item.description,
            isDiscount: item.is_discount
          });
          return item.is_manual;
        })
        .map(item => {
          const mappedItem: EditableInvoiceItem = {
            item_id: item.item_id,
            service_id: item.service_id || '',
            quantity: item.quantity,
            description: item.description,
            rate: item.unit_price,
            is_discount: !!item.is_discount,
            discount_type: item.is_discount ? (item.discount_type || 'fixed' as DiscountType) : undefined,
            applies_to_item_id: item.applies_to_item_id,
            isExisting: true,
            isRemoved: false
          };
          return mappedItem;
        });

      console.log('Found manual items:', manualItems.length);

      // For new invoices or when no manual items exist, add empty item
      if (manualItems.length === 0) {
        return [defaultItem];
      }

      return manualItems;
    }
    
    // New manual invoice
    return [defaultItem];
  });
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [loading, setLoading] = useState(false);
  const [isPrepayment, setIsPrepayment] = useState(false);
  const [expirationDate, setExpirationDate] = useState<string>('');
  const [itemsChanged, setItemsChanged] = useState(false);

  // Fetch invoice items when invoice changes
  useEffect(() => {
    const fetchItems = async () => {
      if (invoice) {
        try {
          setLoading(true);
          const items = await getInvoiceLineItems(invoice.invoice_id);
          // Update the invoice with fetched items
          invoice.invoice_items = items;
          // Re-initialize items state with fetched data
          setItems(items.filter(item => item.is_manual).map(item => {
            console.log('Loading item:', {
              id: item.item_id,
              isManual: item.is_manual,
              isDiscount: item.is_discount,
              description: item.description,
              rate: item.unit_price
            });
            
            return {
              item_id: item.item_id,
              service_id: item.service_id || '',
              quantity: item.quantity,
              description: item.description,
              rate: item.unit_price,
              is_discount: !!item.is_discount,
              discount_type: item.is_discount ? (item.discount_type || 'fixed' as DiscountType) : undefined,
              applies_to_item_id: item.applies_to_item_id,
              isExisting: true,
              isRemoved: false
            };
          }));
        } catch (error) {
          console.error('Error loading invoice items:', error);
          setError('Error loading invoice items');
        } finally {
          setLoading(false);
        }
      }
    };

    fetchItems();
  }, [invoice?.invoice_id]);

  const handleAddItem = (isDiscount: boolean = false) => {
    const newItem: EditableInvoiceItem = {
      ...defaultItem,
      is_discount: isDiscount,
      discount_type: isDiscount ? ('fixed' as DiscountType) : undefined,
      rate: 0,
      quantity: 1,
      description: isDiscount ? 'Discount' : ''
    };
    const newItems = [...items, newItem];
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

  const handleItemChange = (index: number, field: string, value: string | number | boolean) => {
    console.log('Changing item:', {
      index,
      field,
      value,
      item: items[index]
    });

    const newItems = [...items];
    const currentItem = { ...newItems[index] };

    switch (field) {
      case 'service_id': {
        const service = services.find(s => s.service_id === value);
        if (!service) {
          if (IS_DEVELOPMENT) {
            console.warn(`Service not found for ID: ${value}`);
          }
          currentItem.service_id = value as string;
        } else {
          // Always update rate when service changes
          currentItem.service_id = value as string;
          currentItem.rate = service.rate;
          currentItem.description = service.service_name; // Optionally pre-fill description
        }
        break;
      }
      case 'discount_type': {
        const oldType = currentItem.discount_type;
        const newType = value as DiscountType;
        currentItem.discount_type = newType;
        
        // Handle conversion between percentage and fixed amount
        if (oldType !== newType) {
          if (newType === 'percentage') {
            // Convert fixed amount to percentage
            if (currentItem.applies_to_item_id) {
              // Find the item this discount applies to
              const appliedToItem = items.find(item => item.item_id === currentItem.applies_to_item_id);
              if (appliedToItem) {
                const totalAmount = appliedToItem.rate * appliedToItem.quantity;
                if (totalAmount > 0) {
                  // Calculate percentage based on the current fixed amount
                  const percentage = Math.abs(currentItem.rate) * 100 / totalAmount;
                  currentItem.discount_percentage = Math.min(percentage, 100);
                } else {
                  currentItem.discount_percentage = 0;
                }
              }
            } else {
              // For invoice-level discounts, use a default percentage
              currentItem.discount_percentage = 10; // Default to 10%
            }
            // Keep the rate at 0 for percentage discounts
            currentItem.rate = 0;
          } else {
            // Convert percentage to fixed amount
            if (currentItem.discount_percentage) {
              if (currentItem.applies_to_item_id) {
                // Find the item this discount applies to
                const appliedToItem = items.find(item => item.item_id === currentItem.applies_to_item_id);
                if (appliedToItem) {
                  const totalAmount = appliedToItem.rate * appliedToItem.quantity;
                  // Calculate fixed amount based on percentage
                  currentItem.rate = -Math.abs((currentItem.discount_percentage / 100) * totalAmount);
                }
              } else {
                // For invoice-level discounts, we'll need to calculate based on subtotal
                // For now, set a nominal value that will be adjusted when saved
                currentItem.rate = -Math.abs(currentItem.discount_percentage);
              }
            } else {
              // Default to a small fixed amount if no percentage was set
              currentItem.rate = -1000; // $10.00
            }
            // Clear the percentage for fixed discounts
            currentItem.discount_percentage = undefined;
          }
        }
        break;
      }
      case 'quantity':
        currentItem.quantity = value as number;
        break;
      case 'rate':
        currentItem.rate = value as number;
        break;
      case 'description':
        currentItem.description = value as string;
        break;
      case 'is_discount':
        currentItem.is_discount = value as boolean;
        break;
      case 'applies_to_item_id':
        currentItem.applies_to_item_id = value as string;
        break;
      case 'invoice_number':
        if (invoice) {
          invoice.invoice_number = value as string;
        }
        setInvoiceNumber(value as string);
        break;
    }

    newItems[index] = currentItem;
    setItems(newItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
      if (!invoice && selectedCompany === null) {
      setError('Please select a company');
      return;
    }

    const nonRemovedItems = items.filter(item => !item.isRemoved);
    if (nonRemovedItems.some(item => !item.is_discount && !item.service_id)) {
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
          invoice_number: invoice.invoice_number,
          newItems: newItems.map(({
            service_id, description, quantity, rate, is_discount, discount_type, applies_to_item_id, discount_percentage
          }) => {
            console.log('Preparing new item for save:', {
              is_discount,
              discount_type,
              discount_percentage,
              rate
            });
            
            return {
              service_id,
              description,
              quantity,
              rate,
              is_discount: is_discount || false,
              discount_type,
              applies_to_item_id,
              discount_percentage,
              item_id: uuidv4(),
              invoice_id: invoice.invoice_id,
              unit_price: is_discount && discount_type === 'percentage' ? 0 : rate,
              total_price: is_discount && discount_type === 'percentage' ? 0 : quantity * rate,
              tax_amount: 0,
              is_manual: true,
              is_taxable: false,
              net_amount: is_discount && discount_type === 'percentage' ? 0 : quantity * rate
            };
          }),
          updatedItems: updatedItems.map(({
            item_id, service_id, description, quantity, rate, is_discount, discount_type, applies_to_item_id, discount_percentage
          }) => {
            console.log('Preparing updated item for save:', {
              item_id,
              is_discount,
              discount_type,
              discount_percentage,
              rate
            });
            
            return {
              item_id: item_id!,
              service_id,
              description,
              quantity,
              rate,
              is_discount: is_discount || false,
              discount_type,
              discount_percentage,
              applies_to_item_id,
              invoice_id: invoice.invoice_id,
              unit_price: is_discount && discount_type === 'percentage' ? 0 : rate,
              total_price: is_discount && discount_type === 'percentage' ? 0 : quantity * rate,
              tax_amount: 0,
              is_manual: true,
              is_taxable: false
            };
          }),
          removedItemIds
        });
        
        // Reset state after successful save
        setItemsChanged(false);
        setExpandedItems(new Set());
        
        // Refresh items from server to ensure we have the latest state
        const refreshedItems = await getInvoiceLineItems(invoice.invoice_id);
        setItems(refreshedItems.filter(item => item.is_manual).map(item => ({
          item_id: item.item_id,
          service_id: item.service_id || '',
          quantity: item.quantity,
          description: item.description,
          rate: item.unit_price,
          is_discount: !!item.is_discount,
          discount_type: item.is_discount ? (item.discount_type || 'fixed' as DiscountType) : undefined,
          discount_percentage: item.discount_percentage,
          applies_to_item_id: item.applies_to_item_id,
          isExisting: true,
          isRemoved: false
        })));
      } else {
        console.log('Generating new manual invoice:', {
          companyId: selectedCompany || '',
          itemCount: items.filter(item => !item.isRemoved).length
        });

        await generateManualInvoice({
          companyId: selectedCompany || '',
          isPrepayment,
          expirationDate: isPrepayment ? expirationDate : undefined,
          items: items.filter(item => !item.isRemoved).map(({
            service_id, description, quantity, rate, is_discount, discount_type, applies_to_item_id, discount_percentage
          }) => {
            console.log('Preparing new manual invoice item:', {
              is_discount,
              discount_type,
              discount_percentage,
              rate
            });
            
            return {
              service_id,
              description,
              quantity,
              rate,
              is_discount: is_discount || false,
              discount_type,
              applies_to_item_id,
              discount_percentage,
              item_id: uuidv4(),
              // Add missing required properties with default values
              invoice_id: '', // Will be assigned by the server
              unit_price: is_discount && discount_type === 'percentage' ? 0 : rate,
              total_price: is_discount && discount_type === 'percentage' ? 0 : quantity * rate,
              tax_amount: 0,
              is_manual: true,
              is_taxable: false
            };
          })
        });
        
        // Reset state after successful save
        setItemsChanged(false);
        onGenerateSuccess();
      }
      
      // Success - stay on the page
    } catch (err: unknown) {
      if (IS_DEVELOPMENT) {
        console.error('Error with invoice:', err);
      }
      
      let errorMessage = `Error ${invoice ? 'updating' : 'generating'} invoice`;
      
      if (err instanceof Error) {
        // Extract the specific error message
        const message = err.message;
        
        // Handle specific error types
        if (message === 'Invoice number must be unique') {
          errorMessage = 'This invoice number is already in use. Please choose a different number.';
        } else if (message.includes('No active tax rate found for region')) {
          errorMessage = `No tax rate is configured for the selected region. Please add a tax rate for this region in the Tax Rates tab.`;
        } else if (message.includes('Service not found')) {
          errorMessage = `The selected service could not be found. It may have been deleted or deactivated.`;
        } else if (message.includes('Cannot modify a paid or cancelled invoice')) {
          errorMessage = `This invoice cannot be modified because it has already been paid or cancelled.`;
        } else {
          // Use the actual error message for other cases
          errorMessage = message;
        }
      }
      
      setError(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const serviceOptions: ServiceOption[] = services.map((service): ServiceOption => ({
    value: service.service_id,
    label: service.service_name,
    rate: service.rate
  }));

  const calculateTotal = () => {
    const nonDiscountItems = items.filter(item => !item.isRemoved && !item.is_discount);
    const discountItems = items.filter(item => !item.isRemoved && item.is_discount);
    
    // Calculate subtotal from non-discount items
    const subtotal = nonDiscountItems.reduce((sum, item) => {
      return sum + (item.quantity * item.rate);
    }, 0);
    
    // Apply discounts to the subtotal
    let total = subtotal;
    for (const item of discountItems) {
      if (item.discount_type === 'percentage') {
        // For percentage discounts, calculate based on applicable amount
        const applicableAmount = item.applies_to_item_id
          ? (() => {
              const targetItem = nonDiscountItems.find(i => i.item_id === item.applies_to_item_id);
              return targetItem ? targetItem.quantity * targetItem.rate : 0;
            })()
          : subtotal;
        
        const percentage = item.discount_percentage || Math.abs(item.rate);
        total -= (applicableAmount * percentage) / 100;
      } else {
        // For fixed discounts, use the stored negative amount
        total += item.quantity * item.rate;
      }
    }
    
    return Math.round(total);
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
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-lg font-semibold">
                {invoice ? 'Invoice Details' : 'Generate Manual Invoice'}
              </h2>
            </div>

            {/* Company Name */}
            {invoice && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company
                </label>
                <div className="text-gray-900">
                  {companies.find(c => c.company_id === invoice.company_id)?.company_name || 'Unknown Company'}
                </div>
              </div>
            )}

            {/* Invoice Number field - moved to top */}
            {invoice && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invoice Number
                </label>
                <input
                  type="text"
                  value={invoice.invoice_number}
                  onChange={(e) => handleItemChange(-1, 'invoice_number', e.target.value)}
                  className="border rounded-md px-3 py-2 w-full max-w-xs shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}

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

              {/* For new invoices, place invoice number field after company selection */}
              {!invoice && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Invoice Number
                  </label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => handleItemChange(-1, 'invoice_number', e.target.value)}
                    className="border rounded-md px-3 py-2 w-full max-w-xs shadow-sm focus:ring-blue-500 focus:border-blue-500"
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


              {/* Prepayment and Expiration Date fields */}
              {!invoice && (
                <div className="mb-6 space-y-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="is-prepayment"
                      checked={isPrepayment}
                      onChange={(e) => setIsPrepayment(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="is-prepayment" className="ml-2 block text-sm text-gray-700">
                      This is a prepayment invoice (creates credit)
                    </label>
                  </div>
                  
                  {isPrepayment && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Credit Expiration Date
                      </label>
                      <div className="flex items-center">
                        <input
                          type="date"
                          value={expirationDate}
                          onChange={(e) => setExpirationDate(e.target.value)}
                          className="border rounded-md px-3 py-2 w-full max-w-xs shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        />
                        <div className="ml-2 text-sm text-gray-500">
                          Leave blank for no expiration or to use default expiration period
                        </div>
                      </div>
                    </div>
                  )}
                </div>
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
                      invoiceItems={items
                        .filter(i => !i.is_discount && !i.isRemoved)
                        .map(i => ({
                          item_id: i.item_id || uuidv4(),
                          description: i.description
                        }))}
                      onRemove={() => handleRemoveItem(index)}
                      onChange={(updatedItem) => {
                        const newItems = [...items];
                        newItems[index] = updatedItem;
                        setItems(newItems);
                      }}
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
                <div className="flex gap-2">
                  <Button
                    id='add-line-item-button'
                    type="button"
                    onClick={() => handleAddItem(false)}
                    variant="secondary"
                  >
                    <PlusIcon className="w-4 h-4 mr-2" />
                    Add Charge
                  </Button>
                  <Button
                    id='add-discount-button'
                    type="button"
                    onClick={() => handleAddItem(true)}
                    variant="secondary"
                  >
                    <MinusCircleIcon className="w-4 h-4 mr-2" />
                    Add Discount
                  </Button>
                </div>
                <div className="text-lg font-semibold">
                  Total: ${(calculateTotal() / 100).toFixed(2)}
                </div>
              </div>

              <Button
                id='save-changes-button'
                type="submit"
                disabled={isGenerating || (!invoice && !selectedCompany) || items.some(item => !item.is_discount && !item.service_id)}
                className="px-4"
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
