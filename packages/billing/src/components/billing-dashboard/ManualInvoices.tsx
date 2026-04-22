'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { generateManualInvoice } from '@alga-psa/billing/actions';
import { updateInvoiceManualItems } from '@alga-psa/billing/actions/invoiceModification';
import { getInvoiceLineItems } from '@alga-psa/billing/actions/invoiceQueries';
import type { ManualInvoiceUpdate } from '@alga-psa/billing/actions/invoiceActions'; // Import the specific type
import type { ManualInvoiceItem as ManualInvoiceItemForAction } from '@alga-psa/billing/actions'; // Import and alias
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Card } from '@alga-psa/ui/components/Card';
import { LineItem, ServiceOption, EditableItem as LineItemEditableItem } from './LineItem'; // Import EditableItem type from LineItem
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import type { IClient } from '@alga-psa/types';
import { ErrorBoundary } from 'react-error-boundary';
import type { IService } from '@alga-psa/types';
import { InvoiceViewModel, DiscountType, IInvoiceCharge } from '@alga-psa/types';
import type { JSX } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { PlusIcon, MinusCircleIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Use a constant for environment check since process.env is not available
const IS_DEVELOPMENT = typeof window !== 'undefined' &&
  globalThis.window.location.hostname === 'localhost';

interface SelectOption {
  value: string;
  label: string;
}

interface ManualInvoicesProps {
  clients: IClient[];
  services: IService[];
  onGenerateSuccess: () => void;
  invoice?: InvoiceViewModel;
}

// This is the primary state type for manual items within this component
// Reverted: Keep is_taxable, remove tax_rate_id
interface EditableInvoiceItem extends Omit<IInvoiceCharge, 'tenant' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by' | 'tax_region' | 'tax_rate' | 'tax_amount' | 'net_amount' | 'total_price' | 'unit_price'> {
  rate: number; // Represents unit_price for editing (in cents)
  // tax_rate_id?: string | null; // Removed
  is_taxable?: boolean; // Add is_taxable back to the interface
  isExisting?: boolean;
  isRemoved?: boolean;
  is_bundle_header?: boolean;
}

// Base structure for a default item, ensuring required fields for EditableInvoiceItem are present
const baseDefaultItem: Omit<EditableInvoiceItem, 'invoice_id'> = {
  item_id: '', // Will be replaced by uuidv4() when used
  service_id: '',
  quantity: 1,
  description: '',
  rate: 0, // Represents unit_price in cents
  is_discount: false,
  is_manual: true,
  isExisting: false,
  isRemoved: false,
  is_taxable: false, // Default to non-taxable until a service with tax_rate_id is selected
  // tax_rate_id: null, // Removed
  discount_type: undefined,
  discount_percentage: undefined,
  applies_to_item_id: undefined,
  applies_to_service_id: undefined,
  client_contract_id: undefined,
  contract_name: undefined,
  is_bundle_header: undefined as any,
  parent_item_id: undefined,
};


