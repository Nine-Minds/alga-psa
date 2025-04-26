import { JSON } from "json-as"; // Use json-as
import {
  InvoiceViewModel,
  InvoiceItem, // Import InvoiceItem
  TimeEntry, // Add missing import for TimeEntry
  LayoutElement,
  ElementStyle,
  RowElement,
  ColumnElement,
  DocumentElement,
  SectionElement,
  TextElement,
  LayoutElementType,
  log // Import the declared host function
} from "./types";

// --- Constants ---
const DEFAULT_CATEGORY = "Other Items";
const TAX_RATE: f64 = 0.10; // Example tax rate (10%)

/**
 * Main entry point for the Wasm module.
 * Takes serialized InvoiceViewModel data as input and returns a serialized LayoutElement structure.
 *
 * @param dataString - A JSON string representing the InvoiceViewModel.
 * @returns A JSON string representing the generated DocumentElement layout.
 */
// @ts-ignore: decorator
@unsafe // Using unsafe because as-json relies on it
export function generateLayout(dataString: string): string {
  log("Wasm: Received data string. Deserializing..."); // Log using host function

  // 1. Deserialize Input Data
  const viewModel = JSON.parse<InvoiceViewModel>(dataString);

  // Basic validation after parsing
  if (viewModel.invoiceNumber == "") {
      log("Wasm: Error - Deserialization likely failed (key property missing/default).");
      // Return a simple error document
      const errorDoc = new DocumentElement([new TextElement("Error: Could not parse input data.")]);
      return JSON.stringify<DocumentElement>(errorDoc);
  }
  log("Wasm: Deserialization successful. Invoice #: " + viewModel.invoiceNumber);

  // --- Initialize Calculated Totals ---
  let calculatedSubtotal: f64 = 0.0;
  let calculatedTax: f64 = 0.0;
  let calculatedTotal: f64 = 0.0;

  // 2. Build Layout Structure
  log("Wasm: Building layout structure...");

  // --- Header Section ---
  const headerSection = createHeaderSection(viewModel);

  // --- Customer Info Section ---
  const customerSection = createCustomerSection(viewModel);

  // --- Items Section (Advanced: Grouping, Calculations, Conditionals) ---
  log("Wasm: Processing invoice items with advanced logic...");
  const itemsSection = createItemsSection(viewModel.items, calculatedSubtotal); // Pass reference for subtotal calculation

  // --- Recalculate Totals ---
  calculatedTax = calculatedSubtotal * TAX_RATE;
  calculatedTotal = calculatedSubtotal + calculatedTax;
  log("Wasm: Recalculated Totals - Subtotal: " + calculatedSubtotal.toString() + ", Tax: " + calculatedTax.toString() + ", Total: " + calculatedTotal.toString());


  // --- Totals Section ---
  // Use the newly calculated totals
  const totalsSection = createTotalsSection(calculatedSubtotal, calculatedTax, calculatedTotal);


  // --- Notes Section (Conditional) ---
  let notesSection: SectionElement | null = null;
  if (viewModel.notes && viewModel.notes!.length > 0) {
      log("Wasm: Adding notes section.");
      notesSection = new SectionElement([
          new TextElement("Notes:", "heading2"),
          new TextElement(viewModel.notes!)
      ]);
      notesSection.id = "invoice-notes";
      // Example: Add a page break before notes if they exist
      // notesSection.pageBreakBefore = true; // Keep pagination hints minimal for now
  }


  // --- Time Summary Section (Side Report - Conditional) ---
  let timeSummarySection: SectionElement | null = null;
  // Check if timeEntries exists and is not empty
  if (viewModel.timeEntries !== null && viewModel.timeEntries!.length > 0) {
      log("Wasm: Adding time summary side report section.");
      timeSummarySection = createTimeSummarySection(viewModel.timeEntries!);
  }

  // --- Document Root ---
  // Add all sections, including the optional ones
  const documentChildren: Array<LayoutElement> = [headerSection, customerSection, itemsSection, totalsSection];
  if (notesSection !== null) {
      documentChildren.push(notesSection);
  }
  if (timeSummarySection !== null) {
      documentChildren.push(timeSummarySection); // Add the side report section
  }
  const document = new DocumentElement(documentChildren);
  document.id = "invoice-document"; // Root document ID

  // 3. Serialize Output Layout
  log("Wasm: Serializing layout structure...");
  const resultString = JSON.stringify<DocumentElement>(document);
  log("Wasm: Returning serialized layout.");
  return resultString;
}


// --- Helper Functions for Section Creation ---

