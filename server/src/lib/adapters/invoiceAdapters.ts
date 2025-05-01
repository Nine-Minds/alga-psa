// Import the source and target types with aliases for clarity
import type {
  InvoiceViewModel as DbInvoiceViewModel, // Source type from DB/interfaces
  IInvoiceItem
} from 'server/src/interfaces/invoice.interfaces';
// Ensure the correct type is imported
import type { WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
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
// Change input type to 'any' as the actual input structure seems to be WasmInvoiceViewModel based on logs
export function mapDbInvoiceToWasmViewModel(inputData: any): WasmInvoiceViewModel | null {
  console.log('[mapDbInvoiceToWasmViewModel] Received Data (Structure might be WasmViewModel already):', JSON.stringify(inputData, null, 2));

  if (!inputData) {
    console.log('[mapDbInvoiceToWasmViewModel] Input data is null, returning null.');
    return null;
  }

  // Basic check for essential properties expected in the WasmViewModel structure
  if (typeof inputData.invoiceNumber === 'undefined' || typeof inputData.customer === 'undefined' || typeof inputData.items === 'undefined') {
      console.error('[mapDbInvoiceToWasmViewModel] Input data is missing essential WasmViewModel properties (invoiceNumber, customer, items). Cannot map reliably.');
      return null; // Return null as mapping cannot proceed
  }

  try {
    // Assume inputData structure matches WasmInvoiceViewModel based on logs, focus on type coercion/defaults
    const viewModel: WasmInvoiceViewModel = {
      invoiceNumber: String(inputData.invoiceNumber ?? 'N/A'),
      issueDate: String(inputData.issueDate ?? ''), // Already formatted string in input log
      dueDate: String(inputData.dueDate ?? ''),   // Already formatted string in input log
      customer: {
        name: String(inputData.customer?.name ?? 'N/A'),
        address: String(inputData.customer?.address ?? 'N/A'),
      },
      // Map tenantCompany if it exists in input, otherwise null
      tenantCompany: inputData.tenantCompany ? {
          name: String(inputData.tenantCompany.name ?? 'N/A'),
          address: String(inputData.tenantCompany.address ?? 'N/A'),
          logoUrl: inputData.tenantCompany.logoUrl ?? null // Keep logoUrl if present
      } : null,
      items: (inputData.items ?? []).map((item: any) => ({ // Use 'any' for item type due to uncertainty
        id: String(item.id ?? ''),
        description: String(item.description ?? ''),
        quantity: Number(item.quantity ?? 0), // Ensure number
        unitPrice: Number(item.unitPrice ?? 0), // Ensure number
        total: Number(item.total ?? 0), // Ensure number (use item.total directly)
      })),
      subtotal: Number(inputData.subtotal ?? 0), // Ensure number
      tax: Number(inputData.tax ?? 0), // Ensure number
      total: Number(inputData.total ?? 0), // Ensure number (use inputData.total directly)
      // notes: inputData.notes, // Add if needed
    };

    console.log('[mapDbInvoiceToWasmViewModel] Mapped ViewModel (Corrected based on input log):', JSON.stringify(viewModel, null, 2));
    return viewModel;

  } catch (error) {
      console.error('[mapDbInvoiceToWasmViewModel] Error during mapping (Corrected logic):', error);
      console.error('[mapDbInvoiceToWasmViewModel] Original Data causing error:', JSON.stringify(inputData, null, 2));
      return null; // Return null on error
  }
}

// --- The deprecated mapDbInvoiceToViewModel function below this line is now removed ---