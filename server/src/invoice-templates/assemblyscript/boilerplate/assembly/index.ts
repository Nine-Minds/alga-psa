/**
 * AssemblyScript Invoice Template Boilerplate
 *
 * This file provides a starting point for creating invoice templates using AssemblyScript.
 * It demonstrates how to:
 * 1. Define the main entry point function (`generateLayout`).
 * 2. Import necessary types and host functions.
 * 3. Deserialize input data (InvoiceViewModel) received from the host.
 * 4. Process the data and construct a layout structure (DocumentElement).
 * 5. Use host functions (like `log`) for debugging.
 * 6. Serialize the resulting layout structure to be returned to the host.
 */

// Import the JSON serializer/deserializer
import { JSON } from "json-as";

// Import types defined in types.ts (mirrored from host)
import {
  InvoiceViewModel,
  DocumentElement,
  SectionElement,
  RowElement,
  ColumnElement,
  TextElement,
  LayoutElement, // Base type might be needed for arrays
  log // Import the host function for logging
} from "./types";

// Import the custom abort function (optional but recommended)
// Ensure the path is correct relative to this file
import { abort } from "./common/abort"; // If you have the abort.ts file

/**
 * Main entry point for the Wasm module.
 * This function is called by the host environment.
 *
 * @param viewModelJson - A JSON string representing the InvoiceViewModel.
 * @returns A JSON string representing the generated DocumentElement layout structure.
 */
// @ts-ignore: decorator is valid for JSON serialization
@json
export function generateLayout(viewModelJson: string): string {
  // Log that the function has started (using the imported host function)
  log("WASM: generateLayout function started.");

  // --- 1. Deserialize Input Data ---
  let viewModel: InvoiceViewModel;
  try {
    // Use JSON.parse from json-as to convert the input string into an InvoiceViewModel object
    viewModel = JSON.parse<InvoiceViewModel>(viewModelJson);
    log("WASM: Successfully parsed InvoiceViewModel.");
  } catch (e) {
    // Log the error and abort if parsing fails
    log(`WASM: Error parsing InvoiceViewModel JSON: ${e.message}`);
    // Optional: Call the custom abort function if you have one configured
    abort(`Error parsing InvoiceViewModel JSON: ${e.message}`, "assembly/index.ts", 50, 5); // Example line/col
    // If not using custom abort, ensure the host handles errors gracefully.
    // Returning an empty document or specific error structure might be alternatives.
    return JSON.stringify(new DocumentElement([])); // Return empty document on error
  }

  // --- 2. Process Data & Build Layout ---
  // This is where the core template logic goes.
  // You'll iterate through viewModel data (customer info, items, etc.)
  // and create layout elements (Sections, Rows, Columns, Text, etc.).

  log(`WASM: Processing invoice: ${viewModel.invoiceNumber}`);

  // Example: Create a simple header section
  const headerSection = new SectionElement([
    new RowElement([
      new ColumnElement([
        new TextElement(`Invoice #: ${viewModel.invoiceNumber}`, "heading1")
      ]),
      new ColumnElement([
        new TextElement(`Issue Date: ${viewModel.issueDate}`, "paragraph")
      ])
    ])
  ]);
  headerSection.id = "invoice-header"; // Assign an optional ID

  // Example: Create a section for customer details
  const customerSection = new SectionElement([
    new TextElement("Bill To:", "heading2"),
    new TextElement(viewModel.customer.name, "paragraph"),
    new TextElement(viewModel.customer.address, "paragraph")
  ]);
  customerSection.id = "customer-details";

  // Example: Create a section for invoice items (basic loop)
  const itemElements: LayoutElement[] = []; // Use base type for the array
  for (let i = 0; i < viewModel.items.length; i++) {
    const item = viewModel.items[i];
    // Simple row per item
    itemElements.push(
      new RowElement([
        new ColumnElement([new TextElement(item.description, "paragraph")]),
        new ColumnElement([new TextElement(item.quantity.toString(), "paragraph")]),
        new ColumnElement([new TextElement(item.unitPrice.toString(), "paragraph")]),
        new ColumnElement([new TextElement(item.total.toString(), "paragraph")])
      ])
    );
  }
  const itemsSection = new SectionElement(itemElements);
  itemsSection.id = "invoice-items";

  // Example: Create a totals section
  const totalsSection = new SectionElement([
      new RowElement([
          new ColumnElement([new TextElement("Subtotal:", "label")]),
          new ColumnElement([new TextElement(viewModel.subtotal.toString(), "paragraph")])
      ]),
      new RowElement([
          new ColumnElement([new TextElement("Tax:", "label")]),
          new ColumnElement([new TextElement(viewModel.tax.toString(), "paragraph")])
      ]),
      new RowElement([
          new ColumnElement([new TextElement("Total:", "label", )]), // Add bold style example
          new ColumnElement([new TextElement(viewModel.total.toString(), "paragraph")])
      ])
  ]);
  totalsSection.id = "invoice-totals";
  // Example: Add style directly (though global styles/variants are often better)
  const totalLabel = (((totalsSection.children[2] as RowElement).children[0] as ColumnElement).children[0] as TextElement);
  totalLabel.style = { fontWeight: "bold" }; // Note: ElementStyle needs @json decorator in types.ts


  // Assemble the final document structure
  const document = new DocumentElement([
    headerSection,
    customerSection,
    itemsSection,
    totalsSection
    // Add more sections as needed (e.g., notes, footer)
  ]);

  // --- 3. Serialize Output ---
  log("WASM: Serializing DocumentElement layout...");
  let resultJson: string;
  try {
    // Use JSON.stringify from json-as to convert the DocumentElement object back to a JSON string
    resultJson = JSON.stringify(document);
  } catch (e) {
    log(`WASM: Error serializing DocumentElement JSON: ${e.message}`);
    abort(`Error serializing DocumentElement JSON: ${e.message}`, "assembly/index.ts", 130, 5); // Example line/col
    return "{}"; // Return empty object string on error
  }

  log("WASM: generateLayout function finished.");
  return resultJson;
}

// --- Helper Functions (Optional) ---
// You can define helper functions within this file or import them from other modules.
// Example:
// function formatCurrency(amount: f64): string {
//   // Basic formatting - consider using a host function for locale-specific formatting
//   return "$" + amount.toFixed(2).toString();
// }