function createHeaderSection(viewModel: InvoiceViewModel): SectionElement {
    const headerSection = new SectionElement([
        new RowElement([
            new ColumnElement([new TextElement("Invoice", "heading1")]),
            applyStyle<ColumnElement>(
                new ColumnElement([
                    new TextElement("Invoice #: " + viewModel.invoiceNumber),
                    new TextElement("Date Issued: " + viewModel.issueDate),
                    new TextElement("Due Date: " + viewModel.dueDate),
                ]),
                instantiateStyle(new PartialStyle("right")) // Align right
            )
        ])
    ]);
    headerSection.id = "invoice-header";
    return headerSection;
}

function createCustomerSection(viewModel: InvoiceViewModel): SectionElement {
    const customerSection = new SectionElement([
        new RowElement([
            new ColumnElement([
                new TextElement("Bill To:", "heading2"),
                new TextElement(viewModel.customer.name),
                new TextElement(viewModel.customer.address),
            ])
        ])
    ]);
    customerSection.id = "customer-info";
    return customerSection;
}

function createItemsSection(items: Array<InvoiceItem>, subtotalRef: f64): SectionElement {
    const sectionChildren = new Array<LayoutElement>();
    let runningSubtotal: f64 = 0.0; // Local variable for calculation

    // --- Group Items by Category ---
    const groupedItems = new Map<string, Array<InvoiceItem>>();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        // ** Custom Calculation: Recalculate item total **
        item.total = item.quantity * item.unitPrice;
        runningSubtotal += item.total; // Add to running subtotal

        const category = item.category ? item.category! : DEFAULT_CATEGORY;
        if (!groupedItems.has(category)) {
            groupedItems.set(category, new Array<InvoiceItem>());
        }
        groupedItems.get(category).push(item);
    }

    // Update the subtotal passed by reference
    // NOTE: AssemblyScript passes basic types by value. To update the outer scope's
    // subtotal, we'd typically return it or use a more complex structure (like a Box).
    // For simplicity here, we'll log the discrepancy and use the locally calculated one.
    // A better approach might involve returning a tuple or object from this function.
    log("Wasm: Calculated subtotal within createItemsSection: " + runningSubtotal.toString());
    // subtotalRef = runningSubtotal; // This won't modify the original f64 outside

    // --- Generate Layout for Grouped Items ---
    const categories = groupedItems.keys();
    for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const categoryItems = groupedItems.get(category);
        let categoryTotal: f64 = 0.0;

        // Add Category Header
        const categoryHeader = new TextElement(category, "heading2");
        const categoryHeaderStyle = new ElementStyle();
        categoryHeaderStyle.marginTop = "1.5em"; // Add space before category
        categoryHeaderStyle.borderBottom = "1px solid #eee";
        categoryHeaderStyle.paddingBottom = "0.2em";
        applyStyle<TextElement>(categoryHeader, categoryHeaderStyle);
        sectionChildren.push(categoryHeader);

        // Add Item Table Header Row for this category
        sectionChildren.push(createItemTableHeaderRow());

        // Add Rows for Items in this Category
        for (let j = 0; j < categoryItems.length; j++) {
            const item = categoryItems[j];
            categoryTotal += item.total; // Sum category total

            // ** Conditional Structuring: Modify description based on itemType **
            let descriptionContent = item.description;
            if (item.itemType == 'project') {
                descriptionContent = "[Project] " + descriptionContent;
            } else if (item.itemType == 'service') {
                descriptionContent = "[Service] " + descriptionContent;
            } // Add more conditions as needed

            const itemRow = new RowElement([
                new ColumnElement([new TextElement(descriptionContent)]), // Use modified description
                applyStyle<ColumnElement>(new ColumnElement([new TextElement(item.quantity.toString())]), instantiateStyle(new PartialStyle("right"))),
                // TODO: Add host function for currency formatting if needed
                applyStyle<ColumnElement>(new ColumnElement([new TextElement(formatCurrency(item.unitPrice))]), instantiateStyle(new PartialStyle("right"))),
                applyStyle<ColumnElement>(new ColumnElement([new TextElement(formatCurrency(item.total))]), instantiateStyle(new PartialStyle("right"))),
            ]);
            itemRow.id = "item-row-" + item.id; // Use item ID if available
            sectionChildren.push(itemRow);
        }

        // ** Inline Note: Add Category Subtotal **
        const categoryTotalRow = new RowElement([
            new ColumnElement([]), // Spacer
            new ColumnElement([]), // Spacer
            applyStyle<ColumnElement>(new ColumnElement([new TextElement("Category Total:")]), instantiateStyle(new PartialStyle("right", "bold"))),
            applyStyle<ColumnElement>(new ColumnElement([new TextElement(formatCurrency(categoryTotal))]), instantiateStyle(new PartialStyle("right", "bold"))),
        ]);
        const categoryTotalStyle = new ElementStyle();
        categoryTotalStyle.borderTop = "1px solid #eee";
        categoryTotalStyle.paddingTop = "0.5em";
        applyStyle<RowElement>(categoryTotalRow, categoryTotalStyle);
        sectionChildren.push(categoryTotalRow);

    }

    const itemsSection = new SectionElement(sectionChildren);
    itemsSection.id = "invoice-items";
    // Example: Keep the items table together if possible (might be less effective with grouping)
    // itemsSection.keepTogether = true;

    // Hacky way to return subtotal for now - assign to a global or pass mutable object if needed
    // For this example, we rely on the recalculation in the main function scope.
    // This highlights a limitation/consideration when structuring AS code.

    return itemsSection;
}

