'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  generateManualInvoice,
  getClientBillingEmailStatus,
} from '@alga-psa/billing/actions/manualInvoiceActions';
import { generateInvoiceForSalesOrder, type InvoiceableSalesOrderForBilling } from '@alga-psa/billing/actions/salesOrderInvoicingActions';
import {
  updateInvoiceManualItems,
  type InvoiceManualItemsUpdateActionResult,
} from '@alga-psa/billing/actions/invoiceModification';
import { getInvoiceLineItems } from '@alga-psa/billing/actions/invoiceQueries';
import { getActiveClientLocationsForBilling } from '@alga-psa/billing/actions/billingClientLocationActions';
import { getClientBillingProfilesForBilling } from '@alga-psa/billing/actions/billingProfileActions';
import { getTaxRates } from '@alga-psa/billing/actions/taxRateActions';
import type { ManualInvoiceUpdate } from '@alga-psa/billing/actions/invoiceActions'; // Import the specific type
import type { ManualInvoiceItem as ManualInvoiceItemForAction } from '@alga-psa/billing/actions/manualInvoiceActions'; // Import and alias
import type {
  ManualInvoiceFailure,
} from '../../errors/manualInvoiceErrors';
import { translateManualInvoiceFailure } from './manualInvoiceErrorTranslation';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { dateFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { Card } from '@alga-psa/ui/components/Card';
import { LineItem, ServiceOption, EditableItem as LineItemEditableItem, resolveLineItemAmount } from './LineItem'; // Import EditableItem type from LineItem
import { resolveInitialManualTaxRateId } from './manualInvoiceTaxResolution';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import type { IClient } from '@alga-psa/types';
import { ErrorBoundary } from 'react-error-boundary';
import type { IService } from '@alga-psa/types';
import { InvoiceViewModel, DiscountType, IInvoiceCharge, type ManualLineMetadata } from '@alga-psa/types';
import { computePartialPeriodAmount } from '../../lib/billing/compute/contractInvoiceAdjustments';
import type { JSX } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { PlusIcon, MinusCircleIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useRouter } from 'next/navigation';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

// Use a constant for environment check since process.env is not available
const IS_DEVELOPMENT = typeof window !== 'undefined' &&
  globalThis.window.location.hostname === 'localhost';

interface SelectOption {
  value: string;
  label: string;
}

/** The subset of a tenant tax rate the per-line tax treatment needs. */
interface TaxRateChoice {
  tax_rate_id: string;
  region_code: string;
  tax_percentage: number;
  name?: string | null;
  description?: string | null;
  is_active?: boolean;
}

interface ManualInvoicesProps {
  clients: IClient[];
  services: IService[];
  onGenerateSuccess: () => void;
  invoice?: InvoiceViewModel;
  invoiceableSalesOrders?: InvoiceableSalesOrderForBilling[];
  sourceSalesOrderId?: string | null;
  /**
   * `standard` keeps the manual-invoice generator. `draftAdjustments` renders
   * the same editor for an existing contract draft: invoice metadata is owned
   * by the details card, so it is hidden here and the generated rows are shown
   * read-only above the operator's manual additions.
   */
  variant?: 'standard' | 'draftAdjustments';
  /** Called after a successful save so the host can refresh authoritative data. */
  onSaved?: () => void | Promise<void>;
}

const isLegacyManualItemsUpdateError = (
  result: InvoiceManualItemsUpdateActionResult,
): result is Exclude<InvoiceManualItemsUpdateActionResult, InvoiceViewModel | ManualInvoiceFailure> => (
  isActionMessageError(result) || isActionPermissionError(result)
);

const isManualInvoiceFailure = (result: unknown): result is ManualInvoiceFailure => (
  Boolean(result) &&
  typeof result === 'object' &&
  (result as Partial<ManualInvoiceFailure>).success === false &&
  typeof (result as Partial<ManualInvoiceFailure>).code === 'string'
);

// This is the primary state type for manual items within this component
// Reverted: Keep is_taxable, remove tax_rate_id
interface EditableInvoiceItem extends Omit<IInvoiceCharge, 'tenant' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by' | 'tax_rate' | 'tax_amount' | 'net_amount' | 'total_price' | 'unit_price'> {
  rate: number; // Represents unit_price for editing (in cents)
  /** Chosen tax treatment for one-time lines; null/empty means non-taxable. */
  tax_rate_id?: string | null;
  is_taxable?: boolean; // Add is_taxable back to the interface
  isExisting?: boolean;
  isRemoved?: boolean;
  is_bundle_header?: boolean;
  /** Partial-period inputs and reason for one-time adjustment lines. */
  manual_line_metadata?: ManualLineMetadata | null;
}

// An untouched default row (no service, description, amount or adjustment
// metadata) is a placeholder, not a financial line. Saving it would persist a
// meaningless zero charge on the invoice.
const isBlankManualItem = (item: EditableInvoiceItem): boolean =>
  !item.isExisting
  && !item.isRemoved
  && !item.is_discount
  && !item.service_id
  && !item.manual_line_metadata
  && !(item.description ?? '').trim()
  && (item.rate ?? 0) === 0;

