// Import the source and target types with aliases for clarity
import type {
  InvoiceViewModel as DbInvoiceViewModel, // Source type from DB/interfaces
  IInvoiceCharge
} from '@alga-psa/types';
import type { WasmInvoiceViewModel, DateValue } from '@alga-psa/types';
import { Temporal } from '@js-temporal/polyfill';
// toPlainDate is likely not needed here as we format to string for Wasm

// Helper function to convert DateValue (Date or ISO string or Temporal) to ISO string for Wasm
function formatDateValueToString(date: DateValue | undefined | null): string {
  if (!date) return '';
  if (date instanceof Date) {
    return date.toISOString(); // Standard JS Date to ISO string
  }
  // Check for Temporal types (PlainDate, ZonedDateTime, etc.) which have toString()
  if (typeof date === 'object' && date !== null && 'calendarId' in date) { // A reasonable check for Temporal objects
      // Temporal objects usually have a suitable toString() method
      return date.toString();
  }
  // Otherwise, assume it's already a string or can be converted
  return String(date);
}

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const looksLikeLegacyMajorUnitPayload = (params: {
  subtotal: number;
  tax: number;
  total: number;
  itemTotalsSum: number;
}): boolean => {
  if (params.total <= 0 || params.itemTotalsSum <= 0) {
    return false;
  }
  const hasExplicitSubtotals = Math.abs(params.subtotal) > 0 || Math.abs(params.tax) > 0;
  if (hasExplicitSubtotals) {
    return false;
  }
  return Math.abs(params.itemTotalsSum - params.total) <= 1;
};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const resolveTenantClientSnapshot = (source: Record<string, unknown>): WasmInvoiceViewModel['tenantClient'] => {
  const candidate =
    source.tenantClient ??
    source.tenant_client ??
    source.tenantClientInfo ??
    source.tenant_client_info ??
    null;

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const candidateRecord = candidate as Record<string, unknown>;
  const name = asTrimmedString(candidateRecord.name) || asTrimmedString(candidateRecord.client_name);
  const address = asTrimmedString(candidateRecord.address) || asTrimmedString(candidateRecord.location_address);
  const logoUrl = asTrimmedString(candidateRecord.logoUrl) || asTrimmedString(candidateRecord.logo_url) || null;

  if (name.length === 0 && address.length === 0 && !logoUrl) {
    return null;
  }

  return {
    name: name.length > 0 ? name : null,
    address: address.length > 0 ? address : null,
    logoUrl,
  };
};


/**
 * Maps the detailed invoice data structure fetched from the database
 * (DbInvoiceViewModel from invoice.interfaces.ts) to the InvoiceViewModel
 * required by the Wasm template renderer (WasmInvoiceViewModel from invoice-renderer/types).
 * @param dbData - The detailed invoice data from the database query.
 * @returns An InvoiceViewModel suitable for the Wasm renderer, or null if input is null.
 */
