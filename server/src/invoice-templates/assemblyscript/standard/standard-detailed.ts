import { JSON } from "json-as";
import {
  InvoiceViewModel, InvoiceItem,
  LayoutElement, ElementStyle, RowElement, ColumnElement, DocumentElement, SectionElement, TextElement, ImageElement,
  log
} from "../assembly/types";
import { applyStyle, instantiateStyle, PartialStyle } from "../assembly/common/style-helpers";
import { formatCurrency } from "../assembly/common/format-helpers";

// --- Constants ---
const DEFAULT_CATEGORY = "Items";
const FALLBACK_TAX_RATE: f64 = 0.10;

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
  const documentChildren = new Array<LayoutElement>(); // Initialize the array

  // Call helpers, passing the children array
  createHeaderSection_StdDetailed(viewModel, documentChildren);

  // createItemsSection now returns only the subtotal and modifies documentChildren directly
  const derivedSubtotal = createItemsSection_StdDetailed(viewModel.items, documentChildren, viewModel.currencyCode);

  const hasProvidedTotals = (viewModel.subtotal > 0) || (viewModel.tax > 0) || (viewModel.total > 0);

  let displaySubtotal = hasProvidedTotals ? viewModel.subtotal : derivedSubtotal;
  let displayTax = hasProvidedTotals ? viewModel.tax : derivedSubtotal * FALLBACK_TAX_RATE;
  let displayTotal = hasProvidedTotals ? viewModel.total : displaySubtotal + displayTax;

  if (displayTotal <= 0 && displaySubtotal > 0) {
    displayTotal = displaySubtotal + displayTax;
  }

  // Pass children array to totals and notes sections
  createTotalsSection_StdDetailed(displaySubtotal, displayTax, displayTotal, documentChildren, viewModel.currencyCode);
  createNotesSection_StdDetailed(viewModel, documentChildren);

  // documentChildren array is now populated by the helper functions

  const document = new DocumentElement(documentChildren);
  document.id = "invoice-document-standard-detailed";

  log("Wasm (standard-detailed): Serializing layout...");
  const resultString = document.toJsonString();
  log("Wasm (standard-detailed): Returning serialized layout.");
  return resultString;
}

// --- Section Creation Helpers (Specific to standard-detailed) ---

