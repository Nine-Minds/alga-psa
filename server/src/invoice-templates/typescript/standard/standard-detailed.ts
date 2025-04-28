// Removed JSON import
import {
  InvoiceViewModel, InvoiceItem, // Use IInvoiceItem re-exported as InvoiceItem
  LayoutElement, ElementStyle, DocumentElement, SectionElement, RowElement, ColumnElement, TextElement,
  // Import factory functions
  createDocument, createSection, createRow, createColumn, createText
} from "../assembly/types"; // Adjusted import path
// Removed style-helpers import
import { formatCurrency } from "../assembly/common/format-helpers"; // Keep format helper for now

// --- Constants ---
// Removed DEFAULT_CATEGORY
const TAX_RATE: number = 0.10; // Use standard 'number' type

// --- Main Export ---
// Removed decorators
// Changed signature: input is ViewModel object, return is DocumentElement object
export function generateLayout(viewModel: InvoiceViewModel): DocumentElement {
  // Use console.log
  console.log("TS Template (standard-detailed): Received ViewModel for Invoice #:", viewModel.invoiceNumber);

  // Basic validation
  if (!viewModel || !viewModel.invoiceNumber) {
    console.error("TS Template (standard-detailed): Error - Invalid input ViewModel.");
    // Use factory functions
    return createDocument([createText("Error: Invalid input data.")]);
  }

  // --- Build Layout ---
  const headerSection = createHeaderSection_StdDetailed(viewModel);
  const itemsResult = createItemsSection_StdDetailed(viewModel.items); // Use correct field name 'items'
  const itemsSection = itemsResult.section;
  const calculatedSubtotal = itemsResult.subtotal;
  const calculatedTax = calculatedSubtotal * TAX_RATE;
  const calculatedTotal = calculatedSubtotal + calculatedTax;
  const totalsSection = createTotalsSection_StdDetailed(calculatedSubtotal, calculatedTax, calculatedTotal);
  const notesSection = createNotesSection_StdDetailed(viewModel);

  const documentChildren: LayoutElement[] = [
    headerSection,
    itemsSection,
    totalsSection
  ];
  if (notesSection) {
      documentChildren.push(notesSection);
  }

  // Use factory function
  const document = createDocument(documentChildren);
  document.id = "invoice-document-standard-detailed";

  console.log("TS Template (standard-detailed): Returning layout object.");
  // Return the DocumentElement object directly
  return document;
}

// --- Section Creation Helpers (Specific to standard-detailed) ---

function createHeaderSection_StdDetailed(viewModel: InvoiceViewModel): SectionElement {
  // Use factory functions and direct style objects
  const logoCol = createColumn([createText("[Logo Placeholder]")], 3);

  const companyInfoCol = createColumn([
    createText(viewModel.customer.name), // Placeholder for company name
    createText(viewModel.customer.address) // Placeholder for company address
  ], 5);

  const invoiceInfoCol = createColumn([
    createText("Invoice #: " + viewModel.invoiceNumber),
    createText("Date: " + viewModel.issueDate)
  ], 4);
  // Apply style directly
  invoiceInfoCol.style = { textAlign: "right" };

  const customerInfoCol = createColumn([
      createText("Bill To:", "heading3"),
      createText(viewModel.customer.name),
      createText(viewModel.customer.address)
  ], 6); // Takes up half the width on a new line

  const headerRow1 = createRow([logoCol, companyInfoCol, invoiceInfoCol]);
  const headerRow2 = createRow([customerInfoCol]); // Customer info on its own row

  const headerSection = createSection([headerRow1, headerRow2], "invoice-header-std-detailed");
  return headerSection;
}

// Result structure for items section
interface ItemsSectionResult {
    section: SectionElement;
    subtotal: number; // Use standard number
}

// Updated items section creator
function createItemsSection_StdDetailed(items: Array<InvoiceItem>): ItemsSectionResult {
    const sectionChildren: LayoutElement[] = []; // Use correct type
    let runningSubtotal: number = 0.0; // Use standard number

    // Remove category grouping
    // Add Item Table Header Row first
    sectionChildren.push(createItemTableHeaderRow_StdDetailed());

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        // Use correct field names from IInvoiceItem
        const itemTotal = item.quantity * item.unit_price; // Calculate total
        runningSubtotal += itemTotal;

        // Use console.log
        console.log("TS Template Debug: Preparing item row for item ID: " + item.item_id);
        console.log("TS Template Debug: Formatting unitPrice: " + item.unit_price.toString());
        const formattedUnitPrice = formatCurrency(item.unit_price);
        console.log("TS Template Debug: unitPrice formatted. Result: " + formattedUnitPrice);
        console.log("TS Template Debug: Formatting total: " + itemTotal.toString()); // Use calculated total
        const formattedTotal = formatCurrency(itemTotal);
        console.log("TS Template Debug: total formatted. Result: " + formattedTotal);

        // Create columns using factory functions and apply styles directly
        const descCol = createColumn([createText(item.description)], 6);
        const qtyCol = createColumn([createText(item.quantity.toString())], 2);
        qtyCol.style = { textAlign: "right" };
        const unitPriceCol = createColumn([createText(formattedUnitPrice)], 2);
        unitPriceCol.style = { textAlign: "right" };
        const totalCol = createColumn([createText(formattedTotal)], 2); // Use calculated total
        totalCol.style = { textAlign: "right" };

        const itemRow = createRow([descCol, qtyCol, unitPriceCol, totalCol]);
        itemRow.id = "item-row-" + item.item_id; // Use item_id
        console.log("TS Template Debug: Created item row for item ID: " + item.item_id);
        sectionChildren.push(itemRow);
        console.log("TS Template Debug: Pushed item row for item ID: " + item.item_id);
    }

    const itemsSection = createSection(sectionChildren, "invoice-items-std-detailed");
    return { section: itemsSection, subtotal: runningSubtotal }; // Return plain object
}

// Updated table header creator
function createItemTableHeaderRow_StdDetailed(): RowElement {
    console.log("TS Template Debug: Entering createItemTableHeaderRow_StdDetailed.");
    // Use factory functions and apply styles directly
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
    console.log("TS Template Debug: Exiting createItemTableHeaderRow_StdDetailed.");
    return headerRow;
}

// Updated totals section creator
function createTotalsSection_StdDetailed(subtotal: number, tax: number, total: number): SectionElement {
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
    const totalsSection = createSection([totalsRow], "invoice-totals-std-detailed");
    // Apply style directly
    totalsSection.style = {
        borderTop: "1px solid #eee",
        paddingTop: "1em",
        marginTop: "1em"
    };

    return totalsSection;
}

// Updated notes section creator
function createNotesSection_StdDetailed(viewModel: InvoiceViewModel): SectionElement | null {
    const notesContent: LayoutElement[] = []; // Use correct type

    if (viewModel.notes && viewModel.notes.length > 0) {
        // Use factory functions
        notesContent.push(createText("Notes:", "heading2")); // Changed from heading3 to heading2
        notesContent.push(createText(viewModel.notes));
    }

    // Add the "Thank you" message
    const thankYouText = createText("Thank you for your business!");
    // Apply style directly
    thankYouText.style = { marginTop: "1em" };
    notesContent.push(thankYouText);

    if (notesContent.length > 0) {
        // Use factory function
        const notesSection = createSection(notesContent, "invoice-notes-std-detailed");
        // Apply style directly
        notesSection.style = { marginTop: "2em" };
        return notesSection;
    }

    return null;
}