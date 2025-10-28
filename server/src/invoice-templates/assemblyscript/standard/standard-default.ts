// Keep JSON import only for parse:
import { JSON } from "json-as";
import {
  InvoiceViewModel, InvoiceItem,
  LayoutElement, ElementStyle, RowElement, ColumnElement, DocumentElement, SectionElement, TextElement, ImageElement,
  log
} from "../assembly/types"; // Adjusted import path
import { applyStyle, instantiateStyle, PartialStyle } from "../assembly/common/style-helpers"; // Adjusted import path
import { formatCurrency } from "../assembly/common/format-helpers"; // Adjusted import path

// --- Constants ---
const DEFAULT_CATEGORY = "Items"; // Simpler default category
const FALLBACK_TAX_RATE: f64 = 0.10; // Example tax rate (10%) - used only when invoice data does not provide totals

// --- Main Export ---
// @ts-ignore: decorator
@unsafe
export function generateLayout(dataString: string): string {
  log("Wasm (standard-default): Received data string.");

  // Initialize viewModel and parse (no try-catch in release builds)
  // Note: Parsing errors will likely cause an abort via the host or runtime traps.
  // Robust error handling might require a custom JSON parser or validation *before* parsing.
  const viewModel = JSON.parse<InvoiceViewModel>(dataString);

  // Basic validation after parsing
  // Check for null customer object after the change in types.ts
  if (!viewModel || viewModel.invoiceNumber == null || viewModel.invoiceNumber == "") {
    log("Wasm (standard-default): Error - Deserialization failed or key property missing.");
    const errorDoc = new DocumentElement([new TextElement("Error: Invalid input data.")]);
    return errorDoc.toJsonString(); // Use toJsonString
  }
  log("Wasm (standard-default): Deserialized Invoice #: " + viewModel.invoiceNumber);

  // --- Build Layout ---
  const headerSection = createHeaderSection_StdDefault(viewModel);
  const itemsResult = createItemsSection_StdDefault(viewModel.items);
  const itemsSection = itemsResult.section;
  const derivedSubtotal = itemsResult.subtotal;

  const hasProvidedTotals = (viewModel.subtotal > 0) || (viewModel.tax > 0) || (viewModel.total > 0);

  let displaySubtotal = hasProvidedTotals ? viewModel.subtotal : derivedSubtotal;
  let displayTax = hasProvidedTotals ? viewModel.tax : derivedSubtotal * FALLBACK_TAX_RATE;
  let displayTotal = hasProvidedTotals ? viewModel.total : displaySubtotal + displayTax;

  if (displayTotal <= 0 && displaySubtotal > 0) {
    displayTotal = displaySubtotal + displayTax;
  }

  const totalsSection = createTotalsSection_StdDefault(displaySubtotal, displayTax, displayTotal);

  // Create Notes Section with Thank You message
  const notesContent = new Array<LayoutElement>();
  
  // Add notes from the viewModel if available
  if (viewModel.notes && viewModel.notes!.length > 0) {
    notesContent.push(new TextElement("Notes:", "heading3"));
    notesContent.push(new TextElement(viewModel.notes!));
  }
  
  // Add "Thank you" message
  const thankYouText = new TextElement("Thank you for your business!");
  const thankYouStyle = new ElementStyle();
  thankYouStyle.marginTop = "1em";
  thankYouStyle.paddingLeft = "0.5em";
  applyStyle(thankYouText, thankYouStyle);
  notesContent.push(thankYouText);
  
  // Create Notes Section
  const notesSection = new SectionElement(notesContent);
  notesSection.id = "invoice-notes-std-default";
  
  const notesSectionStyle = new ElementStyle();
  notesSectionStyle.marginTop = "2em";
  applyStyle(notesSection, notesSectionStyle);
  
  // Add all sections to document
  const document = new DocumentElement([
    headerSection,
    itemsSection,
    totalsSection,
    notesSection
  ]);
  document.id = "invoice-document-standard-default";

  log("Wasm (standard-default): Serializing layout...");
  const resultString = document.toJsonString(); // Use toJsonString
  log("Wasm (standard-default): Returning serialized layout.");
  return resultString;
}

// --- Section Creation Helpers (Specific to standard-default) ---