// Change input type to 'any' as the actual input structure seems to be WasmInvoiceViewModel based on logs
export function mapDbInvoiceToWasmViewModel(inputData: DbInvoiceViewModel | WasmInvoiceViewModel | any): WasmInvoiceViewModel | null {
  console.log('[mapDbInvoiceToWasmViewModel] Received Data:', JSON.stringify(inputData, null, 2));

  if (!inputData) {
    console.log('[mapDbInvoiceToWasmViewModel] Input data is null, returning null.');
    return null;
  }

  let viewModel: WasmInvoiceViewModel;

  try {
    // Check if the input data is in DbInvoiceViewModel format (from database)
    if (typeof inputData.invoice_number !== 'undefined' && typeof inputData.client !== 'undefined' && typeof inputData.invoice_charges !== 'undefined') {
      console.log('[mapDbInvoiceToWasmViewModel] Input data appears to be in DbInvoiceViewModel format. Mapping...');
      const dbData = inputData as DbInvoiceViewModel;
      const dbRecord = dbData as unknown as Record<string, unknown>;
      const rawSubtotal = toFiniteNumber((dbData as any).subtotal);
      const rawTax = toFiniteNumber((dbData as any).tax);
      const rawTotal = toFiniteNumber((dbData as any).total ?? (dbData as any).total_amount);
      const rawItemTotalsSum = (dbData.invoice_charges ?? []).reduce(
        (sum: number, item: IInvoiceCharge) => sum + toFiniteNumber(item.total_price),
        0
      );
      const useLegacyMajorUnits = looksLikeLegacyMajorUnitPayload({
        subtotal: rawSubtotal,
        tax: rawTax,
        total: rawTotal,
        itemTotalsSum: rawItemTotalsSum,
      });
      const toMinorUnits = (value: unknown): number => {
        const numeric = toFiniteNumber(value);
        if (!useLegacyMajorUnits) {
          return Math.trunc(numeric);
        }
        return Math.round(numeric * 100);
      };

      const normalizedItems = (dbData.invoice_charges ?? []).map((item: IInvoiceCharge) => ({
        id: String(item.item_id ?? ''),
        description: String(item.description ?? ''),
        quantity: toFiniteNumber(item.quantity),
        unitPrice: toMinorUnits(item.unit_price),
        total: toMinorUnits(item.total_price),
      }));
      const computedSubtotal = normalizedItems.reduce((sum, item) => sum + item.total, 0);
      const subtotal = toMinorUnits(rawSubtotal);
      const tax = toMinorUnits(rawTax);
      const total = toMinorUnits(rawTotal);

      viewModel = {
        invoiceNumber: String(dbData.invoice_number ?? 'N/A'),
        issueDate: formatDateValueToString(dbData.invoice_date),
        dueDate: formatDateValueToString(dbData.due_date),
        customer: {
          name: String(dbData.client?.name ?? 'N/A'),
          address: String(dbData.client?.address ?? 'N/A'),
        },
        poNumber: (dbData as any).po_number ?? null,
        tenantClient: resolveTenantClientSnapshot(dbRecord),
        items: normalizedItems,
        subtotal: subtotal !== 0 ? subtotal : computedSubtotal,
        tax,
        total: total !== 0 ? total : (subtotal !== 0 ? subtotal : computedSubtotal) + tax,
        taxSource: dbData.tax_source || 'internal',
        currencyCode: (dbData as any).currency_code || (dbData as any).currencyCode || 'USD',
      };
    }
    // Check if the input data is already in WasmInvoiceViewModel format
    else if (typeof inputData.invoiceNumber !== 'undefined' && typeof inputData.customer !== 'undefined' && typeof inputData.items !== 'undefined') {
        console.log('[mapDbInvoiceToWasmViewModel] Input data appears to be in WasmInvoiceViewModel format. Using directly...');
        viewModel = inputData as WasmInvoiceViewModel;
        const wasmRecord = viewModel as unknown as Record<string, unknown>;
        // Ensure numeric types are correct in case they were strings
        viewModel.items = (viewModel.items ?? []).map(item => ({
            ...item,
            quantity: Number(item.quantity ?? 0),
            unitPrice: Number(item.unitPrice ?? 0),
            total: Number(item.total ?? 0),
        }));
        viewModel.subtotal = Number(viewModel.subtotal ?? 0);
        viewModel.tax = Number(viewModel.tax ?? 0);
        viewModel.total = Number(viewModel.total ?? 0);
        viewModel.tenantClient = resolveTenantClientSnapshot(wasmRecord);

    } else {
        console.error('[mapDbInvoiceToWasmViewModel] Input data format is unknown. Missing essential properties for both DbInvoiceViewModel and WasmInvoiceViewModel.');
        console.error('[mapDbInvoiceToWasmViewModel] Original Data causing error:', JSON.stringify(inputData, null, 2));
        return null; // Return null if format is unknown
    }


    console.log('[mapDbInvoiceToWasmViewModel] Mapped ViewModel:', JSON.stringify(viewModel, null, 2));
    return viewModel;

  } catch (error) {
      console.error('[mapDbInvoiceToWasmViewModel] Error during mapping:', error);
      console.error('[mapDbInvoiceToWasmViewModel] Original Data causing error:', JSON.stringify(inputData, null, 2));
      return null; // Return null on error
  }
}

// --- The deprecated mapDbInvoiceToViewModel function below this line is now removed ---
