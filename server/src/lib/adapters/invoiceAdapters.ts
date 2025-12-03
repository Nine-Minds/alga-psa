// Import the source and target types with aliases for clarity
import type {
  InvoiceViewModel as DbInvoiceViewModel, // Source type from DB/interfaces
  IInvoiceCharge
} from 'server/src/interfaces/invoice.interfaces';
// Ensure the correct type is imported
import type { WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
import { DateValue } from '@alga-psa/shared/types';
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

      viewModel = {
        invoiceNumber: String(dbData.invoice_number ?? 'N/A'),
        issueDate: formatDateValueToString(dbData.invoice_date), // Corrected property name
        dueDate: formatDateValueToString(dbData.due_date),
        customer: {
          name: String(dbData.client?.name ?? 'N/A'),
          address: String(dbData.client?.address ?? 'N/A'),
        },
        // tenantClient does not exist directly in DbInvoiceViewModel, assuming it's not needed or handled elsewhere
        tenantClient: null,

        items: (dbData.invoice_charges ?? []).map((item: IInvoiceCharge) => ({
          id: String(item.item_id ?? ''), // Corrected property name
          description: String(item.description ?? ''),
          quantity: Number(item.quantity ?? 0),
          unitPrice: Number(item.unit_price ?? 0),
          total: Number(item.total_price ?? 0), // Corrected property name
        })),
        subtotal: Number(dbData.subtotal ?? 0),
        tax: Number(dbData.tax ?? 0),
        total: Number(dbData.total ?? 0),
        taxSource: dbData.tax_source || 'internal',
        // notes: dbData.notes, // Add if needed
      };
    }
    // Check if the input data is already in WasmInvoiceViewModel format
    else if (typeof inputData.invoiceNumber !== 'undefined' && typeof inputData.customer !== 'undefined' && typeof inputData.items !== 'undefined') {
        console.log('[mapDbInvoiceToWasmViewModel] Input data appears to be in WasmInvoiceViewModel format. Using directly...');
        viewModel = inputData as WasmInvoiceViewModel;
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