function createHeaderSection_StdDefault(viewModel: InvoiceViewModel): SectionElement {
  // DSL: section header grid 12 x 3 {
  //          field client.logo at 1 1 span 3 2
  //          field client.name at 4 1 span 5 1
  //          field invoice_number at 10 1 span 3 1
  //          field invoice_date at 10 2 span 3 1
  //      }
  
  // --- Logo Column ---
  let logoCol: ColumnElement;
  // Check if tenantClient and logoUrl exist
  if (viewModel.tenantClient != null && viewModel.tenantClient!.logoUrl != null && viewModel.tenantClient!.logoUrl!.length > 0) {
    const logoElement = new ImageElement(viewModel.tenantClient!.logoUrl!, "Tenant Client Logo");

    // Apply proper sizing to logo
    const logoStyle = new PartialStyle();
    logoStyle.width = "150px";
    logoElement.style = instantiateStyle(logoStyle);

    logoCol = new ColumnElement([logoElement]);
  } else {
    // Placeholder if no logo URL is provided
    logoCol = new ColumnElement([new TextElement("[Tenant Logo]")]);
  }
  logoCol.span = 3;

  // --- Client Info Column ---
  const tenantName = viewModel.tenantClient != null && viewModel.tenantClient!.name != null ?
                    viewModel.tenantClient!.name! :
                    "[Tenant Name]";
  const tenantAddress = viewModel.tenantClient != null && viewModel.tenantClient!.address != null ?
                        viewModel.tenantClient!.address! :
                        "[Tenant Address]";
  
  const clientInfoCol = new ColumnElement([
    new TextElement(tenantName, "heading3"),
    new TextElement(tenantAddress)
  ]);
  clientInfoCol.span = 5;
  
  // Apply padding to client info
  const clientInfoStyle = new PartialStyle();
  clientInfoStyle.paddingLeft = "0.5em";
  clientInfoStyle.paddingTop = "0.5em";
  applyStyle(clientInfoCol, instantiateStyle(clientInfoStyle));

  // --- Invoice Info Column ---
  const invoiceInfoCol = new ColumnElement([
    new TextElement("Invoice #: " + viewModel.invoiceNumber),
    new TextElement("Date: " + viewModel.issueDate)
  ]);
  invoiceInfoCol.span = 4;
  
  // Create right-align style with padding
  const rightAlignStyle = new PartialStyle();
  rightAlignStyle.textAlign = "right";
  rightAlignStyle.paddingRight = "0.5em";
  applyStyle(invoiceInfoCol, instantiateStyle(rightAlignStyle));

  // --- Customer Info Row ---
  const customerInfoCol = new ColumnElement([
    new TextElement("Bill To:", "heading3"),
    new TextElement(viewModel.customer ? viewModel.customer!.name : "[Customer Name]"), // Add null check
    new TextElement(viewModel.customer ? viewModel.customer!.address : "[Customer Address]") // Add null check
  ]);
  customerInfoCol.span = 6;
  
  // Apply padding to improve visual layout
  const customerInfoStyle = new PartialStyle();
  customerInfoStyle.paddingLeft = "1em";
  customerInfoStyle.paddingTop = "0.5em";
  applyStyle(customerInfoCol, instantiateStyle(customerInfoStyle));
  
  // Create header rows
  const headerRow1 = new RowElement([logoCol, clientInfoCol, invoiceInfoCol]);
  const headerRow2 = new RowElement([customerInfoCol]);
  
  // Create and return the header section
  const headerSection = new SectionElement([headerRow1, headerRow2]);
  headerSection.id = "invoice-header-std-default";
  
  return headerSection;
}

class ItemsSectionResult {
    section: SectionElement;
    subtotal: f64;
    constructor(section: SectionElement, subtotal: f64) { this.section = section; this.subtotal = subtotal; }
}

