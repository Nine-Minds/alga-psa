import type { InvoiceTimeRateKind } from '../../interfaces/billing.interfaces';
/**
 * Represents the input data provided to the Wasm template engine.
 * This is a placeholder and should be expanded based on actual invoice data needs.
 */
export interface WasmInvoiceLineItemLocation {
  id: string;
  location_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_line3?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  country_name?: string | null;
  region_code?: string | null;
  full_address?: string | null;
}

export interface WasmInvoiceLocationGroup {
  location_id: string | null;
  location?: WasmInvoiceLineItemLocation | null;
  name?: string | null;
  address?: string | null;
  items: WasmInvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface WasmInvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  taxAmount?: number; // Per-item tax, used for grouped totals
  // Compatibility summary range for the row. When recurringDetailPeriods is present,
  // these fields span the earliest start and latest end across the canonical periods.
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  // Compatibility summary timing. When recurringDetailPeriods is present,
  // this stays populated only when every canonical period shares the same timing.
  billingTiming?: 'arrears' | 'advance' | null;
  recurringDetailPeriods?: Array<{
    servicePeriodStart?: string | null;
    servicePeriodEnd?: string | null;
    billingTiming?: 'arrears' | 'advance' | null;
  }>;
  category?: string; // Optional: For grouping items
  itemType?: 'service' | 'project' | 'product'; // Optional: For conditional rendering
  projectPhaseName?: string | null;
  location_id?: string | null;
  /** Resolved location object, when available. */
  location?: WasmInvoiceLineItemLocation | null;
}

/**
 * Work-item provenance for a billed time entry, as captured in the immutable
 * invoice-generation snapshot. `ad_hoc` covers time recorded without a ticket
 * or project task.
 */
export type WasmInvoiceTimeWorkItemType = 'ticket' | 'project_task' | 'ad_hoc';

/**
 * One billed time entry as frozen at invoice generation. All fields come from
 * the persisted snapshot — never from live ticket / time-entry rows — so a
 * finalized invoice renders identically after the source records change.
 * Customer-visible fields only: internal comments and time-entry notes are
 * never part of the snapshot.
 */
export interface WasmInvoiceTimeEntry {
  timePresentation?: true;
  /** Source time-entry id, preserved for traceability. */
  id: string;
  /** Invoice charge (line item) this entry billed under, when known. */
  itemId?: string | null;
  workItemType: WasmInvoiceTimeWorkItemType | null;
  /** Ticket id or project-task id, per workItemType. */
  workItemId: string | null;
  ticketNumber: string | null;
  /** Ticket title or project-task name. */
  title: string | null;
  /** Customer-visible work-item description (ticket description). */
  description: string | null;
  /** ISO date the billed work started. */
  date: string | null;
  /** Billed duration in whole minutes (after minimum/rounding rules). */
  billedMinutes: number;
  /** billedMinutes / 60, for display. */
  hours: number;
  /** Effective hourly rate in minor currency units. */
  rate: number | null;
  rateKind: InvoiceTimeRateKind;
  rateDisplay: number | string | null;
  label: string;
  labelKey?: string;
  /** Net (pre-tax) amount in minor currency units. */
  amount: number;
  serviceId: string | null;
  serviceName: string | null;
}

/**
 * Billed time grouped by source work item (ticket, project task, or the
 * ad-hoc fallback). Aggregates use integer minute / minor-unit arithmetic and
 * deterministic ordering. A group whose entries carry more than one hourly
 * rate reports `hasMixedRates: true` with `rate: null` — it never invents a
 * single blended rate.
 */
export interface WasmInvoiceTicketGroup {
  timePresentation?: true;
  /** Stable group key (e.g. `ticket:<id>`), deterministic across renders. */
  key: string;
  workItemType: WasmInvoiceTimeWorkItemType | null;
  workItemId: string | null;
  ticketNumber: string | null;
  title: string | null;
  description: string | null;
  /** Display label: "<ticketNumber> — <title>", task name, or fallback text. */
  label: string;
  /** Earliest / latest billed date across the group's entries. */
  dateStart: string | null;
  dateEnd: string | null;
  /** Integer sum of billedMinutes. */
  totalMinutes: number;
  /** totalMinutes / 60, for display. */
  totalHours: number;
  /** Integer sum of entry net amounts, minor currency units. */
  totalAmount: number;
  /** True when entries bill at more than one hourly rate. */
  hasMixedRates: boolean;
  rateKind: InvoiceTimeRateKind;
  labelKey?: string;
  /** Uniform hourly rate in minor units, or null when hasMixedRates. */
  rate: number | null;
  /**
   * Value for a Rate column: the uniform hourly rate in minor units (render
   * with currency formatting — the renderer supplies locale and currency), or
   * the "Mixed rates" text when entries bill at more than one rate. Never a
   * blended figure, and never pre-formatted money (the view model carries no
   * locale).
   */
  rateDisplay: number | string | null;
  entryCount: number;
  entries: WasmInvoiceTimeEntry[];
}

