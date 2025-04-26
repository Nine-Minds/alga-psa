// Keep JSON import only for parse:
import { JSON } from "json-as";
import {
  InvoiceViewModel, InvoiceItem,
  LayoutElement, ElementStyle, RowElement, ColumnElement, DocumentElement, SectionElement, TextElement,
  log
} from "../assembly/types"; // Adjusted import path
import { applyStyle, instantiateStyle, PartialStyle } from "../assembly/common/style-helpers"; // Adjusted import path
import { formatCurrency } from "../assembly/common/format-helpers"; // Adjusted import path

// --- Constants ---
const DEFAULT_CATEGORY = "Items"; // Simpler default category
const TAX_RATE: f64 = 0.10; // Example tax rate (10%) - Should ideally come from host if variable

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
  const calculatedSubtotal = itemsResult.subtotal;
  const calculatedTax = calculatedSubtotal * TAX_RATE; // Simple tax calculation
  const calculatedTotal = calculatedSubtotal + calculatedTax;
  const totalsSection = createTotalsSection_StdDefault(calculatedSubtotal, calculatedTax, calculatedTotal);

  const document = new DocumentElement([
    headerSection,
    itemsSection,
    totalsSection
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
  //          field company.logo at 1 1 span 3 2
  //          field company.name at 4 1 span 5 1
  //          field invoice_number at 10 1 span 3 1
  //          field invoice_date at 10 2 span 3 1
  //      }
  // Note: Accessing company logo/name requires these fields on InvoiceViewModel or host functions.
  // Assuming they are available for now. If not, use placeholders or adjust ViewModel.
  const logoCol = new ColumnElement([/* TODO: Add ImageElement if logo URL available */ new TextElement("[Logo Placeholder]")]);
  logoCol.span = 3; // Roughly corresponds to span 3 2 in a 12-col grid (adjust as needed)

  const companyNameCol = new ColumnElement([new TextElement(viewModel.customer.name)]); // Using customer name as placeholder for company name
  companyNameCol.span = 5;

  const invoiceInfoCol = new ColumnElement([
    new TextElement("Invoice #: " + viewModel.invoiceNumber),
    new TextElement("Date: " + viewModel.issueDate) // Using issueDate for invoice_date
  ]);
  invoiceInfoCol.span = 4; // Adjust span to fit 12 columns (3+5+4 = 12)
  applyStyle(invoiceInfoCol, instantiateStyle(new PartialStyle("right"))); // Align right

  const headerRow = new RowElement([logoCol, companyNameCol, invoiceInfoCol]);
  const headerSection = new SectionElement([headerRow]);
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

        // Add Category Header (Optional, DSL doesn't explicitly show it but implies grouping)
        const categoryHeader = new TextElement(category, "heading3"); // Use smaller heading
        applyStyle(categoryHeader, instantiateStyle(new PartialStyle(null, null, "1px solid #eee", "0.2em", "1em")));
        sectionChildren.push(categoryHeader);

        // Add Item Table Header Row
        sectionChildren.push(createItemTableHeaderRow_StdDefault());

        // Add Item Rows
        // Check if categoryItems is not null before iterating
        if (categoryItems) {
            for (let j = 0; j < categoryItems.length; j++) {
                const item = categoryItems[j];
                const itemRow = new RowElement([
                    // Column spans adjusted to fit 4 columns: 6, 2, 2, 2 (total 12)
                applyStyle(new ColumnElement([new TextElement(item.description)]), instantiateStyle(new PartialStyle())), // Span 6
                applyStyle(new ColumnElement([new TextElement(item.quantity.toString())]), instantiateStyle(new PartialStyle("right"))), // Span 2
                applyStyle(new ColumnElement([new TextElement(formatCurrency(item.unitPrice))]), instantiateStyle(new PartialStyle("right"))), // Span 2
                applyStyle(new ColumnElement([new TextElement(formatCurrency(item.total))]), instantiateStyle(new PartialStyle("right"))), // Span 2
            ]);
            itemRow.id = "item-row-" + item.id;
            sectionChildren.push(itemRow);
            }
        }
    }

    const itemsSection = new SectionElement(sectionChildren);
    itemsSection.id = "invoice-items-std-default";
    return new ItemsSectionResult(itemsSection, runningSubtotal);
}

function createItemTableHeaderRow_StdDefault(): RowElement {
    // Corresponds to fields: description, quantity, price, total
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
    applyStyle(labelCol, instantiateStyle(new PartialStyle("right")));

    const valueCol = new ColumnElement([
        new TextElement(formatCurrency(subtotal)),
        new TextElement(formatCurrency(tax)),
        applyStyle(new TextElement(formatCurrency(total)), instantiateStyle(new PartialStyle(null, "bold"))) // Apply bold style to total value
    ]);
    valueCol.span = 3;
    applyStyle(valueCol, instantiateStyle(new PartialStyle("right")));


    const totalsRow = new RowElement([spacerCol, labelCol, valueCol]);
    const totalsSection = new SectionElement([totalsRow]);
    totalsSection.id = "invoice-totals-std-default";
    // Add top border for separation
    const sectionStyle = new ElementStyle();
    sectionStyle.borderTop = "1px solid #eee";
    sectionStyle.paddingTop = "1em";
    sectionStyle.marginTop = "1em";
    applyStyle(totalsSection, sectionStyle);

    return totalsSection;
}