function createItemsSection_StdDefault(items: Array<InvoiceItem>): ItemsSectionResult {
    // DSL: section items grid 12 x 10 {
    //          list invoice_items group by category {
    //              field description at 1 1 span 6 1
    //              field quantity at 7 1 span 2 1
    //              field price at 9 1 span 2 1
    //              field total at 11 1 span 2 1
    //              calculate subtotal as sum total
    //          }
    //      }
    const sectionChildren = new Array<LayoutElement>();
    let runningSubtotal: f64 = 0.0;

    const groupedItems = new Map<string, Array<InvoiceItem>>();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        item.total = item.quantity * item.unitPrice; // Recalculate total
        runningSubtotal += item.total;

        const category = item.category ? item.category! : DEFAULT_CATEGORY;
        if (!groupedItems.has(category)) {
            groupedItems.set(category, new Array<InvoiceItem>());
        }
        // Add non-null assertion as the key is guaranteed to exist here
        groupedItems.get(category).push(item);
    }

    // Iterate directly over the keys array returned by Map.keys()
    const categories = groupedItems.keys(); // Returns Array<string>

    for (let i = 0; i < categories.length; i++) { // Use .length directly
        const category = categories[i]; // Access using index
        const categoryItems = groupedItems.get(category); // Get items for this category

        // Add Category Header with improved styling
        const categoryHeader = new TextElement(category, "heading3");
        
        // Apply style to category header
        const categoryHeaderTextStyle = new PartialStyle();
        categoryHeaderTextStyle.marginTop = "1em"; // Add space above the header
        categoryHeaderTextStyle.paddingBottom = "0.2em"; // Small space below text before table section
        categoryHeaderTextStyle.paddingLeft = "0.5em"; // Left padding for alignment
        applyStyle(categoryHeader, instantiateStyle(categoryHeaderTextStyle));
        
        sectionChildren.push(categoryHeader);
        
        // Create section for items table with border and padding
        const itemsTableChildren = new Array<LayoutElement>();
        
        // Add Item Table Header Row
        itemsTableChildren.push(createItemTableHeaderRow_StdDefault());

        // Add Item Rows
        // Check if categoryItems is not null before iterating
        if (categoryItems) {
            for (let j = 0; j < categoryItems.length; j++) {
                const item = categoryItems[j];
                const formattedUnitPrice = formatCurrency(item.unitPrice);
                const formattedTotal = formatCurrency(item.total);
                
                // Description column with left padding
                const defaultStyleForRow = new PartialStyle();
                defaultStyleForRow.paddingLeft = "0.5em";  // Add left padding to description
                const itemDescCol = applyStyle(new ColumnElement([new TextElement(item.description)]), instantiateStyle(defaultStyleForRow));
                itemDescCol.span = 6;
                
                // Quantity column with right alignment
                const rightAlignStyleForRow = new PartialStyle();
                rightAlignStyleForRow.textAlign = "right";
                const itemQtyCol = applyStyle(new ColumnElement([new TextElement(item.quantity.toString())]), instantiateStyle(rightAlignStyleForRow));
                itemQtyCol.span = 2;
                
                // Price column with right alignment
                const itemPriceCol = applyStyle(new ColumnElement([new TextElement(formattedUnitPrice)]), instantiateStyle(rightAlignStyleForRow));
                itemPriceCol.span = 2;
                
                // Total column with right alignment and right padding
                const itemTotalRightStyle = new PartialStyle();
                itemTotalRightStyle.textAlign = "right";
                itemTotalRightStyle.paddingRight = "0.5em"; // Add right padding to price
                const itemTotalCol = applyStyle(new ColumnElement([new TextElement(formattedTotal)]), instantiateStyle(itemTotalRightStyle));
                itemTotalCol.span = 2;
                
                // Create the item row with improved styling
                const itemRow = new RowElement([itemDescCol, itemQtyCol, itemPriceCol, itemTotalCol]);
                itemRow.id = "item-row-" + item.id;
                
                // Add row styling with proper padding
                const itemRowStyle = new PartialStyle();
                itemRowStyle.borderBottom = "0px";
                itemRowStyle.paddingTop = "0.3em";
                itemRowStyle.paddingBottom = "0.3em";
                applyStyle(itemRow, instantiateStyle(itemRowStyle));
                
                itemsTableChildren.push(itemRow);
            }
        }
        
        // Create the section element for the items table
        const itemsTableSection = new SectionElement(itemsTableChildren);
        itemsTableSection.id = "items-table-section-" + category.replace(" ", "-").toLowerCase();
        
        // Apply border and padding to the items table section
        const itemsSectionStyle = new PartialStyle();
        itemsSectionStyle.border = "1px solid #ccc"; // Use border shorthand
        itemsSectionStyle.paddingTop = "1em";       // Add top padding
        itemsSectionStyle.paddingBottom = "1em";    // Add bottom padding
        itemsSectionStyle.paddingLeft = "1em";      // Add left padding
        itemsSectionStyle.paddingRight = "1em";     // Add right padding
        itemsSectionStyle.marginBottom = "1em";     // Add bottom margin
        applyStyle(itemsTableSection, instantiateStyle(itemsSectionStyle));
        
        // Add the section to the parent
        sectionChildren.push(itemsTableSection);
    }

    const itemsSection = new SectionElement(sectionChildren);
    itemsSection.id = "invoice-items-std-default";
    return new ItemsSectionResult(itemsSection, runningSubtotal);
}