// Modified to accept children array and return void
function createHeaderSection_StdDetailed(viewModel: InvoiceViewModel, children: Array<LayoutElement>): void {

  let logoCol: ColumnElement;
  // --- Tenant Logo ---
  // Check if tenantClient and logoUrl exist
  if (viewModel.tenantClient != null && viewModel.tenantClient!.logoUrl != null && viewModel.tenantClient!.logoUrl!.length > 0) {
    const logoElement = new ImageElement(viewModel.tenantClient!.logoUrl!, "Tenant Client Logo");
    const logoStyle = new PartialStyle();
    logoStyle.width = "150px";
    logoElement.style = instantiateStyle(logoStyle);
    logoCol = new ColumnElement([logoElement]);
  } else {
    // Placeholder if no logo URL is provided
    logoCol = new ColumnElement([new TextElement("[Tenant Logo]")]);
  }
  logoCol.span = 3; // Keep existing span

  // --- Tenant Client Name & Address ---
  const tenantName = viewModel.tenantClient != null && viewModel.tenantClient!.name != null ? viewModel.tenantClient!.name! : "[Tenant Name]";
  const tenantAddress = viewModel.tenantClient != null && viewModel.tenantClient!.address != null ? viewModel.tenantClient!.address! : "[Tenant Address]";
  const clientInfoCol = new ColumnElement([
    new TextElement(tenantName, "heading3"), // Use a heading style for name
    new TextElement(tenantAddress)
  ]);
  clientInfoCol.span = 5; // Keep existing span

  // --- Invoice Info (Remains the same) ---
  const invoiceInfoChildren = new Array<LayoutElement>();
  invoiceInfoChildren.push(new TextElement("Invoice #: " + viewModel.invoiceNumber));
  invoiceInfoChildren.push(new TextElement("Date: " + viewModel.issueDate));
  if (viewModel.poNumber != null && viewModel.poNumber!.length > 0) {
    invoiceInfoChildren.push(new TextElement("PO #: " + viewModel.poNumber!));
  }
  const invoiceInfoCol = new ColumnElement(invoiceInfoChildren);
  invoiceInfoCol.span = 4;
  // Create PartialStyle separately for right alignment
  const rightAlignStyle = new PartialStyle();
  rightAlignStyle.textAlign = "right";
  applyStyle(invoiceInfoCol, instantiateStyle(rightAlignStyle));

  const customerInfoCol = new ColumnElement([
      new TextElement("Bill To:", "heading3"),
      new TextElement(viewModel.customer ? viewModel.customer!.name : "[Customer Name]"), // Add null check
      new TextElement(viewModel.customer ? viewModel.customer!.address : "[Customer Address]") // Add null check
  ]);
  customerInfoCol.span = 6; // Takes up half the width on a new line
  
  // Apply padding to improve visual layout
  const customerInfoStyle = new PartialStyle();
  customerInfoStyle.paddingLeft = "1em";
  customerInfoStyle.paddingTop = "0.5em";
  applyStyle(customerInfoCol, instantiateStyle(customerInfoStyle));

  const headerRow1 = new RowElement([logoCol, clientInfoCol, invoiceInfoCol]);
  const headerRow2 = new RowElement([customerInfoCol]); // Customer info on its own row

  const headerSection = new SectionElement([headerRow1, headerRow2]);
  headerSection.id = "invoice-header-std-detailed";
  children.push(headerSection); // Push directly to the passed array
}

