import { JSON } from "json-as"; // Import from json-as

// --- Mirrored Host Types ---
// These types mirror the structures defined in the host environment (server/src/lib/invoice-renderer/types.ts)
// They need to be compatible with `json-as` for serialization/deserialization across the Wasm boundary.
// Key Mappings:
// - Host `number` -> AS `f64` (float) or `i32` (integer)
// - Host `boolean` -> AS `bool`
// - Host `string | undefined` or `string?` -> AS `string | null`
// - Host `enum` -> AS `string` (using exact string values)
// - Host complex objects/arrays -> AS corresponding classes/arrays decorated with `@json`

// @ts-ignore: decorator is valid
@json // Use lowercase decorator
export class Customer {
  name: string = ""; // Initialize
  address: string = ""; // Initialize
}

// @ts-ignore: decorator is valid
@json // Use lowercase decorator
export class InvoiceItem {
  id: string = ""; // Add id, initialize
  description: string = ""; // Initialize
  quantity: f64 = 0.0; // Initialize - Note: Host uses number, AS uses f64. Ensure consistency or handle conversion.
  unitPrice: f64 = 0.0; // Initialize
  total: f64 = 0.0; // Initialize - Keep for now, but AS will recalculate
  category: string | null = null; // Optional category, initialize
  itemType: string | null = null; // Optional itemType ('service', 'project', 'product'), initialize
}

// @ts-ignore: decorator is valid
@json // Use lowercase decorator
export class TimeEntry {
  id: string = "";
  date: string = ""; // ISO8601String
  user: string = "";
  hours: f64 = 0.0; // Use f64 for hours
  description: string = "";
}

// @ts-ignore: decorator is valid
@json // Use lowercase decorator
export class InvoiceViewModel {
  invoiceNumber: string = ""; // Initialize
  issueDate: string = ""; // Initialize
  dueDate: string = ""; // Initialize
  customer: Customer = new Customer(); // Initialize with default
  items: Array<InvoiceItem> = []; // Initialize
  subtotal: f64 = 0.0; // Initialize
  tax: f64 = 0.0; // Initialize
  total: f64 = 0.0; // Initialize
  // Use JSON.Box for nullable primitives if needed, but string | null might work directly with json-as transform
  notes: string | null = null; // Keep as string | null for now, initialize
  // Add optional timeEntries array
  timeEntries: Array<TimeEntry> | null = null; // Initialize as null
}

// --- Layout Data Structure (for Wasm to return) ---

// Use simple string type for element types due to union type limitations
export type LayoutElementType = string; // Represents the host's LayoutElementType enum using string values

// Using `string | null` for optional fields and `f64` for numbers where appropriate in styles
// Note: Explicitly defining common style properties (like individual borders) is preferred over index signatures
// due to `json-as` limitations.
// @ts-ignore: decorator is valid
@json // Use lowercase decorator
export class ElementStyle {
  width: string | null = null; // Initialize nullable fields
  height: string | null = null;
  padding: string | null = null;
  paddingTop: string | null = null;
  paddingRight: string | null = null;
  paddingBottom: string | null = null;
  paddingLeft: string | null = null;
  margin: string | null = null;
  marginTop: string | null = null;
  marginRight: string | null = null;
  marginBottom: string | null = null;
  marginLeft: string | null = null;
  border: string | null = null;
  borderTop: string | null = null; // Add individual border props
  borderRight: string | null = null;
  borderBottom: string | null = null;
  borderLeft: string | null = null;
  borderRadius: string | null = null;
  flexGrow: f64 = 0; // Initialize numeric fields
  flexShrink: f64 = 0;
  flexBasis: string | null = null;
  alignSelf: string | null = null; // Assuming string enums map directly
  fontSize: string | null = null;
  fontWeight: string | null = null; // Assuming string/number union maps to string for simplicity here
  fontFamily: string | null = null;
  textAlign: string | null = null;
  lineHeight: string | null = null; // Assuming string/number union maps to string
  color: string | null = null;
  backgroundColor: string | null = null;
  borderColor: string | null = null;
  borderWidth: string | null = null;
  borderTopWidth: string | null = null;
  borderRightWidth: string | null = null;
  borderBottomWidth: string | null = null;
  borderLeftWidth: string | null = null;
  borderStyle: string | null = null;
  borderTopStyle: string | null = null;
  borderRightStyle: string | null = null;
  borderBottomStyle: string | null = null;
  borderLeftStyle: string | null = null;
  borderTopColor: string | null = null;
  borderRightColor: string | null = null;
  borderBottomColor: string | null = null;
  borderLeftColor: string | null = null;