function createItemTableHeaderRow_StdDefault(): RowElement {
    // Description Column
    const descPartialStyle = new PartialStyle();
    descPartialStyle.paddingLeft = "0.5em";  // Add left padding to match item rows
    const descElementStyle = instantiateStyle(descPartialStyle);
    const descTextElement = new TextElement("Description", "label");
    const descColumnElement = new ColumnElement([descTextElement]);
    const descCol = applyStyle(descColumnElement, descElementStyle);
    descCol.span = 6;

    // Quantity Column
    const qtyPartialStyle = new PartialStyle();
    qtyPartialStyle.textAlign = "right";
    const qtyElementStyle = instantiateStyle(qtyPartialStyle);
    const qtyTextElement = new TextElement("Qty", "label");
    const qtyColumnElement = new ColumnElement([qtyTextElement]);
    const qtyCol = applyStyle(qtyColumnElement, qtyElementStyle);
    qtyCol.span = 2;

    // Price Column
    const pricePartialStyle = new PartialStyle();
    pricePartialStyle.textAlign = "right";
    const priceElementStyle = instantiateStyle(pricePartialStyle);
    const priceTextElement = new TextElement("Unit Price", "label");
    const priceColumnElement = new ColumnElement([priceTextElement]);
    const priceCol = applyStyle(priceColumnElement, priceElementStyle);
    priceCol.span = 2;

    // Total Column
    const totalPartialStyle = new PartialStyle();
    totalPartialStyle.textAlign = "right";
    const totalElementStyle = instantiateStyle(totalPartialStyle);
    const totalTextElement = new TextElement("Total", "label");
    
    const totalTextElementStyle = new PartialStyle();
    totalTextElementStyle.fontWeight = "bold";
    totalTextElementStyle.paddingRight = "0.5em";  // Add proper right padding
    totalTextElement.style = instantiateStyle(totalTextElementStyle);
    
    const totalColumnElement = new ColumnElement([totalTextElement]);
    const totalCol = applyStyle(totalColumnElement, totalElementStyle);
    totalCol.span = 2;

    // Create the header row with all columns
    const headerRow = new RowElement([descCol, qtyCol, priceCol, totalCol]);

    // Apply styling to the entire row
    const headerStyle = new ElementStyle();
    headerStyle.fontWeight = "bold";
    headerStyle.borderBottom = "1px solid #ccc";
    headerStyle.paddingBottom = "0.5em";
    applyStyle(headerRow, headerStyle);
    
    return headerRow;
}

function createTotalsSection_StdDefault(subtotal: f64, tax: f64, total: f64): SectionElement {
    // DSL: section summary grid 12 x 4 {
    //          text "Subtotal" at 8 1 span 2 1
    //          field subtotal at 10 1 span 3 1
    //          text "Tax" at 8 2 span 2 1
    //          field tax at 10 2 span 3 1
    //          text "Total" at 8 3 span 2 1
    //          field total at 10 3 span 3 1
    //          style total { font-weight: "bold"; font-size: 16; }
    //      }
    // Using 3 columns: Spacer (span 7), Labels (span 2), Values (span 3)
    const spacerCol = new ColumnElement([]);
    spacerCol.span = 7;

    const labelCol = new ColumnElement([
        new TextElement("Subtotal"),
        new TextElement("Tax"),
        new TextElement("Total")
    ]);
    labelCol.span = 2;
    
    // Create right-aligned style with padding for labels
    const totalsLabelStyle = new PartialStyle();
    totalsLabelStyle.textAlign = "right";
    totalsLabelStyle.paddingRight = "1em"; // Add right padding to labels
    applyStyle(labelCol, instantiateStyle(totalsLabelStyle));

    // Use bold font for the total value
    const totalValue = new TextElement(formatCurrency(total));
    const totalValueStyle = new PartialStyle();
    totalValueStyle.fontWeight = "bold";
    applyStyle(totalValue, instantiateStyle(totalValueStyle));
    
    const valueCol = new ColumnElement([
        new TextElement(formatCurrency(subtotal)),
        new TextElement(formatCurrency(tax)),
        totalValue
    ]);
    valueCol.span = 3;
    
    // Add right-aligned style with padding for values
    const totalsValueStyle = new PartialStyle();
    totalsValueStyle.textAlign = "right";
    totalsValueStyle.paddingRight = "0.5em"; // Add right padding to values
    applyStyle(valueCol, instantiateStyle(totalsValueStyle));

    // Create totals row and section
    const totalsRow = new RowElement([spacerCol, labelCol, valueCol]);
    const totalsSection = new SectionElement([totalsRow]);
    totalsSection.id = "invoice-totals-std-default";
    
    // Add top border and proper spacing
    const sectionStyle = new ElementStyle();
    sectionStyle.borderTop = "1px solid #eee";
    sectionStyle.paddingTop = "1em";
    sectionStyle.marginTop = "1em";
    sectionStyle.paddingBottom = "1em"; // Add bottom padding
    applyStyle(totalsSection, sectionStyle);

    return totalsSection;
}
