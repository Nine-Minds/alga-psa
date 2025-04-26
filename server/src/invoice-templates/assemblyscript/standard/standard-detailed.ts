import { JSON } from "json-as";
import {
  InvoiceViewModel, InvoiceItem,
  LayoutElement, ElementStyle, RowElement, ColumnElement, DocumentElement, SectionElement, TextElement,
  log
} from "../assembly/types";
import { applyStyle, instantiateStyle, PartialStyle } from "../assembly/common/style-helpers";
import { formatCurrency } from "../assembly/common/format-helpers";

// --- Constants ---
const DEFAULT_CATEGORY = "Items";
const TAX_RATE: f64 = 0.10;

// --- Main Export ---
// @ts-ignore: decorator
@unsafe
export function generateLayout(dataString: string): string {
  // Initialize viewModel and parse (no try-catch in release builds)
  const viewModel = JSON.parse<InvoiceViewModel>(dataString);

  // Basic validation after parsing
  if (!viewModel || viewModel.invoiceNumber == null || viewModel.invoiceNumber == "") {
    log("Wasm (standard-detailed): Error - Deserialization failed or key property missing.");
    const errorDoc = new DocumentElement([new TextElement("Error: Invalid input data.")]);
    return errorDoc.toJsonString();
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
  const notesSection = createNotesSection_StdDetailed(viewModel);

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
  const resultString = document.toJsonString();
  log("Wasm (standard-detailed): Returning serialized layout.");
  return resultString;
}

// --- Section Creation Helpers (Specific to standard-detailed) ---

function createHeaderSection_StdDetailed(viewModel: InvoiceViewModel): SectionElement {
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
    let len:i32 = items.length;
    let lenStr = len.toString();

    const categoryKeys = new Array<string>();

    for (let i = 0; i < len; i++) {
        const item = items[i];
        if (!item) {
          continue;
        }

        item.total = item.quantity * item.unitPrice;
        runningSubtotal += item.total;

        let category = item.category ? item.category! : DEFAULT_CATEGORY;
        if (category == "") {
            category = DEFAULT_CATEGORY;
        }

        if (!groupedItems.has(category)) {
            groupedItems.set(category, new Array<InvoiceItem>());
            // Only push the category key if it's the first time we see this category
            // Use indexOf to check for existence as iterators are not supported
            if (categoryKeys.indexOf(category) == -1) {
                categoryKeys.push(category);
            }
        }
        const itemsForCategory = groupedItems.get(category);
        if (itemsForCategory) {
            itemsForCategory.push(item);
        } else {
            // This case should ideally not happen based on the logic above
            log("Wasm Error: Category '" + category + "' not found in groupedItems map during push.");
        }
    }

    // Now categoryKeys contains unique category names.
    const categories = categoryKeys;

    let categoryLen:i32 = categories.length;

    // Iterate over unique categories
    for (let i = 0; i < categoryLen; i++) { // Use .length directly
        const category = categories[i]; // Access using index
        // Removed the check if (groupedItems.has(category) == false) as categoryKeys now only contains keys that exist in groupedItems


        let categoryItems:InvoiceItem[] = []; // Get items for this category
        // Add logging for categoryItems
        if (groupedItems.has(category)) { // Check for null/undefined explicitly
            log("Wasm Debug: Found categoryItems for category '" + category + "'. Length: " + categoryLen.toString());
            categoryItems = groupedItems.get(category) || [];
        } else {
            log("Wasm Warning: categoryItems is null or undefined for category '" + category + "'. Skipping inner loop.");
            // Explicitly set to an empty array if null to prevent potential errors later if accessed
            // categoryItems = new Array<InvoiceItem>(); // Optional: Depends if code later assumes it's non-null
            categoryItems = [];
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

                const itemPriceCol = applyStyle(new ColumnElement([new TextElement(formattedUnitPrice)]), instantiateStyle(rightAlignStyleForRow)); // Span 2, Use pre-formatted value
                itemPriceCol.span = 2; // Explicitly set span

                const itemTotalCol = applyStyle(new ColumnElement([new TextElement(formattedTotal)]), instantiateStyle(rightAlignStyleForRow)); // Span 2, Use pre-formatted value
                itemTotalCol.span = 2; // Explicitly set span


                const itemRow = new RowElement([itemDescCol, itemQtyCol, itemPriceCol, itemTotalCol]);
                itemRow.id = "item-row-" + item.id;
                sectionChildren.push(itemRow);
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
    // Corresponds to fields: description, quantity, unit_price, total_price
    // Description Column (No specific alignment)
    const descPartialStyle = new PartialStyle();
    const descElementStyle = instantiateStyle(descPartialStyle);
    const descTextElement = new TextElement("Description", "label");
    const descColumnElement = new ColumnElement([descTextElement]);
    const descCol = applyStyle(descColumnElement, descElementStyle); // Span 6

    // Quantity Column (Right aligned - Modified Creation)
    const qtyPartialStyle = new PartialStyle(); // Create default
    qtyPartialStyle.textAlign = "right";      // Set property
    const qtyElementStyle = instantiateStyle(qtyPartialStyle);
    const qtyTextElement = new TextElement("Qty", "label");
    const qtyColumnElement = new ColumnElement([qtyTextElement]);
    const qtyCol = applyStyle(qtyColumnElement, qtyElementStyle); // Span 2

    // Price Column (Right aligned - Modified Creation)
    const pricePartialStyle = new PartialStyle(); // Create default
    pricePartialStyle.textAlign = "right";      // Set property
    const priceElementStyle = instantiateStyle(pricePartialStyle);
    const priceTextElement = new TextElement("Unit Price", "label");
    const priceColumnElement = new ColumnElement([priceTextElement]);
    const priceCol = applyStyle(priceColumnElement, priceElementStyle); // Span 2

    // Total Column (Right aligned - Modified Creation)
    const totalPartialStyle = new PartialStyle(); // Create default
    totalPartialStyle.textAlign = "right";      // Set property
    const totalElementStyle = instantiateStyle(totalPartialStyle);
    const totalTextElement = new TextElement("Total", "label");
    const totalColumnElement = new ColumnElement([totalTextElement]);
    const totalCol = applyStyle(totalColumnElement, totalElementStyle); // Span 2


    const headerRow = new RowElement([descCol, qtyCol, priceCol, totalCol]);

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