function createItemTableHeaderRow(): RowElement {
    const headerRow = new RowElement([
        new ColumnElement([new TextElement("Description", "label")]),
        applyStyle<ColumnElement>(new ColumnElement([new TextElement("Qty", "label")]), instantiateStyle(new PartialStyle("right"))),
        applyStyle<ColumnElement>(new ColumnElement([new TextElement("Unit Price", "label")]), instantiateStyle(new PartialStyle("right"))),
        applyStyle<ColumnElement>(new ColumnElement([new TextElement("Total", "label")]), instantiateStyle(new PartialStyle("right"))),
    ]);
    const headerRowStyle = new ElementStyle();
    headerRowStyle.fontWeight = "bold";
    headerRowStyle.borderBottom = "1px solid #ccc";
    headerRowStyle.paddingBottom = "0.5em";
    applyStyle<RowElement>(headerRow, headerRowStyle);
    return headerRow;
}


function createTotalsSection(subtotal: f64, tax: f64, total: f64): SectionElement {
    const totalsSection = new SectionElement([
        new RowElement([
            new ColumnElement([]), // Spacer column
            applyStyle<ColumnElement>(new ColumnElement([
                new TextElement("Subtotal:"),
                new TextElement("Tax (" + (TAX_RATE * 100).toString() + "%):"),
                new TextElement("Total:", "label"), // Use label variant
            ]), instantiateStyle(new PartialStyle("right"))),
            applyStyle<ColumnElement>(new ColumnElement([
                new TextElement(formatCurrency(subtotal)),
                new TextElement(formatCurrency(tax)),
                new TextElement(formatCurrency(total)),
            ]), instantiateStyle(new PartialStyle("right", "bold"))),
        ])
    ]);
    totalsSection.id = "invoice-totals";
    // Example: Try to keep totals on the same page as the last items
    totalsSection.keepTogether = true;
    return totalsSection;
}

// Add the missing function definition if it wasn't added previously
function createTimeSummarySection(timeEntries: Array<TimeEntry>): SectionElement {
    const sectionChildren = new Array<LayoutElement>();
    let totalHours: f64 = 0.0;

    // Add Section Header
    const sectionHeader = new TextElement("Time Summary Report", "heading1");
    const sectionHeaderStyle = new ElementStyle();
    sectionHeaderStyle.marginTop = "2em"; // Add space before this report
    sectionHeaderStyle.paddingBottom = "0.5em";
    sectionHeaderStyle.borderBottom = "2px solid #333";
    applyStyle<TextElement>(sectionHeader, sectionHeaderStyle);
    sectionChildren.push(sectionHeader);

    // Add Table Header Row
    const tableHeader = new RowElement([
        applyStyle<ColumnElement>(new ColumnElement([new TextElement("Date", "label")]), instantiateStyle(new PartialStyle(null, "bold"))),
        applyStyle<ColumnElement>(new ColumnElement([new TextElement("User", "label")]), instantiateStyle(new PartialStyle(null, "bold"))),
        applyStyle<ColumnElement>(new ColumnElement([new TextElement("Description", "label")]), instantiateStyle(new PartialStyle(null, "bold"))),
        applyStyle<ColumnElement>(new ColumnElement([new TextElement("Hours", "label")]), instantiateStyle(new PartialStyle("right", "bold"))),
    ]);
    const tableHeaderStyle = new ElementStyle();
    tableHeaderStyle.borderBottom = "1px solid #ccc";
    tableHeaderStyle.paddingBottom = "0.5em";
    tableHeaderStyle.marginBottom = "0.5em";
    applyStyle<RowElement>(tableHeader, tableHeaderStyle);
    sectionChildren.push(tableHeader);

    // Add Rows for Time Entries
    for (let i = 0; i < timeEntries.length; i++) {
        const entry = timeEntries[i];
        totalHours += entry.hours;

        const entryRow = new RowElement([
            new ColumnElement([new TextElement(entry.date)]), // Assuming date is pre-formatted string
            new ColumnElement([new TextElement(entry.user)]),
            new ColumnElement([new TextElement(entry.description)]),
            applyStyle<ColumnElement>(new ColumnElement([new TextElement(entry.hours.toString())]), instantiateStyle(new PartialStyle("right"))),
        ]);
        entryRow.id = "time-entry-row-" + entry.id;
        sectionChildren.push(entryRow);
    }

    // Add Total Hours Row
    const totalHoursRow = new RowElement([
        new ColumnElement([]), // Spacer
        new ColumnElement([]), // Spacer
        applyStyle<ColumnElement>(new ColumnElement([new TextElement("Total Hours:", "label")]), instantiateStyle(new PartialStyle("right", "bold"))),
        applyStyle<ColumnElement>(new ColumnElement([new TextElement(totalHours.toString())]), instantiateStyle(new PartialStyle("right", "bold"))),
    ]);
    const totalHoursStyle = new ElementStyle();
    totalHoursStyle.borderTop = "1px solid #ccc";
    totalHoursStyle.paddingTop = "0.5em";
    totalHoursStyle.marginTop = "0.5em";
    applyStyle<RowElement>(totalHoursRow, totalHoursStyle);
    sectionChildren.push(totalHoursRow);


    const timeSection = new SectionElement(sectionChildren);
    timeSection.id = "time-summary-report"; // Unique ID for this report section
    // Suggest page break before this side report
    timeSection.pageBreakBefore = true;
    timeSection.keepTogether = false; // Allow this report to break across pages if needed

    return timeSection;
}