// Base structure for a default item, ensuring required fields for EditableInvoiceItem are present
const baseDefaultItem: Omit<EditableInvoiceItem, 'invoice_id'> = {
  item_id: '', // Will be replaced by uuidv4() when used
  service_id: '',
  quantity: 1,
  description: '',
  rate: 0, // Represents unit_price in cents
  is_discount: false,
  is_manual: true,
  is_manual_credit: false,
  isExisting: false,
  isRemoved: false,
  is_taxable: false, // Default to non-taxable until a service with tax_rate_id is selected
  tax_rate_id: null,
  discount_type: undefined,
  discount_percentage: undefined,
  applies_to_item_id: undefined,
  applies_to_service_id: undefined,
  client_contract_id: undefined,
  contract_name: undefined,
  is_bundle_header: undefined as any,
  parent_item_id: undefined,
  manual_line_metadata: undefined,
  location_id: null,
  billing_profile_id: null,
};


const AutomatedItemsTable: React.FC<{
  items: Array<{
    service_name: string;
    total: number; // Should be total_price from IInvoiceCharge (in cents)
    description?: string;
    contractName?: string | null;
    servicePeriod?: string | null;
    isDiscount?: boolean;
    reason?: string | null;
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
        {t('manualInvoices.automatedItems.title', { defaultValue: 'Generated Line Items' })}
      </h3>
      <table className="w-full">
        <thead className="text-sm text-muted-foreground">
          <tr>
            <th className="text-left py-2">
              {t('manualInvoices.automatedItems.service', { defaultValue: 'Service' })}
            </th>
            <th className="text-left py-2">
              {t('manualInvoices.automatedItems.period', { defaultValue: 'Period' })}
            </th>
            <th className="text-right py-2">
              {t('manualInvoices.automatedItems.total', { defaultValue: 'Total' })}
            </th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {items.map((item, i) => (
            <tr key={i} className="border-t align-top">
              <td className="py-2">
                <div className="text-[rgb(var(--color-text-900))]">{item.service_name}</div>
                {item.description && item.description !== item.service_name ? (
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                ) : null}
                {item.reason ? (
                  <div className="text-xs text-muted-foreground">{item.reason}</div>
                ) : null}
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                {item.contractName ? <div>{item.contractName}</div> : null}
                {item.servicePeriod ? <div>{item.servicePeriod}</div> : null}
              </td>
              {/* Display total_price */}
              <td className={`text-right ${item.isDiscount ? 'text-[rgb(var(--color-text-600))]' : ''}`}>
                {formatCurrency(item.total / 100, currencyCode)}
              </td>
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
  invoiceableSalesOrders = [],
  sourceSalesOrderId,
  variant = 'standard',
  onSaved,
}) => {
  const isDraftAdjustments = variant === 'draftAdjustments';
  const { t } = useTranslation('msp/invoicing');
  const router = useRouter();
  const { formatCurrency } = useFormatters();
  const { renderQuickAddClient } = useQuickAddClient();
  const [clientOptions, setClientOptions] = useState<IClient[]>(clients);
  const [selectedClient, setSelectedClient] = useState<string | null>(
    invoice?.client_id || null
  );
  const [selectedSalesOrderId, setSelectedSalesOrderId] = useState<string>('');
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
        // Carried so the per-line tax treatment control can restore the chosen
        // rate on reload; a non-taxable line keeps is_taxable=false and resolves
        // to no rate regardless of its stored region.
        tax_region: item.tax_region ?? undefined,
        manual_line_metadata: (item as IInvoiceCharge).manual_line_metadata ?? null,
        location_id: item.location_id ?? null,
        billing_profile_id: item.billing_profile_id ?? null,
        is_manual_credit: item.is_manual_credit ?? false,
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
  // Stable per-unsaved-edit idempotency key: a retried save reuses it, so the
  // server returns the already-applied result instead of appending twice.
  const pendingOperationIdRef = useRef<string>(uuidv4());
  const [partialPeriodOpen, setPartialPeriodOpen] = useState(false);
  const [partialDirection, setPartialDirection] = useState<'increase' | 'decrease'>('increase');
  const [partialUnits, setPartialUnits] = useState('3');
  const [partialUnitPrice, setPartialUnitPrice] = useState('100');
  const [partialCoveredDays, setPartialCoveredDays] = useState('15');
  const [partialFullDays, setPartialFullDays] = useState('30');
  const [partialDescription, setPartialDescription] = useState('');
  const [partialReason, setPartialReason] = useState('');
  const [partialError, setPartialError] = useState<string | null>(null);
  // Attribution controls for operator-created one-time charges on a contract
  // draft: the client's locations and billing profiles, resolved once per
  // client. The standard manual-invoice generator leaves these undefined.
  const [locationOptions, setLocationOptions] = useState<SelectOption[]>([]);
  const [billingProfileOptions, setBillingProfileOptions] = useState<SelectOption[]>([]);
  // Tenant tax rates for the per-line tax treatment control. Loaded once; an
  // empty list simply hides the control rather than defaulting a line to a
  // taxability the operator did not choose.
  const [taxRates, setTaxRates] = useState<TaxRateChoice[]>([]);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [loading, setLoading] = useState(false);
  const [isPrepayment, setIsPrepayment] = useState(false);
  const [expirationDate, setExpirationDate] = useState<string>('');
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [hasSelectedClientBillingEmail, setHasSelectedClientBillingEmail] = useState<boolean | null>(null);
  const translateManualInvoiceError = (result: ManualInvoiceFailure): string => (
    translateManualInvoiceFailure(t, result)
  );
  const translateLegacyManualInvoiceError = (message: string, mode: 'update' | 'generate'): string => {
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

  useEffect(() => {
    if (sourceSalesOrderId && invoiceableSalesOrders.some((so) => so.so_id === sourceSalesOrderId)) {
      setSelectedSalesOrderId(sourceSalesOrderId);
    }
  }, [invoiceableSalesOrders, sourceSalesOrderId]);

  const selectedSalesOrder = useMemo(
    () => invoiceableSalesOrders.find((so) => so.so_id === selectedSalesOrderId) ?? null,
    [invoiceableSalesOrders, selectedSalesOrderId],
  );

  useEffect(() => {
    if (selectedSalesOrder) {
      setSelectedClient(selectedSalesOrder.client_id);
    }
  }, [selectedSalesOrder]);

  useEffect(() => {
    if (currentInvoiceData || selectedSalesOrder || !selectedClient) {
      setHasSelectedClientBillingEmail(null);
      return;
    }

    let active = true;
    setHasSelectedClientBillingEmail(null);
    void getClientBillingEmailStatus(selectedClient)
      .then(({ hasBillingEmail }) => {
        if (active) {
          setHasSelectedClientBillingEmail(hasBillingEmail);
        }
      })
      .catch((statusError: unknown) => {
        if (IS_DEVELOPMENT) {
          console.error('Unable to check client billing email status:', statusError);
        }
      });

    return () => {
      active = false;
    };
  }, [currentInvoiceData, selectedClient, selectedSalesOrder]);

  const salesOrderOptions = useMemo(
    () =>
      invoiceableSalesOrders.map((so) => ({
        value: so.so_id,
        label: [
          so.so_number,
          so.client_name ?? so.client_id,
          formatCurrency(so.billable_amount / 100, so.currency_code || 'USD'),
        ].join(' · '),
      })),
    [formatCurrency, invoiceableSalesOrders],
  );
  const hasSalesOrderSource = !currentInvoiceData && Boolean(selectedSalesOrder);

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
          if (isActionMessageError(fetchedItems) || isActionPermissionError(fetchedItems)) {
            setError(getErrorMessage(fetchedItems));
            return;
          }
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
              tax_region: item.tax_region ?? undefined,
              manual_line_metadata: (item as IInvoiceCharge).manual_line_metadata ?? null,
              location_id: item.location_id ?? null,
              billing_profile_id: item.billing_profile_id ?? null,
              is_manual_credit: item.is_manual_credit ?? false,
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

  // Attribution options for the draft-adjustment editor. Loaded only for an
  // existing contract draft, where the client is fixed and the operator needs
  // to choose a location/billing profile for each one-time charge.
  const attributionClientId = isDraftAdjustments
    ? (currentInvoiceData?.client_id || invoice?.client_id || null)
    : null;
  useEffect(() => {
    if (!attributionClientId) {
      setLocationOptions([]);
      setBillingProfileOptions([]);
      return;
    }
    let cancelled = false;
    const loadAttributionOptions = async () => {
      try {
        const [locationsResult, profilesResult] = await Promise.all([
          getActiveClientLocationsForBilling(attributionClientId),
          getClientBillingProfilesForBilling(attributionClientId),
        ]);
        if (cancelled) return;
        if (Array.isArray(locationsResult)) {
          setLocationOptions(locationsResult.map((location) => ({
            value: location.location_id,
            label: location.location_name || location.address_line1 || location.location_id,
          })));
        }
        if (Array.isArray(profilesResult)) {
          setBillingProfileOptions(profilesResult.map((profile) => ({
            value: profile.billing_profile_id,
            label: profile.name,
          })));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[ManualInvoices] Failed to load attribution options', error);
        }
      }
    };
    void loadAttributionOptions();
    return () => {
      cancelled = true;
    };
  }, [attributionClientId]);

  // Tax treatments are tenant-wide, so they are loaded once. Only the
  // draft-adjustment editor exposes the control; the manual generator keeps its
  // legacy behavior by leaving taxRateOptions undefined.
  useEffect(() => {
    if (!isDraftAdjustments) return;
    let cancelled = false;
    const loadTaxRates = async () => {
      try {
        const result = await getTaxRates();
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          console.warn('[ManualInvoices] Tax rates unavailable for the tax treatment control');
          return;
        }
        setTaxRates((result as TaxRateChoice[]) ?? []);
      } catch (error) {
        if (!cancelled) {
          console.warn('[ManualInvoices] Failed to load tax rates', error);
        }
      }
    };
    void loadTaxRates();
    return () => {
      cancelled = true;
    };
  }, [isDraftAdjustments]);

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

  const resetPartialPeriodForm = () => {
    setPartialDirection('increase');
    setPartialUnits('3');
    setPartialUnitPrice('100');
    setPartialCoveredDays('15');
    setPartialFullDays('30');
    setPartialDescription('');
    setPartialReason('');
    setPartialError(null);
  };

  const handleAddPartialPeriodCharge = () => {
    const units = Number(partialUnits);
    const unitPriceMajor = Number(partialUnitPrice);
    const coveredDays = Number(partialCoveredDays);
    const fullPeriodDays = Number(partialFullDays);

    if (!Number.isFinite(units) || units <= 0) {
      setPartialError(t('manualInvoices.partialPeriod.errors.units', { defaultValue: 'Units must be greater than zero.' }));
      return;
    }
    if (!Number.isFinite(unitPriceMajor)) {
      setPartialError(t('manualInvoices.partialPeriod.errors.unitPrice', { defaultValue: 'Unit price must be a number.' }));
      return;
    }
    try {
      const unitPrice = Math.round(unitPriceMajor * 100);
      const magnitude = computePartialPeriodAmount({ units, unitPrice, coveredDays, fullPeriodDays });
      // A decrease is the same proration reversed: it is a signed credit, not a
      // separate calculator. It persists as a negative non-discount rate, which
      // the manual writer already treats as a credit.
      const resolvedAmount = partialDirection === 'decrease' ? -magnitude : magnitude;
      const proration = `${units} × ${formatCurrency(unitPriceMajor, currencyCode)} × ${coveredDays}/${fullPeriodDays}`;
      const defaultDescription = partialDirection === 'decrease'
        ? t('manualInvoices.partialPeriod.creditDescription', {
          defaultValue: 'Credit: {{proration}}',
          proration,
        })
        : proration;
      const newItem: EditableInvoiceItem = {
        ...baseDefaultItem,
        invoice_id: currentInvoiceData?.invoice_id || '',
        item_id: uuidv4(),
        is_discount: false,
        rate: resolvedAmount,
        quantity: 1,
        description: partialDescription.trim() || defaultDescription,
        isExisting: false,
        is_taxable: true,
        manual_line_metadata: {
          partialPeriod: { units, unitPrice, coveredDays, fullPeriodDays },
          direction: partialDirection,
          reason: partialReason.trim() || undefined,
        },
      };
      const newItems = [...items, newItem];
      setItems(newItems);
      setExpandedItems(new Set([newItems.length - 1]));
      setPartialPeriodOpen(false);
      resetPartialPeriodForm();
    } catch (error) {
      setPartialError(error instanceof Error
        ? error.message
        : t('manualInvoices.partialPeriod.errors.invalid', { defaultValue: 'Enter a valid partial period.' }));
    }
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
    if (!currentInvoiceData && selectedClient === null && !selectedSalesOrder) {
      setError(t('manualInvoices.errors.selectClient', {
        defaultValue: 'Please select a client',
      }));
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      if (!currentInvoiceData && selectedSalesOrderId && !selectedSalesOrder) {
        setError(t('manualInvoices.errors.salesOrderNotInvoiceable', {
          defaultValue: 'That sales order is no longer available to invoice.',
        }));
        return;
      }

      if (!currentInvoiceData && selectedSalesOrder) {
        const result = await generateInvoiceForSalesOrder(selectedSalesOrderId);

        if (!result.success) {
          setError(result.error || t('manualInvoices.errors.salesOrderGenerateFailed', {
            defaultValue: 'Could not generate the sales order invoice.',
          }));
          return;
        }

        if (result.invoiced <= 0) {
          setError(t('manualInvoices.errors.salesOrderNothingToInvoice', {
            defaultValue: 'Nothing remains to invoice for this sales order.',
          }));
          return;
        }

        onGenerateSuccess();
        if (result.invoiceId) {
          router.push(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${result.invoiceId}`);
        }
        return;
      }

      // Updating an existing invoice
      if (currentInvoiceData) {
        console.log('[Submit] Updating invoice items:', {
            invoiceId: currentInvoiceData.invoice_id,
            newCount: items.filter(i => !i.isExisting && !i.isRemoved).length,
            updatedCount: items.filter(i => i.isExisting && !i.isRemoved).length,
            removedCount: items.filter(i => i.isRemoved).length
        });

        const newItemsToSave = items.filter(item => !item.isExisting && !item.isRemoved && !isBlankManualItem(item));
        const updatedItemsToSave = items.filter(item => item.isExisting && !item.isRemoved && item.item_id);
        const removedItemIds = items
          .filter(item => item.isExisting && item.isRemoved && item.item_id)
          .map(item => item.item_id!); // item_id is guaranteed here by filter

        // Carries the operator's tax-treatment choice alongside the partial-period
        // inputs. The charge has no tax_rate_id column, so this echo is what lets
        // a reload restore the exact rate (the charge's tax_region alone cannot
        // disambiguate two rates that share a region). The server still resolves
        // and validates tax_rate_id into tax_region/is_taxable independently.
        const withTaxTreatmentMetadata = (
          item: EditableInvoiceItem,
        ): ManualLineMetadata | null => {
          const next: Record<string, unknown> = { ...(item.manual_line_metadata ?? {}) };
          if (item.tax_rate_id) {
            next.tax_rate_id = item.tax_rate_id;
          } else {
            delete next.tax_rate_id;
          }
          return Object.keys(next).length > 0 ? (next as ManualLineMetadata) : null;
        };

        // The selected tax treatment is authoritative for the persisted charge:
        // a chosen rate is taxable, and an explicit Non-taxable (null) stays
        // non-taxable even when the linked catalog service is taxable. Only an
        // absent choice (undefined) falls back to the item's existing flag, so a
        // legacy caller that never saw the control keeps its prior behavior.
        const resolvePayloadTaxable = (item: EditableInvoiceItem): boolean | undefined => {
          if (item.is_discount) return false;
          if (item.tax_rate_id === undefined) return item.is_taxable;
          return Boolean(item.tax_rate_id);
        };

        // Map EditableInvoiceItem to IInvoiceCharge for newItems. `tax_rate_id`
        // is an authoring override (there is no such column); the server turns it
        // into the charge's tax_region/is_taxable.
        const mapToNewItemSaveFormat = (
          item: EditableInvoiceItem,
        ): IInvoiceCharge & { tax_rate_id?: string | null } => ({
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
          is_taxable: resolvePayloadTaxable(item), // Include is_taxable property
          tax_rate_id: item.tax_rate_id ?? null,
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
          manual_line_metadata: withTaxTreatmentMetadata(item),
          location_id: item.location_id ?? null,
          billing_profile_id: item.billing_profile_id ?? null,
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
          is_taxable: resolvePayloadTaxable(item),
          tax_rate_id: item.tax_rate_id,
          manual_line_metadata: withTaxTreatmentMetadata(item),
          location_id: item.location_id ?? null,
          billing_profile_id: item.billing_profile_id ?? null,
        });

        const updateResult = await updateInvoiceManualItems(currentInvoiceData.invoice_id, {
          invoice_number: currentInvoiceData.invoice_number,
          newItems: newItemsToSave.map(mapToNewItemSaveFormat),
          updatedItems: updatedItemsToSave.map(mapToUpdateSaveFormat),
          removedItemIds
        }, {
          operationId: pendingOperationIdRef.current,
          expectedRevision: currentInvoiceData.draft_adjustment_revision,
        });

        if (isManualInvoiceFailure(updateResult)) {
          setError(translateManualInvoiceError(updateResult));
          return;
        }

        if (isLegacyManualItemsUpdateError(updateResult)) {
          setError(translateLegacyManualInvoiceError(getErrorMessage(updateResult), 'update'));
          return;
        }

        setExpandedItems(new Set());

        if (!currentInvoiceData) {
          console.error('[Submit] Cannot refresh items: currentInvoiceData became undefined after update.');
          setError(t('manualInvoices.errors.refresh', {
            defaultValue: 'An error occurred while refreshing invoice data.',
          }));
          setIsGenerating(false);
          return;
        }

        // `updateInvoiceManualItems` returns the full authoritative invoice,
        // including recalculated discounts, tax and totals. Prefer it over the
        // older line-items-only refresh so the editor never displays a
        // manual-only subtotal as the invoice total.
        const authoritativeInvoice = (
          updateResult
          && typeof updateResult === 'object'
          && Array.isArray((updateResult as InvoiceViewModel).invoice_charges)
        )
          ? (updateResult as InvoiceViewModel)
          : null;

        const refreshedItems = authoritativeInvoice?.invoice_charges
          ?? await getInvoiceLineItems(currentInvoiceData.invoice_id);
        if (isActionMessageError(refreshedItems) || isActionPermissionError(refreshedItems)) {
          setError(getErrorMessage(refreshedItems));
          return;
        }
        console.log('[Submit] Refreshed items after update:', refreshedItems.length);

        const updatedInvoiceData: InvoiceViewModel = authoritativeInvoice
          ? { ...authoritativeInvoice, invoice_charges: refreshedItems }
          : { ...currentInvoiceData, invoice_charges: refreshedItems };

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
            tax_region: item.tax_region ?? undefined,
            manual_line_metadata: (item as IInvoiceCharge).manual_line_metadata ?? null,
            location_id: item.location_id ?? null,
            billing_profile_id: item.billing_profile_id ?? null,
            is_manual_credit: item.is_manual_credit ?? false,
            isExisting: true,
            isRemoved: false,
        }));
        setItems(mappedUpdatedManual.length > 0 ? mappedUpdatedManual : [{
            ...baseDefaultItem,
            item_id: uuidv4(),
            invoice_id: currentInvoiceData.invoice_id
        }]);
        // This edit is committed; the next edit gets a fresh idempotency key.
        pendingOperationIdRef.current = uuidv4();
        await onSaved?.();
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
          invoiceNumber: newInvoiceNumber,
          isPrepayment,
          expirationDate: isPrepayment && expirationDate ? expirationDate : undefined,
          items: itemsToSave
        });

        // `=== false` (not `!result.success`): the ee/server typecheck compiles
        // this file with strictNullChecks off, where truthiness narrowing does
        // not discriminate the union but literal equality does.
        if (result.success === false) {
          setError(translateManualInvoiceError(result));
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
         errorMessage = translateLegacyManualInvoiceError(err.message, errorMode);
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
        // Shared with the row summary; distinguishes an authored fixed discount
        // (quantity-independent) from a quantity-derived operator credit.
        total += resolveLineItemAmount(item);
      }
    }
    return Math.round(total); // Return total in cents
  };

  const getButtonText = () => {
    if (isGenerating) {
      return t('manualInvoices.actions.processing', { defaultValue: 'Processing...' });
    }

    if (!currentInvoiceData && selectedSalesOrder) {
      return t('manualInvoices.actions.generateSalesOrderInvoice', {
        defaultValue: 'Generate Sales Order Invoice',
      });
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

  const partialPeriodPreview = (() => {
    try {
      const unitPrice = Math.round(Number(partialUnitPrice) * 100);
      const magnitude = computePartialPeriodAmount({
        units: Number(partialUnits),
        unitPrice,
        coveredDays: Number(partialCoveredDays),
        fullPeriodDays: Number(partialFullDays),
      });
      return partialDirection === 'decrease' ? -magnitude : magnitude;
    } catch {
      return null;
    }
  })();

  const serviceOptions: ServiceOption[] = services
    .filter((service) => service.is_active !== false)
    .map((service): ServiceOption => {
      const currencyRate = service.prices?.find((p) => p.currency_code === currencyCode)?.rate;
      // `service.default_rate` is the legacy, untagged (effectively USD-only) rate. Only fall
      // back to it when the invoice currency is USD; for any other currency a service without a
      // matching `service_prices` entry has no valid rate (0) — the user enters the correct
      // amount rather than seeing a USD price relabeled in the client's currency.
      const rate = currencyRate ?? (currencyCode === 'USD' ? service.default_rate : undefined) ?? 0;
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

  const taxRateOptions: SelectOption[] = taxRates.map((rate) => ({
    value: rate.tax_rate_id,
    label: `${rate.name || rate.description || rate.region_code} (${rate.tax_percentage}%)`,
  }));

  const taxRateByRegion = new Map<string, string>();
  for (const rate of taxRates) {
    if (rate.region_code && !taxRateByRegion.has(rate.region_code)) {
      taxRateByRegion.set(rate.region_code, rate.tax_rate_id);
    }
  }

  // Preselects a one-time line's tax treatment: an explicit operator choice
  // wins, otherwise derive from the selected service, otherwise match the
  // stored region. Discounts/credits are never taxed. A taxable row whose rate
  // cannot be reconstructed resolves to `undefined` so opening and saving it
  // preserves the stored treatment instead of stripping it.
  const resolveInitialTaxRateId = (item: EditableInvoiceItem): string | null | undefined => {
    const invoiceClientId = currentInvoiceData?.client_id || invoice?.client_id || selectedClient;
    const clientRegion = clientOptions.find((client) => client.client_id === invoiceClientId)?.region_code ?? null;
    return resolveInitialManualTaxRateId({
      isDiscount: Boolean(item.is_discount),
      explicitTaxRateId: item.tax_rate_id,
      metadataTaxRateId: item.manual_line_metadata?.tax_rate_id,
      isTaxable: item.is_taxable,
      taxRegion: item.tax_region ?? null,
      serviceId: item.service_id ?? null,
      serviceTaxRateId: services.find((service) => service.service_id === item.service_id)?.tax_rate_id ?? null,
      clientRegion,
      taxRateByRegion,
    });
  };

  // Helper to prepare item prop for LineItem component
  const mapToLineItemEditable = (item: EditableInvoiceItem): LineItemEditableItem => ({
      item_id: item.item_id,
      service_id: item.service_id || '', // Ensure string
      quantity: item.quantity,
      description: item.description,
      rate: item.rate, // Pass rate in cents
      tax_rate_id: resolveInitialTaxRateId(item),
      isExisting: item.isExisting,
      isRemoved: item.isRemoved,
      is_discount: item.is_discount,
      is_manual_credit: item.is_manual_credit ?? false,
      discount_type: item.discount_type,
      discount_percentage: item.discount_percentage,
      applies_to_item_id: item.applies_to_item_id,
      location_id: item.location_id ?? null,
      billing_profile_id: item.billing_profile_id ?? null,
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
                  {isDraftAdjustments
                    ? t('manualInvoices.draftAdjustments.title', { defaultValue: 'Invoice adjustments' })
                    : (currentInvoiceData || invoice)
                      ? t('manualInvoices.detailsTitle', { defaultValue: 'Invoice Details' })
                      : t('manualInvoices.title', { defaultValue: 'Generate Manual Invoice' })}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isDraftAdjustments
                    ? t('manualInvoices.draftAdjustments.description', {
                      defaultValue: 'Add one-time charges, discounts or credits. Generated contract charges stay read-only; correct the source contract or add an adjustment.',
                    })
                    : (currentInvoiceData || invoice)
                      ? t('manualInvoices.detailsDescription', {
                        defaultValue: 'Manual edits stay periodless by default, while recurring detail-backed lines keep their canonical service periods.',
                      })
                      : t('manualInvoices.description', {
                        defaultValue: 'Use manual invoices for one-off or adjustment lines. They coexist with recurring invoices without redefining recurring service periods.',
                      })}
                </p>
              </div>
            </div>

            {currentInvoiceData && !isDraftAdjustments && (
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

            {currentInvoiceData && !isDraftAdjustments && (
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
              {!invoice && !currentInvoiceData && invoiceableSalesOrders.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                    {t('manualInvoices.fields.sourceSalesOrder', { defaultValue: 'Source sales order (optional)' })}
                  </label>
                  <SearchableSelect
                    id="manual-invoice-sales-order-source"
                    options={salesOrderOptions}
                    value={selectedSalesOrderId}
                    onChange={setSelectedSalesOrderId}
                    placeholder={t('manualInvoices.placeholders.sourceSalesOrder', {
                      defaultValue: 'Select a fulfilled or manually billable sales order',
                    })}
                    searchPlaceholder={t('manualInvoices.placeholders.searchSalesOrders', {
                      defaultValue: 'Search sales orders...',
                    })}
                    emptyMessage={t('manualInvoices.placeholders.noInvoiceableSalesOrders', {
                      defaultValue: 'No invoiceable sales orders found.',
                    })}
                    dropdownMode="overlay"
                    maxListHeight="250px"
                  />
                  {selectedSalesOrder && (
                    <div
                      id="manual-invoice-sales-order-context"
                      className="mt-3 rounded-md border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-primary-50))] p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-[rgb(var(--color-text-900))]">
                            {selectedSalesOrder.so_number} · {selectedSalesOrder.client_name ?? selectedSalesOrder.client_id}
                          </div>
                          <div className="mt-1 text-[rgb(var(--color-text-600))]">
                            {t('manualInvoices.salesOrderContext.summary', {
                              defaultValue:
                                '{{quantity}} item(s) ready to invoice from {{lineCount}} line(s). This draft will be linked back to the sales order.',
                              quantity: selectedSalesOrder.billable_quantity_total,
                              lineCount: selectedSalesOrder.line_count,
                            })}
                          </div>
                        </div>
                        <div className="text-right font-semibold text-[rgb(var(--color-text-900))]">
                          {formatCurrency(
                            selectedSalesOrder.billable_amount / 100,
                            selectedSalesOrder.currency_code || 'USD',
                          )}
                        </div>
                      </div>
                      <Button
                        id="manual-invoice-clear-sales-order-source"
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-2 px-0"
                        onClick={() => setSelectedSalesOrderId('')}
                      >
                        {t('manualInvoices.actions.clearSalesOrderSource', { defaultValue: 'Clear sales order source' })}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {!invoice && !currentInvoiceData && (
                <div>
                  <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                    {t('manualInvoices.fields.client', { defaultValue: 'Client' })}
                  </label>
                  {selectedSalesOrder ? (
                    <div
                      id="manual-invoice-sales-order-client"
                      className="rounded-md border border-[rgb(var(--color-border-300))] px-3 py-2 text-sm text-[rgb(var(--color-text-900))]"
                    >
                      {selectedSalesOrder.client_name ?? selectedSalesOrder.client_id}
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              )}

              {!invoice && !currentInvoiceData && !hasSalesOrderSource && hasSelectedClientBillingEmail === false && (
                <Alert id="manual-invoice-no-billing-email-warning" variant="warning">
                  <AlertDescription>
                    {t('manualInvoices.warnings.noBillingEmail', {
                      defaultValue: 'This client has no billing email. Set a billing contact, a client billing email, or an email on the billing or default location before generating the invoice.',
                    })}
                  </AlertDescription>
                </Alert>
              )}

              {!invoice && !currentInvoiceData && !hasSalesOrderSource && (
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
                      total: item.total_price, // Pass total_price (in cents)
                      description: item.description,
                      contractName: item.contract_name,
                      servicePeriod: item.service_period_start && item.service_period_end
                        ? `${String(item.service_period_start).slice(0, 10)} – ${String(item.service_period_end).slice(0, 10)}`
                        : null,
                      isDiscount: Boolean(item.is_discount),
                      reason: item.adjustment_reason ?? null,
                    }))
                  }
                  currencyCode={currencyCode}
                />
              )}

              {!invoice && !currentInvoiceData && !hasSalesOrderSource && (
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
                        <DatePicker
                          id="expiration-date-input"
                          label={t('manualInvoices.creditExpiration.label', {
                            defaultValue: 'Credit Expiration Date',
                          })}
                          placeholder={t('manualInvoices.creditExpiration.label', {
                            defaultValue: 'Credit Expiration Date',
                          })}
                          clearable
                          className="w-full max-w-xs"
                          value={dateFromString(expirationDate)}
                          onChange={(date) => setExpirationDate(dateToString(date))}
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

              {!hasSalesOrderSource && (
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
                      locationOptions={isDraftAdjustments ? locationOptions : undefined}
                      billingProfileOptions={isDraftAdjustments ? billingProfileOptions : undefined}
                      taxRateOptions={isDraftAdjustments ? taxRateOptions : undefined}
                    />
                  ))}
                </div>
              </div>
              )}

              {!hasSalesOrderSource && (
                <div className="space-y-4">
                {partialPeriodOpen && (
                  <div
                    id="partial-period-charge-panel"
                    className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                        {t('manualInvoices.partialPeriod.title', { defaultValue: 'Partial-period charge' })}
                      </h4>
                      <Button
                        id="cancel-partial-period-charge-button"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPartialPeriodOpen(false);
                          resetPartialPeriodForm();
                        }}
                      >
                        {t('common.actions.cancel', { defaultValue: 'Cancel' })}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('manualInvoices.partialPeriod.help', {
                        defaultValue: 'Resolved as units × period unit price × covered days / full-period days. The inputs are kept with the line so it stays intelligible.',
                      })}
                    </p>
                    {partialError && (
                      <Alert variant="destructive">
                        <AlertDescription>{partialError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="flex gap-2" role="group" aria-label={t('manualInvoices.partialPeriod.direction', { defaultValue: 'Direction' })}>
                      <Button
                        id="partial-period-direction-increase-button"
                        type="button"
                        size="sm"
                        variant={partialDirection === 'increase' ? 'default' : 'outline'}
                        onClick={() => setPartialDirection('increase')}
                      >
                        {t('manualInvoices.partialPeriod.increase', { defaultValue: 'Increase' })}
                      </Button>
                      <Button
                        id="partial-period-direction-decrease-button"
                        type="button"
                        size="sm"
                        variant={partialDirection === 'decrease' ? 'default' : 'outline'}
                        onClick={() => setPartialDirection('decrease')}
                      >
                        {t('manualInvoices.partialPeriod.decrease', { defaultValue: 'Decrease (credit)' })}
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Input
                        id="partial-period-units-input"
                        label={t('manualInvoices.partialPeriod.units', { defaultValue: 'Units' })}
                        type="number"
                        min="0"
                        step="0.01"
                        value={partialUnits}
                        onChange={(event) => setPartialUnits(event.target.value)}
                      />
                      <Input
                        id="partial-period-unit-price-input"
                        label={t('manualInvoices.partialPeriod.unitPrice', { defaultValue: 'Unit price' })}
                        type="number"
                        step="0.01"
                        value={partialUnitPrice}
                        onChange={(event) => setPartialUnitPrice(event.target.value)}
                      />
                      <Input
                        id="partial-period-covered-days-input"
                        label={t('manualInvoices.partialPeriod.coveredDays', { defaultValue: 'Covered days' })}
                        type="number"
                        min="0"
                        step="1"
                        value={partialCoveredDays}
                        onChange={(event) => setPartialCoveredDays(event.target.value)}
                      />
                      <Input
                        id="partial-period-full-days-input"
                        label={t('manualInvoices.partialPeriod.fullPeriodDays', { defaultValue: 'Full-period days' })}
                        type="number"
                        min="1"
                        step="1"
                        value={partialFullDays}
                        onChange={(event) => setPartialFullDays(event.target.value)}
                      />
                    </div>
                    <Input
                      id="partial-period-description-input"
                      label={t('manualInvoices.partialPeriod.description', { defaultValue: 'Description (optional)' })}
                      value={partialDescription}
                      onChange={(event) => setPartialDescription(event.target.value)}
                      placeholder={`${partialUnits} × ${partialUnitPrice} × ${partialCoveredDays}/${partialFullDays}`}
                    />
                    <Input
                      id="partial-period-reason-input"
                      label={t('manualInvoices.partialPeriod.reason', { defaultValue: 'Reason (optional)' })}
                      value={partialReason}
                      onChange={(event) => setPartialReason(event.target.value)}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[rgb(var(--color-text-700))]">
                        {partialPeriodPreview === null
                          ? t('manualInvoices.partialPeriod.previewUnavailable', { defaultValue: 'Enter a valid calculation.' })
                          : t('manualInvoices.partialPeriod.resolvedAmount', {
                            defaultValue: 'Resolved amount: {{amount}}',
                            amount: formatCurrency(partialPeriodPreview / 100, currencyCode),
                          })}
                      </span>
                      <Button
                        id="add-partial-period-charge-confirm-button"
                        type="button"
                        onClick={handleAddPartialPeriodCharge}
                        disabled={isGenerating || partialPeriodPreview === null}
                      >
                        <PlusIcon className="w-4 h-4 mr-2" />
                        {t('manualInvoices.partialPeriod.addCharge', { defaultValue: 'Add charge' })}
                      </Button>
                    </div>
                  </div>
                )}
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
                  <Button
                    id='add-partial-period-charge-button'
                    type="button"
                    onClick={() => setPartialPeriodOpen(true)}
                    variant="outline"
                    disabled={isGenerating || partialPeriodOpen}
                  >
                    {t('manualInvoices.actions.addPartialPeriodCharge', { defaultValue: 'Add partial-period charge' })}
                  </Button>
                </div>
                <div className="text-lg font-semibold">
                  {/* Always use the calculated total for consistency */}
                  <>
                    {t('manualInvoices.labels.total', { defaultValue: 'Total' })}: {formatCurrency(calculatedGrandTotal / 100, currencyCode)}
                  </>
                </div>
              </div>
              </div>
              )}

              <Button
                id='save-changes-button'
                type="submit"
                disabled={isGenerating || (!currentInvoiceData && !selectedClient && !selectedSalesOrder)}
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