  // Note: as-json doesn't directly support index signatures like [key: string]: string | number | undefined;
  // If arbitrary styles are needed, consider a Map<string, string> or similar structure.
}

// Base class for layout elements
// @ts-ignore: decorator is valid
@json export // Remove abstract
class LayoutElement {
  type: LayoutElementType;
  id: string | null = null; // Initialize
  style: ElementStyle | null = null; // Initialize
  pageBreakBefore: bool = false; // Use bool for boolean, initialize
  keepTogether: bool = false;    // Use bool for boolean, initialize

  // Constructor now takes the string literal type
  constructor(type: LayoutElementType) {
    this.type = type;
    // Initialization moved to property declarations
  }
}

// @ts-ignore: decorator is valid
@json
export class TextElement extends LayoutElement {
  content: string = ""; // Initialize
  variant: string | null = null; // e.g., 'heading1', 'paragraph', initialize

  constructor(content: string, variant: string | null = null) {
    super("Text"); // Use string literal
    this.content = content;
    this.variant = variant;
  }
}

// @ts-ignore: decorator is valid
@json
export class ImageElement extends LayoutElement {
  src: string = ""; // Initialize
  alt: string | null = null; // Initialize

  constructor(src: string, alt: string | null = null) {
    super("Image"); // Use string literal
    this.src = src;
    this.alt = alt;
  }
}

// @ts-ignore: decorator is valid
@json
export class ColumnElement extends LayoutElement {
  children: Array<LayoutElement> = []; // Initialize
  span: i32 = 0; // Use i32 for integer span, initialize

  constructor(children: Array<LayoutElement> = [], span: i32 = 0) {
    super("Column"); // Use string literal
    this.children = children;
    this.span = span; // Store 0 if not positive
  }
}

// @ts-ignore: decorator is valid
@json
export class RowElement extends LayoutElement {
  children: Array<ColumnElement> = []; // Initialize

  constructor(children: Array<ColumnElement> = []) {
    super("Row"); // Use string literal
    this.children = children;
  }
}

// @ts-ignore: decorator is valid
@json
export class SectionElement extends LayoutElement {
  children: Array<LayoutElement> = []; // Initialize

  constructor(children: Array<LayoutElement> = []) {
    super("Section"); // Use string literal
    this.children = children;
  }
}

// GlobalStyles might be complex to represent directly with as-json's limitations
// For simplicity, we might omit it or use a simpler structure initially.
// Example: A Map for variables and classes. BaseElementStyles are harder.
// @ts-ignore: decorator is valid
@json
export class SimpleGlobalStyles {
    // NOTE: This is a simplified version of the host's `GlobalStyles` due to `json-as` limitations.
    // It currently only supports `variables`. Complex structures like nested objects for classes
    // or baseElementStyles are harder to serialize reliably with `json-as`.
    variables: Map<string, string> | null = null; // Initialize
    // Skipping classes and baseElementStyles for simplicity in this example
}

// @ts-ignore: decorator is valid
@json
export class DocumentElement extends LayoutElement {
  children: Array<LayoutElement> = []; // Initialize
  globalStyles: SimpleGlobalStyles | null = null; // Using simplified version, initialize

  constructor(children: Array<LayoutElement> = []) {
    super("Document"); // Use string literal
    this.children = children;
    this.globalStyles = null;
  }
}

// --- Host Function Imports ---
// Define the functions expected from the host environment using `@external`.
// The names ("env", "log") and signatures must exactly match the host implementation.

// @ts-ignore: decorator
@external("env", "log") // Imports the 'log' function from the 'env' module provided by the host
export declare function log(message: string): void;

// Add declarations for other host functions if defined (e.g., formatCurrency)