// *** MODIFIED createItemsSection_StdDetailed function ***
// Accepts children array, returns only subtotal
function createItemsSection_StdDetailed(items: Array<InvoiceItem>, children: Array<LayoutElement>, currencyCode: string): number {
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

        // --- Create Section for Category Header ---
        log("Wasm Debug: Creating categoryHeader TextElement for category: " + category);
        const categoryHeader = new TextElement(category, "heading3");
        log("Wasm Debug: categoryHeader created.");

        // Apply style (e.g., margin) to the header text element itself if needed
        const categoryHeaderTextStyle = new PartialStyle();
        categoryHeaderTextStyle.marginTop = "1em"; // Add space above the header
        categoryHeaderTextStyle.paddingBottom = "0.2em"; // Small space below text before table section
        applyStyle(categoryHeader, instantiateStyle(categoryHeaderTextStyle));
        log("Wasm Debug: Style applied to categoryHeader TextElement.");

        // Add the styled TextElement header directly to the passed children array
        children.push(categoryHeader);
        log("Wasm Debug: Category header TextElement added.");


        // --- Create Section for Items Table (Header + Rows) ---
        const itemsTableChildren = new Array<LayoutElement>(); // Children for this specific table section

        log("Wasm Debug: Calling createItemTableHeaderRow_StdDetailed.");
        const tableHeaderRow = createItemTableHeaderRow_StdDetailed();
        log("Wasm Debug: createItemTableHeaderRow_StdDetailed returned.");
        itemsTableChildren.push(tableHeaderRow); // Add table header to this section's children
        log("Wasm Debug: tableHeaderRow pushed to itemsTableChildren.");

        // Check if categoryItems is not null AND has items before iterating
        if (categoryItems != null && categoryItems.length > 0) {
            log("Wasm Debug: Entering inner loop for category '" + category + "' with length " + categoryItems.length.toString());
            for (let j = 0; j < categoryItems.length; j++) {
                if (j >= categoryItems.length) {
                    log("Wasm Error: Index j=" + j.toString() + " out of bounds during loop for categoryItems.length=" + categoryItems.length.toString());
                    break;
                }
                log("Wasm Debug: Inner loop - Accessing categoryItems[" + j.toString() + "]");
                const item = categoryItems[j];

                // --- Create Item Row ---
                log("Wasm Debug: Preparing item row for item ID: " + item.id);
                const formattedUnitPrice = formatCurrency(item.unitPrice, currencyCode);
                const formattedTotal = formatCurrency(item.total, currencyCode);
                
                const rightAlignStyleForRow = new PartialStyle();
                rightAlignStyleForRow.textAlign = "right";
                
                const defaultStyleForRow = new PartialStyle();
                defaultStyleForRow.paddingLeft = "0.5em";  // Add left padding to description

                const itemDescCol = applyStyle(new ColumnElement([new TextElement(item.description)]), instantiateStyle(defaultStyleForRow));
                itemDescCol.span = 6;
                
                const itemQtyCol = applyStyle(new ColumnElement([new TextElement(item.quantity.toString())]), instantiateStyle(rightAlignStyleForRow));
                itemQtyCol.span = 2;
                
                const itemPriceCol = applyStyle(new ColumnElement([new TextElement(formattedUnitPrice)]), instantiateStyle(rightAlignStyleForRow));
                itemPriceCol.span = 2;
                
                const itemTotalRightStyle = new PartialStyle();
                itemTotalRightStyle.textAlign = "right";
                itemTotalRightStyle.paddingRight = "0.5em"; // Add right padding to price
                
                const itemTotalCol = applyStyle(new ColumnElement([new TextElement(formattedTotal)]), instantiateStyle(itemTotalRightStyle));
                itemTotalCol.span = 2;

                const itemRow = new RowElement([itemDescCol, itemQtyCol, itemPriceCol, itemTotalCol]);
                itemRow.id = "item-row-" + item.id;

                const itemRowStyle = new PartialStyle();
                itemRowStyle.borderBottom = "0px";
                itemRowStyle.paddingTop = "0.3em";
                itemRowStyle.paddingBottom = "0.3em";
                applyStyle(itemRow, instantiateStyle(itemRowStyle));

                itemsTableChildren.push(itemRow); // Add item row to this section's children
            }
        }

        // Create the section element for the items table
        const itemsTableSection = new SectionElement(itemsTableChildren);
        itemsTableSection.id = "items-table-section-" + category.replace(" ", "-").toLowerCase(); // Optional ID

        // Apply border and padding to the items table section
        const itemsSectionStyle = new PartialStyle();
        itemsSectionStyle.border = "1px solid #ccc"; // Use border shorthand
        itemsSectionStyle.paddingTop = "1em";       // Add top padding
        itemsSectionStyle.paddingBottom = "1em";    // Add bottom padding
        itemsSectionStyle.paddingLeft = "1em";      // Add left padding
        itemsSectionStyle.paddingRight = "1em";     // Add right padding
        // itemsSectionStyle.marginTop = "0.5em"; // Optional: Adjust margin if needed
        applyStyle(itemsTableSection, instantiateStyle(itemsSectionStyle));

        // Add the styled SectionElement containing the table directly to the passed children array
        children.push(itemsTableSection);
        log("Wasm Debug: Items table section added for category: " + category);
    } // Closing brace for for loop
    // End restore outer loop structure

    // Return only the subtotal
    return runningSubtotal as number;
}
// *** END CORRECTED function ***