/** Complete renderer-only charge partition. Contributions are never accounting inputs. */
export interface InvoiceTicketPresentationRow {
  timePresentation?: true;
  id: string;
  label: string;
  labelKey?: string;
  description: string;
  quantity: number;
  rate: number | null;
  rateKind?: InvoiceTimeRateKind;
  rateDisplay: number | string | null;
  amount: number;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  contributions: Array<{ itemId: string; entryId: string | null; amount: number }>;
}

export interface WasmInvoiceViewModel {
  invoiceNumber: string;
  issueDate: string; // Consider using ISO8601String or a specific date format
  dueDate: string; // Consider using ISO8601String or a specific date format
  currencyCode: string; // Added for multi-currency support
  poNumber?: string | null;
  projectName?: string | null;
  projectNumber?: string | null;
  recurringServicePeriodStart?: string | null;
  recurringServicePeriodEnd?: string | null;
  recurringServicePeriodLabel?: string | null;
  customer: {
    name: string;
    address: string;
  };
  tenantClient:
    | {
        // Details of the client issuing the invoice (the tenant)
        name: string | null;
        address: string | null;
        logoUrl: string | null;
      }
    | null;
  clientLogoUrl?: string; // Optional client logo URL - KEEPING FOR NOW, maybe rename/remove later?
  items: WasmInvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
  taxSource?: 'internal' | 'external' | 'pending_external';
  notes?: string;
  // Grouped item collections (derived from items, no migration needed)
  recurringItems?: WasmInvoiceLineItem[];
  onetimeItems?: WasmInvoiceLineItem[];
  recurringSubtotal?: number;
  recurringTax?: number;
  recurringTotal?: number;
  onetimeSubtotal?: number;
  onetimeTax?: number;
  onetimeTotal?: number;
  // Pre-computed per-location groupings for templates that want
  // location "bands" (header + rows + per-location subtotal).
  groupsByLocation?: WasmInvoiceLocationGroup[];
  /** True when invoice charges span ≥2 distinct locations. */
  hasMultipleLocations?: boolean;
  /**
   * Flat list of billed time entries from the immutable generation-time
   * snapshot. Absent on invoices generated before snapshots existed and on
   * invoices with no snapshot-bearing time charges — templates must treat it
   * as optional.
   */
  timeEntries?: WasmInvoiceTimeEntry[];
  /**
   * Billed time grouped by source ticket / project task, derived from
   * `timeEntries`. Same legacy caveat: absent when no snapshot data exists.
   */
  ticketGroups?: WasmInvoiceTicketGroup[];
  ticketPresentationRows?: InvoiceTicketPresentationRow[];
  ticketCoverageStatus?: 'complete' | 'partial' | 'unavailable' | 'none';
  ticketCoverageNote?: string;
  ticketDetailNote?: string;
}

/**
 * Represents the final output generated by the host-side renderer.
 */
export interface RenderOutput {
  html: string;
  css: string;
}

// --- Layout Data Structure (Returned by Wasm) ---
// NOTE: These types are mirrored in AssemblyScript (`assembly/types.ts`) using `json-as`.
// Ensure consistency, keeping in mind AssemblyScript/`json-as` limitations (e.g., enums become strings, number becomes f64/i32, optionality uses `| null`).

/**
 * Base interface for all layout elements.
 */
export interface LayoutElement {
  type: LayoutElementType;
  id?: string; // Optional unique identifier for elements
  style?: ElementStyle; // Optional styling rules
  // --- Pagination Hints ---
  pageBreakBefore?: boolean; // Suggests a page break before this element
  keepTogether?: boolean; // Suggests keeping this element and its direct children on the same page if possible
}

/**
 * Defines the possible types of layout elements.
 */
