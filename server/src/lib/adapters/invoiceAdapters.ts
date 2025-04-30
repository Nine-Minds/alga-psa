// Import the source and target types with aliases for clarity
import type {
  InvoiceViewModel as DbInvoiceViewModel, // Source type from DB/interfaces
  IInvoiceItem
} from 'server/src/interfaces/invoice.interfaces';
import type { InvoiceViewModel as WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types'; // Target type for Wasm renderer
import { DateValue } from '@shared/types/temporal';
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
export function mapDbInvoiceToWasmViewModel(dbData: DbInvoiceViewModel | null): WasmInvoiceViewModel | null {
  if (!dbData) {
    return null;
  }

  // Logic adapted from pdf-generation.service.ts mapInvoiceDataToViewModel
  const viewModel: WasmInvoiceViewModel = {
    invoiceNumber: dbData.invoice_number ?? 'N/A',
    issueDate: formatDateValueToString(dbData.invoice_date), // Format date to string
    dueDate: formatDateValueToString(dbData.due_date),       // Format date to string
    customer: {
      name: dbData.company?.name || 'N/A', // Combine company/contact info
      address: dbData.contact?.address || dbData.company?.address || 'N/A', // Use contact address first, fallback to company
    },
    items: (dbData.invoice_items ?? []).map((item: IInvoiceItem) => ({ // Ensure items array exists
      id: item.item_id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unit_price, // Assuming unit_price is correct
      total: item.total_price, // Assuming total_price is correct
      // Optional fields from WasmInvoiceViewModel['items'][number] can be added here
      // e.g., category: item.some_category_field,
    })),
    subtotal: dbData.subtotal ?? 0,
    tax: dbData.tax ?? 0,
    total: dbData.total_amount ?? 0, // Map total_amount to total for Wasm VM
    // Add other optional fields expected by WasmInvoiceViewModel if available in dbData
    // notes: dbData.notes,
    // paymentTerms: dbData.payment_terms,
  };

  return viewModel;
}

// --- The deprecated mapDbInvoiceToViewModel function below this line is now removed ---