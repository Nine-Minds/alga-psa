import { JSON } from "json-as"; // Re-added for JSON.parse
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
  log("Wasm (standard-detailed): Data string content: " + dataString);

  // Initialize viewModel and parse (no try-catch in release builds)
  const viewModel = JSON.parse<InvoiceViewModel>(dataString);

  // Basic validation after parsing
  if (!viewModel || viewModel.invoiceNumber == null || viewModel.invoiceNumber == "") {
    log("Wasm (standard-detailed): Error - Deserialization failed or key property missing.");
    const errorDoc = new DocumentElement([new TextElement("Error: Invalid input data.")]);
    return errorDoc.toJsonString(); // Use toJsonString
  }
  log("Wasm (standard-detailed): Deserialized Invoice #: " + viewModel.invoiceNumber);

  // --- Build Layout ---
  const headerSection = createHeaderSection_StdDetailed(viewModel); // Uncommented
  const itemsResult = createItemsSection_StdDetailed(viewModel.items);
  const itemsSection = itemsResult.section;
  const calculatedSubtotal = itemsResult.subtotal; // Uncommented
  const calculatedTax = calculatedSubtotal * TAX_RATE; // Uncommented
  const calculatedTotal = calculatedSubtotal + calculatedTax; // Uncommented
  const totalsSection = createTotalsSection_StdDetailed(calculatedSubtotal, calculatedTax, calculatedTotal); // Uncommented
  const notesSection = createNotesSection_StdDetailed(viewModel); // Add notes section

  const documentChildren: Array<LayoutElement> = [
    headerSection, // Uncommented
    itemsSection,
    totalsSection // Uncommented
  ];
  if (notesSection) {
      documentChildren.push(notesSection);
  }

  const document = new DocumentElement(documentChildren);
  document.id = "invoice-document-standard-detailed";

  log("Wasm (standard-detailed): Serializing layout...");
  const resultString = document.toJsonString(); // Use toJsonString
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
  // Create PartialStyle separately for right alignment
  const rightAlignStyle = new PartialStyle();
  rightAlignStyle.textAlign = "right";
  applyStyle(invoiceInfoCol, instantiateStyle(rightAlignStyle));

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
        // Add null check for safety
        const itemsForCategory = groupedItems.get(category);
        if (itemsForCategory) {
            itemsForCategory.push(item);
        } else {
            // This case should ideally not happen based on the logic in lines 115-117
            log("Wasm Error: Category '" + category + "' not found in groupedItems map during push.");
        }
    }

    // Iterate directly over the keys array returned by Map.keys()
    // Assume groupedItems.keys() returns an Array<string> directly as per asc error message
    // Assume groupedItems.keys() returns an Array<string> or similar array-like type
    // based on asc error messages indicating .next() doesn't exist.
    // Assume groupedItems.keys() returns an Array<string> or similar array-like type
    // based on asc error messages indicating .next() doesn't exist.
    const categories = groupedItems.keys();
    // Log the length instead of using .join() which might not be supported
    log("Wasm Debug: Categories found. Length: " + categories.length.toString());

    // Restore outer loop
    for (let i = 0; i < categories.length; i++) { // Use .length directly
        log("Wasm Debug: Outer loop - Accessing categories[" + i.toString() + "]. categories.length=" + categories.length.toString());
        // Bounds check for outer loop (defensive) - Keep this check
        if (i >= categories.length) {
             log("Wasm Error: Index i=" + i.toString() + " out of bounds during loop for categories.length=" + categories.length.toString());
             break;
        }
        const category = categories[i]; // Access using index
        const categoryItems = groupedItems.get(category); // Get items for this category
        // Add logging for categoryItems
        if (categoryItems != null) { // Check for null/undefined explicitly
            log("Wasm Debug: Found categoryItems for category '" + category + "'. Length: " + categoryItems.length.toString());
        } else {
            log("Wasm Warning: categoryItems is null or undefined for category '" + category + "'. Skipping inner loop.");
            // Explicitly set to an empty array if null to prevent potential errors later if accessed
            // categoryItems = new Array<InvoiceItem>(); // Optional: Depends if code later assumes it's non-null
        }

        log("Wasm Debug: Creating categoryHeader TextElement for category: " + category);
        const categoryHeader = new TextElement(category, "heading3");
        log("Wasm Debug: categoryHeader created.");

        log("Wasm Debug: Applying style to categoryHeader.");
        // Create PartialStyle separately
        const categoryHeaderStyle = new PartialStyle(null, null, "1px solid #eee", "0.2em", "1em");
        applyStyle(categoryHeader, instantiateStyle(categoryHeaderStyle));
        log("Wasm Debug: Style applied to categoryHeader.");

        log("Wasm Debug: Pushing categoryHeader to sectionChildren.");
        sectionChildren.push(categoryHeader);
        log("Wasm Debug: categoryHeader pushed.");

        // Restore table header row creation and push
        // log("Wasm Debug: SKIPPING createItemTableHeaderRow_StdDetailed call and push."); // Remove skip log
        log("Wasm Debug: Calling createItemTableHeaderRow_StdDetailed.");
        const tableHeaderRow = createItemTableHeaderRow_StdDetailed();
        log("Wasm Debug: createItemTableHeaderRow_StdDetailed returned.");

        log("Wasm Debug: Pushing tableHeaderRow to sectionChildren.");
        sectionChildren.push(tableHeaderRow);
        log("Wasm Debug: tableHeaderRow pushed.");
        // --- End restore ---

        // Check if categoryItems is not null AND has items before iterating
        if (categoryItems != null && categoryItems.length > 0) { // More robust check
            log("Wasm Debug: Entering inner loop for category '" + category + "' with length " + categoryItems.length.toString()); // Log before loop
            // Restore inner loop
            // The entire original for loop structure (lines 176-232) is restored below:
            for (let j = 0; j < categoryItems.length; j++) {
                // Explicit bounds check for safety before access - Keep this check
                if (j >= categoryItems.length) {
                    log("Wasm Error: Index j=" + j.toString() + " out of bounds during loop for categoryItems.length=" + categoryItems.length.toString());
                    // This should ideally not be reached if the loop condition is correct,
                    // but break defensively to prevent runtime abort.
                    break;
                }
                log("Wasm Debug: Inner loop - Accessing categoryItems[" + j.toString() + "]. categoryItems.length=" + categoryItems.length.toString());
                // Restore inner loop body
                const item = categoryItems[j];

                // Add logs before formatCurrency calls
                log("Wasm Debug: Preparing item row for item ID: " + item.id);
                log("Wasm Debug: Formatting unitPrice: " + item.unitPrice.toString());
                const formattedUnitPrice = formatCurrency(item.unitPrice);
                log("Wasm Debug: unitPrice formatted. Result: " + formattedUnitPrice);
                log("Wasm Debug: Formatting total: " + item.total.toString());
                const formattedTotal = formatCurrency(item.total);
                log("Wasm Debug: total formatted. Result: " + formattedTotal);

                // Now create the RowElement using the formatted values
                // Create PartialStyle separately for right alignment
                const rightAlignStyleForRow = new PartialStyle();
                rightAlignStyleForRow.textAlign = "right";
                const defaultStyleForRow = new PartialStyle(); // For description

                // Restore itemRow creation with styling
                log("Wasm Debug: Creating itemRow RowElement...");
                // Break down itemRow creation further
                log("Wasm Debug: Creating itemDescCol...");
                const itemDescCol = applyStyle(new ColumnElement([new TextElement(item.description)]), instantiateStyle(defaultStyleForRow)); // Span 6
                itemDescCol.span = 6; // Explicitly set span
                log("Wasm Debug: Created itemDescCol.");

                log("Wasm Debug: Creating itemQtyCol...");
                const itemQtyCol = applyStyle(new ColumnElement([new TextElement(item.quantity.toString())]), instantiateStyle(rightAlignStyleForRow)); // Span 2
                itemQtyCol.span = 2; // Explicitly set span
                log("Wasm Debug: Created itemQtyCol.");

                log("Wasm Debug: Creating itemPriceCol...");
                const itemPriceCol = applyStyle(new ColumnElement([new TextElement(formattedUnitPrice)]), instantiateStyle(rightAlignStyleForRow)); // Span 2, Use pre-formatted value
                itemPriceCol.span = 2; // Explicitly set span
                log("Wasm Debug: Created itemPriceCol.");

                log("Wasm Debug: Creating itemTotalCol...");
                const itemTotalCol = applyStyle(new ColumnElement([new TextElement(formattedTotal)]), instantiateStyle(rightAlignStyleForRow)); // Span 2, Use pre-formatted value
                itemTotalCol.span = 2; // Explicitly set span
                log("Wasm Debug: Created itemTotalCol.");

                log("Wasm Debug: Creating itemRow RowElement with pre-built cols...");
                const itemRow = new RowElement([itemDescCol, itemQtyCol, itemPriceCol, itemTotalCol]);
                log("Wasm Debug: itemRow RowElement created.");
                itemRow.id = "item-row-" + item.id;
                log("Wasm Debug: Created item row for item ID: " + item.id);
                sectionChildren.push(itemRow);
                log("Wasm Debug: Pushed item row for item ID: " + item.id);
                // End restore inner loop body
            }
            // End restore inner loop structure
        } // Closing brace for if(categoryItems)
    } // Closing brace for for loop
    // End restore outer loop structure

    const itemsSection = new SectionElement(sectionChildren);
    itemsSection.id = "invoice-items-std-detailed";
    return new ItemsSectionResult(itemsSection, runningSubtotal);
}
// *** END CORRECTED function ***