// --- Styling Helpers ---

// Define a class for the partial style structure (internal helper)
class PartialStyle {
    textAlign: string | null = null;
    fontWeight: string | null = null;
    borderBottom: string | null = null;
    paddingBottom: string | null = null;
    marginTop: string | null = null;
    borderTop: string | null = null;
    paddingTop: string | null = null;

    constructor(
        textAlign: string | null = null,
        fontWeight: string | null = null,
        borderBottom: string | null = null,
        paddingBottom: string | null = null,
        marginTop: string | null = null,
        borderTop: string | null = null,
        paddingTop: string | null = null
    ) {
        this.textAlign = textAlign;
        this.fontWeight = fontWeight;
        this.borderBottom = borderBottom;
        this.paddingBottom = paddingBottom;
        this.marginTop = marginTop;
        this.borderTop = borderTop;
        this.paddingTop = paddingTop;
    }
}

// Helper to instantiate ElementStyle from a PartialStyle object
function instantiateStyle(partialStyle: PartialStyle): ElementStyle {
    const style = new ElementStyle();
    if (partialStyle.textAlign !== null) style.textAlign = partialStyle.textAlign;
    if (partialStyle.fontWeight !== null) style.fontWeight = partialStyle.fontWeight;
    if (partialStyle.borderBottom !== null) style.borderBottom = partialStyle.borderBottom;
    if (partialStyle.paddingBottom !== null) style.paddingBottom = partialStyle.paddingBottom;
    if (partialStyle.marginTop !== null) style.marginTop = partialStyle.marginTop;
    if (partialStyle.borderTop !== null) style.borderTop = partialStyle.borderTop;
    if (partialStyle.paddingTop !== null) style.paddingTop = partialStyle.paddingTop;
    return style;
}

// Generic function to apply a style object to a layout element
function applyStyle<T extends LayoutElement>(element: T, style: ElementStyle): T {
    element.style = style;
    return element;
}

// --- Formatting Helpers ---

// Basic currency formatting (replace with host function if complex rules needed)
function formatCurrency(value: f64): string {
    // Basic formatting, doesn't handle locales or complex scenarios.
    // Manually format to two decimal places as toFixed is not available on f64.
    const factor: f64 = 100.0;
    // Round to nearest cent
    const roundedValue = Math.round(value * factor) / factor;
    let valueStr = roundedValue.toString();

    // Ensure two decimal places
    const decimalPointIndex = valueStr.indexOf('.');
    if (decimalPointIndex === -1) {
        valueStr += ".00";
    } else {
        const decimals = valueStr.length - decimalPointIndex - 1;
        if (decimals === 1) {
            valueStr += "0";
        } else if (decimals === 0) {
            // This case should ideally not happen with the rounding logic, but handle defensively
            valueStr += "00";
        }
        // If more than 2 decimals, the rounding should have handled it, but could truncate here if needed.
    }

    return "$" + valueStr; // Add currency symbol
}