function createItemTableHeaderRow_StdDetailed(): RowElement {
    // Corresponds to fields: description, quantity, unit_price, total_price
    // Description Column (No specific alignment)
    const descPartialStyle = new PartialStyle();
    descPartialStyle.paddingLeft = "0.5em";  // Add left padding to match item rows
    const descElementStyle = instantiateStyle(descPartialStyle);
    const descTextElement = new TextElement("Description", "label");
    const descColumnElement = new ColumnElement([descTextElement]);
    const descCol = applyStyle(descColumnElement, descElementStyle); // Span 6
    descCol.span = 6;

    // Quantity Column (Right aligned - Modified Creation)
    const qtyPartialStyle = new PartialStyle(); // Create default
    qtyPartialStyle.textAlign = "right";      // Set property
    const qtyElementStyle = instantiateStyle(qtyPartialStyle);
    const qtyTextElement = new TextElement("Qty", "label");
    const qtyColumnElement = new ColumnElement([qtyTextElement]);
    const qtyCol = applyStyle(qtyColumnElement, qtyElementStyle); // Span 2
    qtyCol.span = 2;

    // Price Column (Right aligned - Modified Creation)
    const pricePartialStyle = new PartialStyle(); // Create default
    pricePartialStyle.textAlign = "right";      // Set property
    const priceElementStyle = instantiateStyle(pricePartialStyle);
    const priceTextElement = new TextElement("Unit Price", "label");
    const priceColumnElement = new ColumnElement([priceTextElement]);
    const priceCol = applyStyle(priceColumnElement, priceElementStyle); // Span 2
    priceCol.span = 2;

    // Total Column (Right aligned - Modified Creation)
    const totalPartialStyle = new PartialStyle(); // Create default
    totalPartialStyle.textAlign = "right";      // Set property
    const totalElementStyle = instantiateStyle(totalPartialStyle);
    const totalTextElement = new TextElement("Total", "label");
    
    const totalTextElementStyle = new PartialStyle();
    totalTextElementStyle.fontWeight = "bold";
    totalTextElementStyle.paddingRight = "0.5em"; // Add proper right padding
    totalTextElement.style = instantiateStyle(totalTextElementStyle);
    
    const totalColumnElement = new ColumnElement([totalTextElement]);
    const totalCol = applyStyle(totalColumnElement, totalElementStyle); // Span 2
    totalCol.span = 2;


    const headerRow = new RowElement([descCol, qtyCol, priceCol, totalCol]);

    const headerStyle = new ElementStyle();
    headerStyle.fontWeight = "bold";
    headerStyle.borderBottom = "1px solid #ccc";
    headerStyle.paddingBottom = "0.5em";
    applyStyle(headerRow, headerStyle);

    return headerRow;
}

// Modified to accept children array and return void
function createTotalsSection_StdDetailed(subtotal: f64, tax: f64, total: f64, children: Array<LayoutElement>, currencyCode: string): void {
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
    totalsLabelStyle.paddingRight = "1em"; // Add right padding to labels
    applyStyle(labelCol, instantiateStyle(totalsLabelStyle));

    const totalStyle = new PartialStyle();
    totalStyle.fontWeight = "bold";
    const totalText = applyStyle(new TextElement(formatCurrency(total, currencyCode)), instantiateStyle(totalStyle));
    
    const valueCol = new ColumnElement([
        new TextElement(formatCurrency(subtotal, currencyCode)),
        new TextElement(formatCurrency(tax, currencyCode)),
        totalText
    ]);
    valueCol.span = 3;
    // Apply right alignment separately
    const totalsValueStyle = new PartialStyle();
    totalsValueStyle.textAlign = "right";
    totalsValueStyle.paddingRight = "0.5em"; // Add right padding to values
    applyStyle(valueCol, instantiateStyle(totalsValueStyle));


    const totalsRow = new RowElement([spacerCol, labelCol, valueCol]);
    const totalsSection = new SectionElement([totalsRow]);
    totalsSection.id = "invoice-totals-std-detailed";

    const sectionStyle = new ElementStyle();
    sectionStyle.borderTop = "0px";
    sectionStyle.paddingTop = "1em";
    sectionStyle.marginTop = "1em";
    applyStyle(totalsSection, sectionStyle);
    children.push(totalsSection); // Push directly to the passed array
}

// Modified to accept children array and return void
function createNotesSection_StdDetailed(viewModel: InvoiceViewModel, children: Array<LayoutElement>): void {
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
        children.push(notesSection); // Push directly to the passed array
    }
    // No return needed
}