function createItemTableHeaderRow_StdDetailed(): RowElement {
    log("Wasm Debug: Entering createItemTableHeaderRow_StdDetailed.");
    // Corresponds to fields: description, quantity, unit_price, total_price
    log("Wasm Debug: Creating headerRow elements...");

    // Description Column (No specific alignment)
    const descPartialStyle = new PartialStyle();
    log("Wasm Debug: descPartialStyle created.");
    const descElementStyle = instantiateStyle(descPartialStyle);
    log("Wasm Debug: descElementStyle created.");
    const descTextElement = new TextElement("Description", "label");
    log("Wasm Debug: descTextElement created.");
    const descColumnElement = new ColumnElement([descTextElement]);
    log("Wasm Debug: descColumnElement created.");
    const descCol = applyStyle(descColumnElement, descElementStyle); // Span 6
    log("Wasm Debug: Created descCol (style applied).");

    // Quantity Column (Right aligned - Modified Creation)
    log("Wasm Debug: Creating qtyCol components (right aligned)...");
    const qtyPartialStyle = new PartialStyle(); // Create default
    qtyPartialStyle.textAlign = "right";      // Set property
    log("Wasm Debug: qtyPartialStyle created.");
    const qtyElementStyle = instantiateStyle(qtyPartialStyle);
    log("Wasm Debug: qtyElementStyle created.");
    const qtyTextElement = new TextElement("Qty", "label");
    log("Wasm Debug: qtyTextElement created.");
    const qtyColumnElement = new ColumnElement([qtyTextElement]);
    log("Wasm Debug: qtyColumnElement created.");
    const qtyCol = applyStyle(qtyColumnElement, qtyElementStyle); // Span 2
    log("Wasm Debug: Created qtyCol (style applied).");

    // Price Column (Right aligned - Modified Creation)
    log("Wasm Debug: Creating priceCol components (right aligned)...");
    const pricePartialStyle = new PartialStyle(); // Create default
    pricePartialStyle.textAlign = "right";      // Set property
    log("Wasm Debug: pricePartialStyle created.");
    const priceElementStyle = instantiateStyle(pricePartialStyle);
    log("Wasm Debug: priceElementStyle created.");
    const priceTextElement = new TextElement("Unit Price", "label");
    log("Wasm Debug: priceTextElement created.");
    const priceColumnElement = new ColumnElement([priceTextElement]);
    log("Wasm Debug: priceColumnElement created.");
    const priceCol = applyStyle(priceColumnElement, priceElementStyle); // Span 2
    log("Wasm Debug: Created priceCol (style applied).");

    // Total Column (Right aligned - Modified Creation)
    log("Wasm Debug: Creating totalCol components (right aligned)...");
    const totalPartialStyle = new PartialStyle(); // Create default
    totalPartialStyle.textAlign = "right";      // Set property
    log("Wasm Debug: totalPartialStyle created.");
    const totalElementStyle = instantiateStyle(totalPartialStyle);
    log("Wasm Debug: totalElementStyle created.");
    const totalTextElement = new TextElement("Total", "label");
    log("Wasm Debug: totalTextElement created.");
    const totalColumnElement = new ColumnElement([totalTextElement]);
    log("Wasm Debug: totalColumnElement created.");
    const totalCol = applyStyle(totalColumnElement, totalElementStyle); // Span 2
    log("Wasm Debug: Created totalCol (style applied).");


    log("Wasm Debug: Creating headerRow RowElement.");
    const headerRow = new RowElement([descCol, qtyCol, priceCol, totalCol]);
    log("Wasm Debug: headerRow RowElement created.");

    log("Wasm Debug: Creating headerStyle.");
    const headerStyle = new ElementStyle();
    headerStyle.fontWeight = "bold";
    headerStyle.borderBottom = "1px solid #ccc";
    headerStyle.paddingBottom = "0.5em";
    log("Wasm Debug: headerStyle created.");

    log("Wasm Debug: Applying headerStyle to headerRow.");
    applyStyle(headerRow, headerStyle);
    log("Wasm Debug: headerStyle applied.");

    log("Wasm Debug: Exiting createItemTableHeaderRow_StdDetailed.");
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
    // Create PartialStyle separately for right alignment
    const totalsLabelStyle = new PartialStyle();
    totalsLabelStyle.textAlign = "right";
    applyStyle(labelCol, instantiateStyle(totalsLabelStyle));

    const valueCol = new ColumnElement([
        new TextElement(formatCurrency(subtotal)),
        new TextElement(formatCurrency(tax)),
        applyStyle(new TextElement(formatCurrency(total)), instantiateStyle(new PartialStyle(null, "bold"))) // Keep bold style separate for now
    ]);
    valueCol.span = 3;
    // Apply right alignment separately
    const totalsValueStyle = new PartialStyle();
    totalsValueStyle.textAlign = "right";
    applyStyle(valueCol, instantiateStyle(totalsValueStyle));


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
    // Restore function body
    const notesContent = new Array<LayoutElement>();

    if (viewModel.notes && viewModel.notes!.length > 0) {
        notesContent.push(new TextElement("Notes:", "heading3"));
        notesContent.push(new TextElement(viewModel.notes!));
    }

    // Add the "Thank you" message from the DSL
    const thankYouText = new TextElement("Thank you for your business!");
    const thankYouStyle = new ElementStyle();
    thankYouStyle.marginTop = "1em"; // Add some space before it
    applyStyle(thankYouText, thankYouStyle); // Uncommented
    notesContent.push(thankYouText); // Uncommented


    if (notesContent.length > 0) {
        const notesSection = new SectionElement(notesContent);
        notesSection.id = "invoice-notes-std-detailed"; // Uncommented
        const sectionStyle = new ElementStyle(); // Uncommented
        sectionStyle.marginTop = "2em"; // Space before notes section // Uncommented
        applyStyle(notesSection, sectionStyle); // Uncommented
        return notesSection;
    }
    // End restore function body

    return null;
}