const AutomatedItemsTable: React.FC<{
  items: Array<{
    service_name: string;
    total: number; // Should be total_price from IInvoiceCharge (in cents)
  }>;
  currencyCode?: string;
}> = ({ items, currencyCode = 'USD' }) => {
  const { t } = useTranslation('msp/invoicing');
  const { formatCurrency } = useFormatters();
  console.log('[Render] Rendering automated items table:', {
    count: items.length,
    items: items.map(item => ({
      service: item.service_name,
      total: item.total
    }))
  });

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium mb-2">
        {t('manualInvoices.automatedItems.title', { defaultValue: 'Automated Line Items' })}
      </h3>
      <table className="w-full">
        <thead className="text-sm text-muted-foreground">
          <tr>
            <th className="text-left py-2">
              {t('manualInvoices.automatedItems.service', { defaultValue: 'Service' })}
            </th>
            <th className="text-right py-2">
              {t('manualInvoices.automatedItems.total', { defaultValue: 'Total' })}
            </th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {items.map((item, i) => (
            <tr key={i} className="border-t">
              <td className="py-2">{item.service_name}</td>
              {/* Display total_price */}
              <td className="text-right">{formatCurrency(item.total / 100, currencyCode)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  const { t } = useTranslation('msp/invoicing');

  return (
    <Alert variant="destructive" className="p-4">
      <AlertDescription>
        <h2 className="text-lg font-semibold">
          {t('manualInvoices.errorFallback.title', { defaultValue: 'Something went wrong' })}:
        </h2>
        <pre className="mt-2 text-sm">{error.message}</pre>
        <Button
          id='try-again-button'
          onClick={resetErrorBoundary}
          className="mt-4"
          variant="secondary"
        >
          {t('manualInvoices.errorFallback.retry', { defaultValue: 'Try again' })}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

const ManualInvoicesContent: React.FC<ManualInvoicesProps> = ({
  clients,
  services,
  onGenerateSuccess,
  invoice, // This is the initial invoice prop
}) => {
  const { t } = useTranslation('msp/invoicing');
  const { formatCurrency } = useFormatters();
  const { renderQuickAddClient } = useQuickAddClient();
  const [clientOptions, setClientOptions] = useState<IClient[]>(clients);
  const [selectedClient, setSelectedClient] = useState<string | null>(
    invoice?.client_id || null
  );
  // State to hold the full invoice data, initialized from prop but updated locally after fetch/changes
  const [currentInvoiceData, setCurrentInvoiceData] = useState<InvoiceViewModel | undefined>(invoice);
  // State specifically for the manual items being edited
  const [items, setItems] = useState<EditableInvoiceItem[]>(() => {
    const LEGACY_HEADER_KEY = ('is_bundle_header') as keyof any;
    const normalizeHeaderAlias = (it: any) => ({
      ...it,
      is_bundle_header: it?.is_bundle_header ?? (it as any)[LEGACY_HEADER_KEY]
    });
    const initialManualItems = invoice?.invoice_charges?.filter(item => item.is_manual) || [];
    const mappedItems = initialManualItems.map((item): EditableInvoiceItem => {
      const i = normalizeHeaderAlias(item as any);
      return ({
        item_id: item.item_id,
        invoice_id: item.invoice_id,
        service_id: item.service_id || '',
        quantity: item.quantity,
        description: item.description,
        rate: item.unit_price, // Use unit_price for editing rate
        is_discount: !!item.is_discount,
        discount_type: item.is_discount ? (item.discount_type || 'fixed' as DiscountType) : undefined,
        discount_percentage: item.discount_percentage,
        applies_to_item_id: item.applies_to_item_id,
        applies_to_service_id: item.applies_to_service_id,
        client_contract_id: item.client_contract_id,
        contract_name: item.contract_name,
        is_bundle_header: (i as any).is_bundle_header,
        parent_item_id: item.parent_item_id,
        is_manual: true,
        is_taxable: item.is_taxable, // Include is_taxable from the item
        // tax_rate_id: item.tax_rate_id || null, // Removed
        isExisting: true,
        isRemoved: false,
      });
    });
    // Ensure the default item gets a unique ID if added
    return mappedItems.length > 0 ? mappedItems : [{
      ...baseDefaultItem,
      item_id: uuidv4(), // Add ID here
      invoice_id: invoice?.invoice_id || ''
    }];
  });

  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [loading, setLoading] = useState(false);
  const [isPrepayment, setIsPrepayment] = useState(false);
  const [expirationDate, setExpirationDate] = useState<string>('');
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const translateManualInvoiceError = (message: string, mode: 'update' | 'generate'): string => {
    if (message === 'Invoice number must be unique') {
      return t('manualInvoices.errors.invoiceNumberUnique', {
        defaultValue: 'This invoice number is already in use.',
      });
    }

    if (message.includes('No active tax rate')) {
      return t('manualInvoices.errors.noTaxRateConfigured', {
        defaultValue: 'No tax rate configured for the region.',
      });
    }

    if (message.includes('Service not found')) {
      return t('manualInvoices.errors.serviceNotFound', {
        defaultValue: 'Selected service not found.',
      });
    }

    if (message.includes('Cannot modify')) {
      return t('manualInvoices.errors.cannotModify', {
        defaultValue: 'Invoice cannot be modified (paid/cancelled).',
      });
    }

    if (message === 'Error loading invoice items') {
      return t('manualInvoices.errors.loadItems', {
        defaultValue: 'Error loading invoice items',
      });
    }

    if (message === 'An error occurred while refreshing invoice data.') {
      return t('manualInvoices.errors.refresh', {
        defaultValue: 'An error occurred while refreshing invoice data.',
      });
    }

    return t(`manualInvoices.errors.${mode === 'update' ? 'updateFailed' : 'generateFailed'}`, {
      defaultValue: message,
    });
  };

  useEffect(() => {
    setClientOptions(clients);
  }, [clients]);

  // Effect to fetch items when the invoice prop initially changes
  useEffect(() => {
    const fetchItems = async () => {
      // Use the invoice prop ID for the initial fetch trigger
      const invoiceIdToFetch = invoice?.invoice_id;
      if (invoiceIdToFetch) {
        try {
          console.log('[Effect] Fetching items for:', invoiceIdToFetch);
          setLoading(true);
          const fetchedItems = await getInvoiceLineItems(invoiceIdToFetch);
          const LEGACY_HEADER_KEY = ('is_bundle_header') as keyof any;
          const normalizeHeaderAlias = (it: any) => ({
            ...it,
            is_bundle_header: it?.is_bundle_header ?? (it as any)[LEGACY_HEADER_KEY]
          });
          console.log('[Effect] Fetched items:', fetchedItems.length);

          // Update local state with fetched items
          setCurrentInvoiceData(prevData => {
            const baseData = prevData || invoice;
            return baseData ? { ...baseData, invoice_charges: fetchedItems } : undefined;
          });
          console.log('[Effect] Updated currentInvoiceData state with fetched items');

          // Also update the manual items state based on the fetched data
          const manualItemsFromFetch = fetchedItems.filter(item => item.is_manual);
          console.log('[Effect] Setting manual items state from fetch:', manualItemsFromFetch.length);
          const mappedManualItems = manualItemsFromFetch.map((item): EditableInvoiceItem => {
            const i = normalizeHeaderAlias(item as any);
            return {
              item_id: item.item_id,
              invoice_id: item.invoice_id,
              service_id: item.service_id || '',
              quantity: item.quantity,
              description: item.description,
              rate: item.unit_price,
              is_discount: !!item.is_discount,
              discount_type: item.is_discount ? (item.discount_type || 'fixed' as DiscountType) : undefined,
              discount_percentage: item.discount_percentage,
              applies_to_item_id: item.applies_to_item_id,
              applies_to_service_id: item.applies_to_service_id,
              client_contract_id: item.client_contract_id,
              contract_name: item.contract_name,
              is_bundle_header: (i as any).is_bundle_header,
              parent_item_id: item.parent_item_id,
              is_manual: true,
              is_taxable: item.is_taxable,
              isExisting: true,
              isRemoved: false,
            };
          });
          // Ensure the default item gets a unique ID if added after fetch
          setItems(mappedManualItems.length > 0 ? mappedManualItems : [{
            ...baseDefaultItem,
            item_id: uuidv4(), // Add ID here
            invoice_id: invoiceIdToFetch
          }]);

        } catch (error) {
          console.error('Error loading invoice items:', error);
          setError(t('manualInvoices.errors.loadItems', {
            defaultValue: 'Error loading invoice items',
          }));
        } finally {
          setLoading(false);
        }
      } else {
        // Reset local state if invoice prop becomes null/undefined
        setCurrentInvoiceData(undefined);
        // Ensure the default item gets a unique ID when resetting
        setItems([{
          ...baseDefaultItem,
          item_id: uuidv4(), // Add ID here
          invoice_id: ''
        }]);
      }
    };

    fetchItems();
    // Run effect only when the invoice prop itself changes
  }, [invoice]);

  const handleAddItem = (isDiscount: boolean = false) => {
    const newItem: EditableInvoiceItem = {
      ...baseDefaultItem,
      invoice_id: currentInvoiceData?.invoice_id || '',
      item_id: uuidv4(), // Generate ID for the new item
      is_discount: isDiscount,
      discount_type: isDiscount ? ('fixed' as DiscountType) : undefined,
      rate: 0,
      quantity: 1,
      description: isDiscount ? 'Discount' : '',
      isExisting: false, // Mark as new
    };
    const newItems = [...items, newItem];
    setItems(newItems);
    setExpandedItems(new Set([newItems.length - 1]));
  };

  const handleRemoveItem = (index: number) => {
    console.log('Removing/restoring item:', { index, item: items[index] });
    const newItems = [...items];
    if (newItems[index].isExisting) {
      newItems[index] = { ...newItems[index], isRemoved: !newItems[index].isRemoved };
      setItems(newItems);
    } else {
      newItems.splice(index, 1);
      setItems(newItems);
      const newExpanded = new Set(expandedItems);
      newExpanded.delete(index);
      const adjustedExpanded = new Set<number>();
      newExpanded.forEach(i => {
        if (i < index) adjustedExpanded.add(i);
        else if (i > index) adjustedExpanded.add(i - 1);
      });
      setExpandedItems(adjustedExpanded);
    }
  };

  // Handles changes from the LineItem component OR the invoice number input
  const handleItemChange = (index: number, field: keyof LineItemEditableItem | 'invoice_number', value: string | number | boolean | undefined) => {
    console.log('Changing item/invoice:', { index, field, value });

    if (field === 'invoice_number') {
      setCurrentInvoiceData(prevData => prevData ? { ...prevData, invoice_number: value as string } : undefined);
      return;
    }

    // Handle changes to items array from LineItem's onChange
    const newItems = [...items];
    if (index < 0 || index >= newItems.length) return;

    // Merge the changed fields from LineItemEditableItem into our full EditableInvoiceItem
    // Ensure the field exists on EditableInvoiceItem before assigning
    const fieldName = field as keyof EditableInvoiceItem;
    if (fieldName in newItems[index]) {
        // Create a new object for the updated item
        const updatedItem: EditableInvoiceItem = {
            ...newItems[index],
            [fieldName]: value,
        };

        // Add specific logic if needed based on the field changed
        if (fieldName === 'is_discount') {
            if (value === false) {
                updatedItem.discount_type = undefined;
                updatedItem.discount_percentage = undefined;
                updatedItem.applies_to_item_id = undefined;
            } else if (value === true && !updatedItem.discount_type) {
                updatedItem.discount_type = 'fixed'; // Default to fixed if switching on
            }
        } else if (fieldName === 'discount_type') {
            if (value === 'percentage') {
                updatedItem.rate = 0; // Rate is not directly used for percentage discounts in editor
            } else if (value === 'fixed') {
                updatedItem.discount_percentage = undefined; // Clear percentage if switching to fixed
            }
        }

        newItems[index] = updatedItem;
        setItems(newItems);
    } else {
        console.warn(`Attempted to change unhandled field '${String(field)}' on EditableInvoiceItem`);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentInvoiceData && selectedClient === null) {
      setError(t('manualInvoices.errors.selectClient', {
        defaultValue: 'Please select a client',
      }));
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Updating an existing invoice
      if (currentInvoiceData) {
        console.log('[Submit] Updating invoice items:', {
            invoiceId: currentInvoiceData.invoice_id,
            newCount: items.filter(i => !i.isExisting && !i.isRemoved).length,
            updatedCount: items.filter(i => i.isExisting && !i.isRemoved).length,
            removedCount: items.filter(i => i.isRemoved).length
        });

        const newItemsToSave = items.filter(item => !item.isExisting && !item.isRemoved);
        const updatedItemsToSave = items.filter(item => item.isExisting && !item.isRemoved && item.item_id);
        const removedItemIds = items
          .filter(item => item.isExisting && item.isRemoved && item.item_id)
          .map(item => item.item_id!); // item_id is guaranteed here by filter

        // Map EditableInvoiceItem to IInvoiceCharge for newItems
        const mapToNewItemSaveFormat = (item: EditableInvoiceItem): IInvoiceCharge => ({
          item_id: item.item_id || uuidv4(), // Ensure ID exists
          invoice_id: item.invoice_id,
          tenant: '', // Backend handles tenant
          service_id: item.service_id || undefined,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.rate,
          total_price: 0, // Calculated backend
          tax_amount: 0, // Calculated backend
          net_amount: 0, // Calculated backend
          is_manual: true,
          is_taxable: item.is_taxable, // Include is_taxable property
          // tax_rate_id: item.tax_rate_id, // Removed
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          discount_percentage: item.discount_percentage,
          applies_to_item_id: item.applies_to_item_id,
          // Include other potentially relevant fields from IInvoiceCharge if needed by backend logic
          applies_to_service_id: item.applies_to_service_id,
          client_contract_id: item.client_contract_id,
          contract_name: item.contract_name,
          is_bundle_header: item.is_bundle_header as any,
          parent_item_id: item.parent_item_id,
          rate: item.rate, // Add the missing rate property
          // Omit audit fields
        });

        // Map EditableInvoiceItem to ManualInvoiceUpdate for updatedItems
        const mapToUpdateSaveFormat = (item: EditableInvoiceItem): ManualInvoiceUpdate => ({
          item_id: item.item_id!, // item_id is required
          service_id: item.service_id || undefined,
          description: item.description,
          quantity: item.quantity,
          rate: item.rate, // Pass the rate (unit_price in cents)
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          discount_percentage: item.discount_percentage,
          applies_to_item_id: item.applies_to_item_id,
          is_taxable: item.is_taxable, // Include is_taxable property
          // tax_rate_id: item.tax_rate_id, // Removed
        });

        await updateInvoiceManualItems(currentInvoiceData.invoice_id, {
          invoice_number: currentInvoiceData.invoice_number,
          newItems: newItemsToSave.map(mapToNewItemSaveFormat),
          updatedItems: updatedItemsToSave.map(mapToUpdateSaveFormat),
          removedItemIds
        });

        setExpandedItems(new Set());

        if (!currentInvoiceData) {
          console.error('[Submit] Cannot refresh items: currentInvoiceData became undefined after update.');
          setError(t('manualInvoices.errors.refresh', {
            defaultValue: 'An error occurred while refreshing invoice data.',
          }));
          setIsGenerating(false);
          return;
        }
        // Refresh items from server
        const refreshedItems = await getInvoiceLineItems(currentInvoiceData.invoice_id);
        console.log('[Submit] Refreshed items after update:', refreshedItems.length);
        
        // Fetch the updated invoice data from the server
        // We need to create a new object with updated values since we don't have a direct way to get the full invoice
        const updatedInvoiceData = {
          ...currentInvoiceData,
          invoice_charges: refreshedItems
        };
        
        // Update the state with the refreshed data
        setCurrentInvoiceData(updatedInvoiceData);
        console.log('[Submit] Updated currentInvoiceData state with refreshed items');

        // Update manual items state from the refreshed items
        const manualItemsFromRefresh = refreshedItems.filter((item: IInvoiceCharge) => item.is_manual);
        console.log('[Submit] Setting manual items state from refreshed items:', manualItemsFromRefresh.length);
        const mappedUpdatedManual = manualItemsFromRefresh.map((item: IInvoiceCharge): EditableInvoiceItem => ({
            item_id: item.item_id,
            invoice_id: item.invoice_id,
            service_id: item.service_id || '',
            quantity: item.quantity,
            description: item.description,
            rate: item.unit_price,
            is_discount: !!item.is_discount,
            discount_type: item.is_discount ? (item.discount_type || 'fixed' as DiscountType) : undefined,
            discount_percentage: item.discount_percentage,
            applies_to_item_id: item.applies_to_item_id,
            applies_to_service_id: item.applies_to_service_id,
            client_contract_id: item.client_contract_id,
            contract_name: item.contract_name,
            is_bundle_header: item.is_bundle_header as any,
            parent_item_id: item.parent_item_id,
            is_manual: true,
            is_taxable: item.is_taxable, // Include is_taxable from the item
            isExisting: true,
            isRemoved: false,
        }));
        setItems(mappedUpdatedManual.length > 0 ? mappedUpdatedManual : [{
            ...baseDefaultItem,
            item_id: uuidv4(),
            invoice_id: currentInvoiceData.invoice_id
        }]);
        onGenerateSuccess(); // Notify parent about successful update

      } else {
        // Generating a NEW manual invoice
        console.log('[Submit] Generating new manual invoice:', { /* ... */ });

        // Map EditableInvoiceItem to ManualInvoiceItemForAction
        const itemsToSave = items.filter(item => !item.isRemoved).map((item): ManualInvoiceItemForAction => ({
          service_id: item.service_id || '', // Ensure string
          description: item.description,
          quantity: item.quantity,
          rate: item.rate, // Pass rate (unit_price in cents)
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          applies_to_item_id: item.applies_to_item_id,
          // applies_to_service_id is not in ManualInvoiceItemForAction
        }));

        const newInvoiceNumberInput = document.getElementById('new-invoice-number-input') as HTMLInputElement;
        const newInvoiceNumber = newInvoiceNumberInput?.value || undefined;

        const result = await generateManualInvoice({
          clientId: selectedClient || '',
          // invoiceNumber: newInvoiceNumber, // Remove - ManualInvoiceRequest doesn't have this
          isPrepayment,
          expirationDate: isPrepayment ? expirationDate : undefined,
          items: itemsToSave
        });

        if (!result.success) {
          setError(
            translateManualInvoiceError(
              (result as { success: false; error: string }).error,
              'generate',
            ),
          );
          return;
        }

        onGenerateSuccess(); // Callback to parent
      }

    } catch (err: unknown) {
       if (IS_DEVELOPMENT) console.error('Error with invoice:', err);
       const errorMode = currentInvoiceData ? 'update' : 'generate';
       let errorMessage = t(`manualInvoices.errors.${errorMode === 'update' ? 'updateFailed' : 'generateFailed'}`, {
         defaultValue: `Error ${errorMode === 'update' ? 'updating' : 'generating'} invoice`,
       });
       if (err instanceof Error) {
         errorMessage = translateManualInvoiceError(err.message, errorMode);
       }
       setError(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const calculateManualItemsTotal = () => {
    const nonDiscountItems = items.filter(item => !item.isRemoved && !item.is_discount);
    const discountItems = items.filter(item => !item.isRemoved && item.is_discount);
    const subtotal = nonDiscountItems.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
    let total = subtotal;
    for (const item of discountItems) {
      if (item.discount_type === 'percentage' && item.discount_percentage !== undefined) {
        const applicableAmount = item.applies_to_item_id
          ? (nonDiscountItems.find(i => i.item_id === item.applies_to_item_id)?.quantity || 0) * (nonDiscountItems.find(i => i.item_id === item.applies_to_item_id)?.rate || 0)
          : subtotal;
        total -= (applicableAmount * item.discount_percentage) / 100;
      } else if (item.discount_type === 'fixed') {
        total += item.quantity * item.rate; // Rate is already negative and in cents
      }
    }
    return Math.round(total); // Return total in cents
  };

  const getButtonText = () => {
    if (isGenerating) {
      return t('manualInvoices.actions.processing', { defaultValue: 'Processing...' });
    }

    return currentInvoiceData
      ? t('manualInvoices.actions.saveChanges', { defaultValue: 'Save Changes' })
      : t('manualInvoices.actions.generate', { defaultValue: 'Generate Invoice' });
  };

  const automatedSubtotal = useMemo(() => {
    console.log('[Memo] Recalculating automatedSubtotal. currentInvoiceData:', currentInvoiceData);
    if (!currentInvoiceData || !currentInvoiceData.invoice_charges) return 0;
    const calculatedSubtotal = currentInvoiceData.invoice_charges
      .filter(item => !item.is_manual)
      .reduce((sum, item) => sum + (Number(item.total_price) || 0), 0); // total_price is in cents
    console.log('[Memo] Calculated automatedSubtotal:', calculatedSubtotal);
    return calculatedSubtotal;
  }, [currentInvoiceData?.invoice_charges]);

  // Calculate the total based on the items
  const manualTotal = calculateManualItemsTotal(); // In cents
  console.log('[Render] Calculated manualTotal from items (cents):', manualTotal);
  const calculatedGrandTotal = automatedSubtotal + manualTotal; // Both in cents
  console.log('[Render] Calculated grandTotal from items (cents):', calculatedGrandTotal, '=', automatedSubtotal, '+', manualTotal);
  
  // Log the current invoice data total for comparison
  if (currentInvoiceData) {
    console.log('[Render] Current invoice data total (cents):', currentInvoiceData.total_amount);
    // The difference might help identify discrepancies
    console.log('[Render] Difference between calculated and stored total (cents):', calculatedGrandTotal - currentInvoiceData.total_amount);
  }
  
  console.log('[Render] Rendering ManualInvoicesContent. currentInvoiceData items:', currentInvoiceData?.invoice_charges?.length);

  // Get currency code from invoice data, selected client, or default to USD
  const selectedClientData = clientOptions.find(c => c.client_id === (currentInvoiceData?.client_id || selectedClient));
  const currencyCode = currentInvoiceData?.currencyCode || selectedClientData?.default_currency_code || 'USD';

  const serviceOptions: ServiceOption[] = services
    .filter((service) => service.is_active !== false)
    .map((service): ServiceOption => {
      const currencyRate = service.prices?.find((p) => p.currency_code === currencyCode)?.rate;
      const rate = currencyRate ?? service.default_rate ?? 0;
      const label =
        `${service.item_kind === 'product' ? '[Product] ' : ''}${service.service_name}` +
        (service.sku ? ` (${service.sku})` : '');

      return {
        value: service.service_id,
        label,
        rate: Number(rate) || 0,
        tax_rate_id: service.tax_rate_id ?? null,
      };
    });

  // Helper to prepare item prop for LineItem component
  const mapToLineItemEditable = (item: EditableInvoiceItem): LineItemEditableItem => ({
      item_id: item.item_id,
      service_id: item.service_id || '', // Ensure string
      quantity: item.quantity,
      description: item.description,
      rate: item.rate, // Pass rate in cents
      // tax_rate_id: item.tax_rate_id, // Removed
      // is_taxable removed; derived from selectedService.tax_rate_id
      isExisting: item.isExisting,
      isRemoved: item.isRemoved,
      is_discount: item.is_discount,
      discount_type: item.discount_type,
      discount_percentage: item.discount_percentage,
      applies_to_item_id: item.applies_to_item_id,
  });

  // Adapter for LineItem's onChange prop
  const handleLineItemChange = (index: number, updatedLineItem: LineItemEditableItem) => {
      const newItems = [...items];
      if (index >= 0 && index < newItems.length) {
          // Merge updated fields back into the full EditableInvoiceItem structure
          newItems[index] = {
              ...newItems[index], // Keep existing fields like invoice_id, is_manual etc.
              ...updatedLineItem, // Overwrite with changes from LineItem
          };
          setItems(newItems);
      }
  };


  return (
    <Card>
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[rgb(var(--color-border-900))]"></div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-6">
              <div>
                <h2 className="text-lg font-semibold">
                  {(currentInvoiceData || invoice)
                    ? t('manualInvoices.detailsTitle', { defaultValue: 'Invoice Details' })
                    : t('manualInvoices.title', { defaultValue: 'Generate Manual Invoice' })}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(currentInvoiceData || invoice)
                    ? t('manualInvoices.detailsDescription', {
                      defaultValue: 'Manual edits stay periodless by default, while recurring detail-backed lines keep their canonical service periods.',
                    })
                    : t('manualInvoices.description', {
                      defaultValue: 'Use manual invoices for one-off or adjustment lines. They coexist with recurring invoices without redefining recurring service periods.',
                    })}
                </p>
              </div>
            </div>

            {currentInvoiceData && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  {t('manualInvoices.fields.client', { defaultValue: 'Client' })}
                </label>
                <div className="text-[rgb(var(--color-text-900))]">
                  {clientOptions.find(c => c.client_id === currentInvoiceData.client_id)?.client_name
                    || t('common.labels.unknownClient', { defaultValue: 'Unknown client' })}
                </div>
              </div>
            )}

            {currentInvoiceData && (
              <div className="mb-6">
                <label htmlFor="invoice-number-input" className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  {t('manualInvoices.fields.invoiceNumber', { defaultValue: 'Invoice Number' })}
                </label>
                <input
                  id="invoice-number-input"
                  type="text"
                  value={currentInvoiceData.invoice_number}
                  // Use index -1 to signify changing the invoice number itself
                  onChange={(e) => handleItemChange(-1, 'invoice_number', e.target.value)}
                  className="border rounded-md px-3 py-2 w-full max-w-xs shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {!invoice && !currentInvoiceData && (
                <div>
                  <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                    {t('manualInvoices.fields.client', { defaultValue: 'Client' })}
                  </label>
                  <ClientPicker
                    id='client-picker'
                    clients={clientOptions}
                    selectedClientId={selectedClient}
                    onSelect={setSelectedClient}
                    filterState={filterState}
                    onFilterStateChange={setFilterState}
                    clientTypeFilter={clientTypeFilter}
                    onClientTypeFilterChange={setClientTypeFilter}
                    onAddNew={() => setIsQuickAddClientOpen(true)}
                    placeholder={t('manualInvoices.placeholders.selectClient', {
                      defaultValue: 'Select a client',
                    })}
                  />
                  {renderQuickAddClient({
                    open: isQuickAddClientOpen,
                    onOpenChange: setIsQuickAddClientOpen,
                    onClientAdded: (newClient) => {
                      setClientOptions(prev => [...prev, newClient]);
                      setSelectedClient(newClient.client_id);
                    },
                    skipSuccessDialog: true,
                  })}
                </div>
              )}

              {!invoice && !currentInvoiceData && (
                <div className="mb-6">
                  <label htmlFor="new-invoice-number-input" className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                    {t('manualInvoices.fields.invoiceNumberOptional', {
                      defaultValue: 'Invoice Number (Optional)',
                    })}
                  </label>
                  <input
                    id="new-invoice-number-input"
                    type="text"
                    // Value is not directly controlled here for new invoices; passed to action on submit
                    // onChange={(e) => { /* No direct state update needed here */ }}
                    placeholder={t('manualInvoices.placeholders.invoiceNumberOptional', {
                      defaultValue: 'Leave blank to auto-generate',
                    })}
                    className="border rounded-md px-3 py-2 w-full max-w-xs shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              )}

              {currentInvoiceData && !currentInvoiceData.is_manual && currentInvoiceData.invoice_charges && (
                <AutomatedItemsTable
                  items={currentInvoiceData.invoice_charges
                    .filter(item => !item.is_manual)
                    .map(item => ({
                      service_name:
                        services.find(s => s.service_id === item.service_id)?.service_name
                        || item.description
                        || t('manualInvoices.automatedItems.unknownService', {
                          defaultValue: 'Unknown Service',
                        }),
                      total: item.total_price // Pass total_price (in cents)
                    }))
                  }
                  currencyCode={currencyCode}
                />
              )}

              {!invoice && !currentInvoiceData && (
                <div className="mb-6 space-y-4">
                  <div className="flex items-center">
                    <Checkbox
                      id="is-prepayment"
                      label={t('manualInvoices.prepayment.label', {
                        defaultValue: 'This is a prepayment invoice (creates credit)',
                      })}
                      checked={isPrepayment}
                      onChange={(e) => setIsPrepayment((e.target as HTMLInputElement).checked)}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('manualInvoices.prepayment.description', {
                      defaultValue: 'Mark this only when the manual invoice should create credit for future financial application instead of representing recurring service-period coverage.',
                    })}
                  </p>
                  {isPrepayment && (
                    <div>
                      <label htmlFor="expiration-date-input" className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                        {t('manualInvoices.creditExpiration.label', {
                          defaultValue: 'Credit Expiration Date',
                        })}
                      </label>
                      <div className="flex items-center">
                        <input
                          id="expiration-date-input"
                          type="date"
                          value={expirationDate}
                          onChange={(e) => setExpirationDate(e.target.value)}
                          className="border rounded-md px-3 py-2 w-full max-w-xs shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        />
                        <div className="ml-2 text-sm text-muted-foreground">
                          {t('manualInvoices.creditExpiration.helpText', {
                            defaultValue: 'Leave blank for no expiration or to use default expiration period',
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium mb-2">
                  {currentInvoiceData && !currentInvoiceData.is_manual
                    ? t('manualInvoices.lineItems.manual', { defaultValue: 'Manual Line Items' })
                    : t('manualInvoices.lineItems.all', { defaultValue: 'Line Items' })}
                </h3>
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <LineItem
                      key={item.item_id || index}
                      item={mapToLineItemEditable(item)} // Map to the type LineItem expects
                      index={index}
                      isExpanded={expandedItems.has(index)}
                      serviceOptions={serviceOptions}
                      invoiceItems={items
                        .filter(i => !i.is_discount && !i.isRemoved)
                        .map(i => ({
                          item_id: i.item_id || '',
                          description: i.description
                        }))}
                      onRemove={() => handleRemoveItem(index)}
                      // Use the adapter function for onChange
                      onChange={(updatedLineItem) => handleLineItemChange(index, updatedLineItem)}
                      onToggleExpand={() => {
                        const newExpanded = new Set(expandedItems);
                        if (newExpanded.has(index)) newExpanded.delete(index);
                        else newExpanded.add(index);
                        setExpandedItems(newExpanded);
                      }}
                      currencyCode={currencyCode}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center">
                <div className="flex gap-2">
                  <Button id='add-line-item-button' type="button" onClick={() => handleAddItem(false)} variant="secondary" disabled={isGenerating || expandedItems.size > 0}>
                    <PlusIcon className="w-4 h-4 mr-2" />
                    {t('manualInvoices.actions.addCharge', { defaultValue: 'Add Charge' })}
                  </Button>
                  <Button id='add-discount-button' type="button" onClick={() => handleAddItem(true)} variant="secondary" disabled={isGenerating || expandedItems.size > 0}>
                    <MinusCircleIcon className="w-4 h-4 mr-2" />
                    {t('manualInvoices.actions.addDiscount', { defaultValue: 'Add Discount' })}
                  </Button>
                </div>
                <div className="text-lg font-semibold">
                  {/* Always use the calculated total for consistency */}
                  <>
                    {t('manualInvoices.labels.total', { defaultValue: 'Total' })}: {formatCurrency(calculatedGrandTotal / 100, currencyCode)}
                  </>
                </div>
              </div>

              <Button
                id='save-changes-button'
                type="submit"
                disabled={isGenerating || (!currentInvoiceData && !selectedClient)}
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
    <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
      <ManualInvoicesContent {...props} />
    </ErrorBoundary>
  );
};

export default ManualInvoices;
