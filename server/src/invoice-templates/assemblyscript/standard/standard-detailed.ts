import { JSON } from "json-as";
import {
  InvoiceViewModel, InvoiceItem,
  LayoutElement, ElementStyle, RowElement, ColumnElement, DocumentElement, SectionElement, TextElement,
  log
} from "../assembly/types"; // Adjusted import path
import { applyStyle, instantiateStyle, PartialStyle } from "../assembly/common/style-helpers"; // Adjusted import path
import { formatCurrency } from "../assembly/common/format-helpers"; // Adjusted import path

// --- Constants ---
const DEFAULT_CATEGORY = "Items";
const TAX_RATE: f64 = 0.10; // Example tax rate

// --- Main Export ---
// @ts-ignore: decorator
@unsafe
export function generateLayout(dataString: string): string {
  log("Wasm (standard-detailed): Received data string.");

  // Initialize viewModel and parse (no try-catch in release builds)
  const viewModel = JSON.parse<InvoiceViewModel>(dataString);

  // Basic validation after parsing
  if (!viewModel || viewModel.invoiceNumber == null || viewModel.invoiceNumber == "") {
    log("Wasm (standard-detailed): Error - Deserialization failed or key property missing.");
    const errorDoc = new DocumentElement([new TextElement("Error: Invalid input data.")]);
    return JSON.stringify<DocumentElement>(errorDoc);
  }
  log("Wasm (standard-detailed): Deserialized Invoice #: " + viewModel.invoiceNumber);

  // --- Build Layout ---
  const headerSection = createHeaderSection_StdDetailed(viewModel);
  const itemsResult = createItemsSection_StdDetailed(viewModel.items);
  const itemsSection = itemsResult.section;
  const calculatedSubtotal = itemsResult.subtotal;
  const calculatedTax = calculatedSubtotal * TAX_RATE;
  const calculatedTotal = calculatedSubtotal + calculatedTax;
  const totalsSection = createTotalsSection_StdDetailed(calculatedSubtotal, calculatedTax, calculatedTotal);
  const notesSection = createNotesSection_StdDetailed(viewModel); // Add notes section

  const documentChildren: Array<LayoutElement> = [
    headerSection,
    itemsSection,
    totalsSection
  ];
  if (notesSection) {
      documentChildren.push(notesSection);
  }

  const document = new DocumentElement(documentChildren);
  document.id = "invoice-document-standard-detailed";

  log("Wasm (standard-detailed): Serializing layout...");
  const resultString = JSON.stringify<DocumentElement>(document);
  log("Wasm (standard-detailed): Returning serialized layout.");
  return resultString;
}

// --- Section Creation Helpers (Specific to standard-detailed) ---

function createHeaderSection_StdDetailed(viewModel: InvoiceViewModel): SectionElement {
  // DSL: section header grid 12 x 4 { ... }
  // Assuming company/contact info is on viewModel.customer for simplicity
  const logoCol = new ColumnElement([new TextElement("[Logo Placeholder]")]);
  logoCol.span = 3;

  const companyInfoCol = new ColumnElement([
    new TextElement(viewModel.customer.name), // Placeholder for company name
    new TextElement(viewModel.customer.address) // Placeholder for company address
  ]);
  companyInfoCol.span = 5;

  const invoiceInfoCol = new ColumnElement([
    new TextElement("Invoice #: " + viewModel.invoiceNumber),
    new TextElement("Date: " + viewModel.issueDate)
  ]);
  invoiceInfoCol.span = 4;
  applyStyle(invoiceInfoCol, instantiateStyle(new PartialStyle("right")));

  const customerInfoCol = new ColumnElement([
      new TextElement("Bill To:", "heading3"),
      new TextElement(viewModel.customer.name),
      new TextElement(viewModel.customer.address)
  ]);
  customerInfoCol.span = 6; // Takes up half the width on a new line

  const headerRow1 = new RowElement([logoCol, companyInfoCol, invoiceInfoCol]);
  const headerRow2 = new RowElement([customerInfoCol]); // Customer info on its own row

  const headerSection = new SectionElement([headerRow1, headerRow2]);
  headerSection.id = "invoice-header-std-detailed";
  return headerSection;
}

class ItemsSectionResult {
    section: SectionElement;
    subtotal: f64;
    constructor(section: SectionElement, subtotal: f64) { this.section = section; this.subtotal = subtotal; }
}

