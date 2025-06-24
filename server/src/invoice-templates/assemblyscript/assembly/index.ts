import { JSON } from "json-as"; // Use json-as
import {
  InvoiceViewModel,
  InvoiceItem,
  TimeEntry,
  LayoutElement,
  ElementStyle,
  RowElement,
  ColumnElement,
  DocumentElement,
  SectionElement,
  TextElement,
  ImageElement,
  log // Import the declared host function
} from "./types";
import { applyStyle, instantiateStyle, PartialStyle } from "./common/style-helpers";
import { formatCurrency } from "./common/format-helpers";

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
  let viewModel: InvoiceViewModel | null = null; // Initialize to null
  viewModel = JSON.parse<InvoiceViewModel>(dataString); // Attempt parsing

  // Check for parsing failure (null or default/empty object)
  // AssemblyScript's JSON.parse returns a default-constructed object on error, not null.
  // We check a key property to infer failure.
  if (viewModel === null || viewModel.invoiceNumber == "") {
      log("Wasm: Error during deserialization or invalid data received.");
      const errorDoc = new DocumentElement([new TextElement("Error: Could not parse input data.")]);
      return JSON.stringify<DocumentElement>(errorDoc);
  }
  // If we reach here, viewModel is valid and non-null.
  log("Wasm: Deserialization successful. Invoice #: " + viewModel.invoiceNumber);

  // --- Initialize Calculated Totals ---
  let calculatedSubtotal: f64 = 0.0;

  // 2. Build Layout Structure
  log("Wasm: Building layout structure...");

  // --- Header Section ---
  const headerSection = createHeaderSection(viewModel);

  // --- Customer Info Section ---
  const customerSection = createCustomerSection(viewModel);

  // --- Items Section (Advanced: Grouping, Calculations, Conditionals) ---
  log("Wasm: Processing invoice items with advanced logic...");
  // Use a wrapper object or return tuple to get calculated subtotal back
  const itemsResult = createItemsSection(viewModel.items);
  const itemsSection = itemsResult.section;
  calculatedSubtotal = itemsResult.subtotal; // Get subtotal from the result

  // --- Recalculate Totals ---
  const calculatedTax = calculatedSubtotal * TAX_RATE;
  const calculatedTotal = calculatedSubtotal + calculatedTax;
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
    // --- Tenant Logo Column ---
    let logoCol: ColumnElement;
    if (viewModel.tenantCompany != null && viewModel.tenantCompany!.logoUrl != null && viewModel.tenantCompany!.logoUrl!.length > 0) {
        const logoElement = new ImageElement(viewModel.tenantCompany!.logoUrl!, "Tenant Company Logo");
        logoElement.style = instantiateStyle(new PartialStyle("width", "150px")); // Keep existing style
        logoCol = new ColumnElement([logoElement]);
    } else {
        logoCol = new ColumnElement([new TextElement("[Tenant Logo]")]); // Placeholder
    }
    logoCol.span = 3; // Example span

    // --- Tenant Info Column ---
    const tenantName = viewModel.tenantCompany != null && viewModel.tenantCompany!.name != null ? viewModel.tenantCompany!.name! : "[Tenant Name]";
    const tenantAddress = viewModel.tenantCompany != null && viewModel.tenantCompany!.address != null ? viewModel.tenantCompany!.address! : "[Tenant Address]";
    const tenantInfoCol = new ColumnElement([
        new TextElement(tenantName, "heading3"),
        new TextElement(tenantAddress)
    ]);
    tenantInfoCol.span = 5; // Example span

    // --- Invoice Info Column ---
    const invoiceInfoCol = applyStyle<ColumnElement>(
        new ColumnElement([
            new TextElement("Invoice #: " + viewModel.invoiceNumber),
            new TextElement("Date Issued: " + viewModel.issueDate),
            new TextElement("Due Date: " + viewModel.dueDate),
        ]),
        instantiateStyle(new PartialStyle("right")) // Keep right alignment
    );
    invoiceInfoCol.span = 4; // Example span

    // --- Assemble Row and Section ---
    const headerRow = new RowElement([logoCol, tenantInfoCol, invoiceInfoCol]); // Add all columns to the row

    const headerSection = new SectionElement([headerRow]);
    headerSection.id = "invoice-header";
    return headerSection;
}

function createCustomerSection(viewModel: InvoiceViewModel): SectionElement {
    // Handle null customer with fallback values
    let customerName: string = "N/A";
    let customerAddress: string = "N/A";
    
    if (viewModel.customer !== null) {
        customerName = viewModel.customer!.name;
        customerAddress = viewModel.customer!.address;
    }
    
    const customerSection = new SectionElement([
        new RowElement([
            new ColumnElement([
                new TextElement("Bill To:", "heading2"),
                new TextElement(customerName),
                new TextElement(customerAddress),
            ])
        ])
    ]);
    customerSection.id = "customer-info";
    return customerSection;
}

// Define a simple structure to return multiple values
class ItemsSectionResult {
    section: SectionElement;
    subtotal: f64;

    constructor(section: SectionElement, subtotal: f64) {
        this.section = section;
        this.subtotal = subtotal;
    }
}

function createItemsSection(items: Array<InvoiceItem>): ItemsSectionResult {
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

    log("Wasm: Calculated subtotal within createItemsSection: " + runningSubtotal.toString());

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
            applyStyle<ColumnElement>(new ColumnElement([new TextElement("Category Total:")]) , instantiateStyle(new PartialStyle("right", "bold"))),
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

    return new ItemsSectionResult(itemsSection, runningSubtotal);
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
    totalsSection.keepTogether = true;
    return totalsSection;
}

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
    timeSection.pageBreakBefore = true;
    timeSection.keepTogether = false; // Allow this report to break across pages if needed

    return timeSection;
}