export enum LayoutElementType {
  // NOTE: In AssemblyScript, this enum is represented as `type LayoutElementType = string;`
  // The string values must match exactly between host and Wasm.
  Document = 'Document',
  Section = 'Section',
  Row = 'Row',
  Column = 'Column',
  Text = 'Text',
  Image = 'Image',
  // Add more types as needed (e.g., Table, List, Spacer)
}

/**
 * Represents the root of the layout structure.
 */
export interface DocumentElement extends LayoutElement {
  type: LayoutElementType.Document;
  children: LayoutElement[];
  globalStyles?: GlobalStyles; // Styles applicable to the whole document
}

/**
 * Represents a logical section of the document (e.g., header, body, footer).
 */
export interface SectionElement extends LayoutElement {
  type: LayoutElementType.Section;
  children: LayoutElement[];
}

/**
 * Represents a horizontal row, typically containing Columns.
 */
export interface RowElement extends LayoutElement {
  type: LayoutElementType.Row;
  children: ColumnElement[]; // Rows usually contain Columns
}

/**
 * Represents a vertical column within a Row.
 */
export interface ColumnElement extends LayoutElement {
  type: LayoutElementType.Column;
  children: LayoutElement[];
  // Optional: Define column span/width properties if using a grid system
  span?: number; // Example: number of grid columns to occupy
}

/**
 * Represents a block of text.
 */
export interface TextElement extends LayoutElement {
  type: LayoutElementType.Text;
  content: string;
  variant?: 'heading1' | 'heading2' | 'paragraph' | 'label' | 'caption'; // Semantic text types
}

/**
 * Represents an image.
 */
export interface ImageElement extends LayoutElement {
  type: LayoutElementType.Image;
  src: string; // URL or potentially base64 data URI
  alt?: string; // Alt text for accessibility
}

// --- Styling ---

/**
 * Represents CSS-like style properties for individual elements.
 * Use camelCase for property names (e.g., backgroundColor).
 */
export interface ElementStyle {
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  // Layout & Box Model
  width?: string;
  height?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  border?: string;
  borderRadius?: string;

  // Flexbox/Grid (if applicable to parent)
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: string;
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';

  // Typography
  fontSize?: string;
  fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
  fontFamily?: string;
  textAlign?: 'left' | 'right' | 'center' | 'justify';
  lineHeight?: string | number;
  color?: string;

  // Background & Borders
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none'; // etc.

  // Add more CSS properties as needed
  [key: string]: string | number | undefined; // Allow arbitrary properties.
  // NOTE: The AssemblyScript `ElementStyle` type defines many common properties explicitly (like individual borders)
  // as `json-as` doesn't support index signatures well. Ensure common styles are explicitly defined if needed in AS.
}

/**
 * Represents global styles, potentially defining classes or base element styles.
 * This structure might evolve based on the renderer implementation.
 */
export interface GlobalStyles {
  // NOTE: The AssemblyScript version (`SimpleGlobalStyles`) is simplified due to `json-as` limitations,
  // currently only supporting `variables` as a Map<string, string>.
  variables?: { [key: string]: string }; // e.g., --primary-color: #ff0000
  classes?: { [className: string]: ElementStyle }; // e.g., .highlight: { backgroundColor: 'yellow' }
  baseElementStyles?: {
    // e.g., Apply styles to all 'Text' elements of a certain variant
    [elementType in LayoutElementType]?: ({ [variant: string]: ElementStyle } | ElementStyle) | undefined;
  };
}

// --- Host Function Signatures (Placeholder) ---
// These will be refined in Task 3

export interface HostFunctions {
  // NOTE: Ensure these signatures match the `@external` declarations in AssemblyScript (`assembly/types.ts`).
  log: (message: string) => void;
  /**
   * Called by AssemblyScript's standard 'abort' mechanism.
   * Receives pointers to strings in Wasm memory and line/column numbers.
   * @param messagePtr Pointer (number) to the abort message string in Wasm memory.
   * @param fileNamePtr Pointer (number) to the file name string in Wasm memory.
   * @param lineNumber Line number where abort occurred.
   * @param columnNumber Column number where abort occurred.
   */
  abort: (messagePtr: number, fileNamePtr: number, lineNumber: number, columnNumber: number) => void;
  // Add other utility functions here, e.g., formatCurrency, complexMath
}

// --- Main Renderer Function Signature (Placeholder) ---
// This will be implemented in Task 4 & 5

export type RenderInvoiceFunction = (data: WasmInvoiceViewModel, templateWasm: Buffer) => Promise<RenderOutput>;