// *** CORRECTED createItemsSection_StdDetailed function ***
function createItemsSection_StdDetailed(items: Array<InvoiceItem>): ItemsSectionResult {
    // DSL: section items grid 12 x 10 { ... }
    const sectionChildren = new Array<LayoutElement>();
    let runningSubtotal: f64 = 0.0;

    const groupedItems = new Map<string, Array<InvoiceItem>>();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        item.total = item.quantity * item.unitPrice;
        runningSubtotal += item.total;

        const category = item.category ? item.category! : DEFAULT_CATEGORY;
        if (!groupedItems.has(category)) {
            groupedItems.set(category, new Array<InvoiceItem>());
        }
        groupedItems.get(category).push(item); // Non-null assertion
    }

    // Iterate directly over the keys array returned by Map.keys()
    const categories = groupedItems.keys(); // Returns Array<string>

    for (let i = 0; i < categories.length; i++) { // Use .length directly
        const category = categories[i]; // Access using index
        const categoryItems = groupedItems.get(category); // Get items for this category

        const categoryHeader = new TextElement(category, "heading3");
        applyStyle(categoryHeader, instantiateStyle(new PartialStyle(null, null, "1px solid #eee", "0.2em", "1em")));
        sectionChildren.push(categoryHeader);

        sectionChildren.push(createItemTableHeaderRow_StdDetailed());

        // Check if categoryItems is not null before iterating
        if (categoryItems) {
            for (let j = 0; j < categoryItems.length; j++) {
                const item = categoryItems[j];
                const itemRow = new RowElement([
                    // Spans: 6, 2, 2, 2 (total 12)
                applyStyle(new ColumnElement([new TextElement(item.description)]), instantiateStyle(new PartialStyle())),
                applyStyle(new ColumnElement([new TextElement(item.quantity.toString())]), instantiateStyle(new PartialStyle("right"))),
                applyStyle(new ColumnElement([new TextElement(formatCurrency(item.unitPrice))]), instantiateStyle(new PartialStyle("right"))),
                applyStyle(new ColumnElement([new TextElement(formatCurrency(item.total))]), instantiateStyle(new PartialStyle("right"))),
            ]);
            itemRow.id = "item-row-" + item.id;
            sectionChildren.push(itemRow);
            }
        } // Closing brace for if(categoryItems)
    } // Closing brace for for loop

    const itemsSection = new SectionElement(sectionChildren);
    itemsSection.id = "invoice-items-std-detailed";
    return new ItemsSectionResult(itemsSection, runningSubtotal);
}
// *** END CORRECTED function ***

function createItemTableHeaderRow_StdDetailed(): RowElement {
    // Corresponds to fields: description, quantity, unit_price, total_price
    const headerRow = new RowElement([
        applyStyle(new ColumnElement([new TextElement("Description", "label")]), instantiateStyle(new PartialStyle())), // Span 6
        applyStyle(new ColumnElement([new TextElement("Qty", "label")]), instantiateStyle(new PartialStyle("right"))), // Span 2
        applyStyle(new ColumnElement([new TextElement("Unit Price", "label")]), instantiateStyle(new PartialStyle("right"))), // Span 2
        applyStyle(new ColumnElement([new TextElement("Total", "label")]), instantiateStyle(new PartialStyle("right"))), // Span 2
    ]);
    const headerStyle = new ElementStyle();
    headerStyle.fontWeight = "bold";
    headerStyle.borderBottom = "1px solid #ccc";
    headerStyle.paddingBottom = "0.5em";
    applyStyle(headerRow, headerStyle);
    return headerRow;
}

function createTotalsSection_StdDetailed(subtotal: f64, tax: f64, total: f64): SectionElement {
    // DSL: section summary grid 12 x 5 { ... }
    const spacerCol = new ColumnElement([]);
    spacerCol.span = 7;

    const labelCol = new ColumnElement([
        new TextElement("Subtotal"),
        new TextElement("Tax"),
        new TextElement("Total")
    ]);
    labelCol.span = 2;
    applyStyle(labelCol, instantiateStyle(new PartialStyle("right")));

    const valueCol = new ColumnElement([
        new TextElement(formatCurrency(subtotal)),
        new TextElement(formatCurrency(tax)),
        applyStyle(new TextElement(formatCurrency(total)), instantiateStyle(new PartialStyle(null, "bold"))) // Apply bold style
    ]);
    valueCol.span = 3;
    applyStyle(valueCol, instantiateStyle(new PartialStyle("right")));

    const totalsRow = new RowElement([spacerCol, labelCol, valueCol]);
    const totalsSection = new SectionElement([totalsRow]);
    totalsSection.id = "invoice-totals-std-detailed";

    const sectionStyle = new ElementStyle();
    sectionStyle.borderTop = "1px solid #eee";
    sectionStyle.paddingTop = "1em";
    sectionStyle.marginTop = "1em";
    applyStyle(totalsSection, sectionStyle);

    return totalsSection;
}

function createNotesSection_StdDetailed(viewModel: InvoiceViewModel): SectionElement | null {
    // Handles both the explicit notes field and the "Thank you" text from the DSL summary
    const notesContent = new Array<LayoutElement>();

    if (viewModel.notes && viewModel.notes!.length > 0) {
        notesContent.push(new TextElement("Notes:", "heading3"));
        notesContent.push(new TextElement(viewModel.notes!));
    }

    // Add the "Thank you" message from the DSL
    const thankYouText = new TextElement("Thank you for your business!");
    const thankYouStyle = new ElementStyle();
    thankYouStyle.marginTop = "1em"; // Add some space before it
    applyStyle(thankYouText, thankYouStyle);
    notesContent.push(thankYouText);


    if (notesContent.length > 0) {
        const notesSection = new SectionElement(notesContent);
        notesSection.id = "invoice-notes-std-detailed";
        const sectionStyle = new ElementStyle();
        sectionStyle.marginTop = "2em"; // Space before notes section
        applyStyle(notesSection, sectionStyle);
        return notesSection;
    }

    return null;
}