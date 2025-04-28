// Removed JSON import
import {
  InvoiceViewModel, InvoiceItem, // Use IInvoiceItem re-exported as InvoiceItem
  LayoutElement, ElementStyle, DocumentElement, SectionElement, RowElement, ColumnElement, TextElement,
  // Import factory functions
  createDocument, createSection, createRow, createColumn, createText
} from "../assembly/types"; // Adjusted import path
// Removed style-helpers import - apply styles directly or create new simple helpers if needed
// import { applyStyle, instantiateStyle, PartialStyle } from "../assembly/common/style-helpers";
import { formatCurrency } from "../assembly/common/format-helpers"; // Keep format helper for now

// --- Constants ---
// Removed DEFAULT_CATEGORY as category grouping is removed for simplicity
const TAX_RATE: number = 0.10; // Use standard 'number' type

// --- Main Export ---
// Removed @unsafe and @ts-ignore decorators
// Changed signature: input is ViewModel object, return is DocumentElement object
export function generateLayout(viewModel: InvoiceViewModel): DocumentElement {
  // Use console.log instead of log
  console.log("TS Template (standard-default): Received ViewModel for Invoice #:", viewModel.invoiceNumber);

  // Basic validation (can be enhanced)
  if (!viewModel || !viewModel.invoiceNumber) {
    console.error("TS Template (standard-default): Error - Invalid input ViewModel.");
    // Return a simple error document object
    return createDocument([createText("Error: Invalid input data.")]);
  }

  // --- Build Layout ---
  const headerSection = createHeaderSection_StdDefault(viewModel);
  const itemsResult = createItemsSection_StdDefault(viewModel.items); // Use correct field name 'items'
  const itemsSection = itemsResult.section;
  const calculatedSubtotal = itemsResult.subtotal;
  const calculatedTax = calculatedSubtotal * TAX_RATE; // Simple tax calculation
  const calculatedTotal = calculatedSubtotal + calculatedTax;
  const totalsSection = createTotalsSection_StdDefault(calculatedSubtotal, calculatedTax, calculatedTotal);

  // Use factory function
  const document = createDocument([
    headerSection,
    itemsSection,
    totalsSection
  ]);
  document.id = "invoice-document-standard-default";

  console.log("TS Template (standard-default): Returning layout object.");
  // Return the DocumentElement object directly
  return document;
}

// --- Section Creation Helpers (Specific to standard-default) ---

function createHeaderSection_StdDefault(viewModel: InvoiceViewModel): SectionElement {
  // Use factory functions and direct style objects
  const logoCol = createColumn([/* TODO: Add createImage if logo URL available */ createText("[Logo Placeholder]")], 3);

  const companyNameCol = createColumn([createText(viewModel.customer.name)], 5); // Using customer name as placeholder

  const invoiceInfoCol = createColumn([
    createText("Invoice #: " + viewModel.invoiceNumber),
    createText("Date: " + viewModel.issueDate) // Using issueDate for invoice_date
  ], 4);
  // Apply style directly
  invoiceInfoCol.style = { textAlign: "right" };

  const headerRow = createRow([logoCol, companyNameCol, invoiceInfoCol]);
  const headerSection = createSection([headerRow], "invoice-header-std-default");
  return headerSection;
}

// Result structure for items section
interface ItemsSectionResult {
    section: SectionElement;
    subtotal: number; // Use standard number
}

// Updated items section creator
function createItemsSection_StdDefault(items: Array<InvoiceItem>): ItemsSectionResult {
    const sectionChildren: LayoutElement[] = []; // Use correct type
    let runningSubtotal: number = 0.0; // Use standard number

    // Remove category grouping for simplicity with IInvoiceItem
    // Add Item Table Header Row first
    sectionChildren.push(createItemTableHeaderRow_StdDefault());

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        // Use correct field names from IInvoiceItem
        const itemTotal = item.quantity * item.unit_price; // Calculate total
        runningSubtotal += itemTotal;

        // Create columns using factory functions and correct field names
        const descCol = createColumn([createText(item.description)], 6);
        const qtyCol = createColumn([createText(item.quantity.toString())], 2);
        qtyCol.style = { textAlign: "right" };
        const unitPriceCol = createColumn([createText(formatCurrency(item.unit_price))], 2);
        unitPriceCol.style = { textAlign: "right" };
        const totalCol = createColumn([createText(formatCurrency(itemTotal))], 2); // Use calculated total
        totalCol.style = { textAlign: "right" };

        const itemRow = createRow([descCol, qtyCol, unitPriceCol, totalCol]);
        itemRow.id = "item-row-" + item.item_id; // Use item_id
        sectionChildren.push(itemRow);
    }

    const itemsSection = createSection(sectionChildren, "invoice-items-std-default");
    return { section: itemsSection, subtotal: runningSubtotal }; // Return plain object
}

// Updated table header creator
function createItemTableHeaderRow_StdDefault(): RowElement {
    const descCol = createColumn([createText("Description", "label")], 6);
    const qtyCol = createColumn([createText("Qty", "label")], 2);
    qtyCol.style = { textAlign: "right" };
    const unitPriceCol = createColumn([createText("Unit Price", "label")], 2);
    unitPriceCol.style = { textAlign: "right" };
    const totalCol = createColumn([createText("Total", "label")], 2);
    totalCol.style = { textAlign: "right" };

    const headerRow = createRow([descCol, qtyCol, unitPriceCol, totalCol]);
    // Apply style directly as an object
    headerRow.style = {
        fontWeight: "bold",
        borderBottom: "1px solid #ccc",
        paddingBottom: "0.5em"
    };
    return headerRow;
}

// Updated totals section creator
function createTotalsSection_StdDefault(subtotal: number, tax: number, total: number): SectionElement {
    const spacerCol = createColumn([], 7);

    const labelCol = createColumn([
        createText("Subtotal"),
        createText("Tax"),
        createText("Total")
    ], 2);
    labelCol.style = { textAlign: "right" };

    const totalTextStyle: ElementStyle = { fontWeight: "bold" }; // Define style object

    const valueCol = createColumn([
        createText(formatCurrency(subtotal)),
        createText(formatCurrency(tax)),
        // Apply style directly to the TextElement
        createText(formatCurrency(total), undefined, totalTextStyle)
    ], 3);
    valueCol.style = { textAlign: "right" };

    const totalsRow = createRow([spacerCol, labelCol, valueCol]);
    const totalsSection = createSection([totalsRow], "invoice-totals-std-default");
    // Apply style directly
    totalsSection.style = {
        borderTop: "1px solid #eee",
        paddingTop: "1em",
        marginTop: "1em"
    };

    return totalsSection;
}