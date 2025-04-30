# Guide: Creating AssemblyScript Invoice Templates

This document explains how to create custom invoice templates using AssemblyScript for the Alga PSA system.

## 1. Overview

Invoice templates are written in AssemblyScript, a subset of TypeScript that compiles to WebAssembly (Wasm). This allows for safe, sandboxed execution of your custom layout logic on the server. Your AssemblyScript code defines the structure and content of the invoice based on the provided data by returning a specific JSON structure.

## 2. Execution Environment

*   **Compilation:** Your AssemblyScript (`.ts`) file is compiled into a Wasm binary (`.wasm`) using the AssemblyScript compiler (`asc`) when you save the template in the UI.
*   **Sandbox:** The compiled Wasm code runs in a secure sandbox environment on the server, managed by `server/src/lib/invoice-renderer/wasm-executor.ts`. This executor uses the `@assemblyscript/loader` library.
*   **Instantiation:** When an invoice needs rendering, the executor loads and instantiates your Wasm module, providing necessary host functions.
*   **Host Functions:** The Wasm module can import and call specific functions provided by the host environment (JavaScript). See Section 4 for details. Your Wasm code cannot directly access the filesystem, network, or other general system resources beyond these provided functions.

## 3. Entry Point & Data Flow

Your AssemblyScript code **must** export a function named `generateLayout`. This function is the entry point called by the Wasm executor.

**Signature in AssemblyScript:**

```typescript
// --- Example AssemblyScript Template (.ts) ---
import { JSON } from "json-as"; // Recommended JSON library for AssemblyScript

// Import host functions (fundamentally from "env", might be re-exported locally)
import { log, abort } from "env";
// OR potentially from a local types file:
// import { log, abort } from "../assembly/types";

// Define or import your type definitions within this file.
// These should mirror the structure expected/provided by the host.
// They might include classes with helper methods (like .toJsonString()).
// Example (replace with actual definitions):
import {
  InvoiceViewModel, // Input data structure
  LayoutElement, DocumentElement, SectionElement, RowElement, ColumnElement, TextElement // Output structure elements
} from "./placeholder-types"; // Assuming types are defined below or globally available

// Optional: Decorator sometimes needed for memory management or specific features
// @ts-ignore: decorator
// @unsafe
export function generateLayout(invoiceDataJson: string): string {
  let invoice: InvoiceViewModel;

  // 1. Deserialize the input JSON string using json-as
  try {
    // Use JSON.parse<YourType>() to parse directly into a typed object
    invoice = JSON.parse<InvoiceViewModel>(invoiceDataJson);
    log("Wasm Info: Successfully parsed Invoice #: " + (invoice.invoiceNumber || "N/A"));
  } catch (e) {
    const errorMsg = "Failed to parse input JSON: " + e.message;
    log("Wasm Error: " + errorMsg);
    // Option 1: Abort execution (stops everything)
    // abort(errorMsg, "template.ts", 1, 1); // Pointers needed if using abort directly

    // Option 2: Return a simple error document JSON
    const errorElement = new TextElement("Error: Invalid input data. " + errorMsg);
    const errorDoc = new DocumentElement([errorElement]);
    return errorDoc.toJsonString(); // Assumes your classes have a serialization method
  }

  // Basic validation after parsing
  if (invoice.invoiceNumber == null || invoice.invoiceNumber == "") {
      log("Wasm Warning: Invoice number is missing.");
      // Potentially return an error document here as well
  }

  // 2. Build the layout structure using the invoice data
  // Create instances of your LayoutElement classes
  const layout: DocumentElement = createMyInvoiceLayout(invoice);

  // 3. Serialize the layout structure back to JSON
  // Call the serialization method on your root element class
  const layoutJsonString = layout.toJsonString();
  log("Wasm Info: Returning serialized layout.");

  // 4. Return the JSON string (loader handles pointer conversion)
  return layoutJsonString;
}

// --- Your Core Logic ---

function createMyInvoiceLayout(invoice: InvoiceViewModel): DocumentElement {
  // Example: Create a simple layout
  const headerText = new TextElement("Invoice: " + invoice.invoiceNumber);
  const customerText = new TextElement("Customer: " + invoice.customer.name); // Access nested data

  const headerSection = new SectionElement([headerText, customerText]);
  headerSection.id = "invoice-header"; // Optional ID

  // ... add more elements for line items, totals etc. ...

  const document = new DocumentElement([headerSection]);
  document.id = "invoice-document";
  return document;
}

// --- Type Definitions (Illustrative) ---
// Define necessary classes and types directly within your template script.
// These should match the structure expected by the host system's renderer
// and the data provided in the input JSON.

// Example Input Data Structure (adjust based on actual ViewModel)
@json
class InvoiceCustomer { name: string = ""; address: string = ""; }
@json
class InvoiceItem { id: string = ""; description: string = ""; quantity: f64 = 0; unitPrice: f64 = 0; total: f64 = 0; category: string | null = null; }
@json
class InvoiceViewModel { invoiceNumber: string = ""; issueDate: string = ""; customer: InvoiceCustomer = new InvoiceCustomer(); items: Array<InvoiceItem> = []; notes: string | null = null; }

// Example Output Layout Structure (adjust based on actual LayoutElement types)
// Base class/interface might not be needed if using json-as decorators directly
// on concrete classes. Ensure they produce the correct JSON structure.
@json
class LayoutElementBase { // Using a base class for common fields
  type: string = "";
  id: string | null = null;
  style: ElementStyle | null = null;
  children: Array<LayoutElementBase> | null = null; // Use base class for children array
  pageBreakBefore: boolean = false;
  keepTogether: boolean = false;

  // Basic serialization - might need refinement based on json-as behavior
  toJsonString(): string {
      // json-as might handle serialization automatically with @JSON decorator.
      // If manual serialization is needed, implement it here.
      // This is a placeholder:
      return JSON.stringify(this);
  }
}

@json
class ElementStyle { /* Define style properties as needed */ textAlign: string | null = null; color: string | null = null; /* ... etc */ }
@json
class GlobalStyles { /* Define global styles structure */ }

// Concrete element classes inheriting common fields
@json
class DocumentElement extends LayoutElementBase {
  type: string = "Document";
  globalStyles: GlobalStyles | null = null;
  constructor(children: Array<LayoutElementBase>) { super(); this.children = children; }
}
@json
class SectionElement extends LayoutElementBase {
  type: string = "Section";
  constructor(children: Array<LayoutElementBase>) { super(); this.children = children; }
}
@json
class RowElement extends LayoutElementBase {
  type: string = "Row";
  constructor(children: Array<LayoutElementBase>) { super(); this.children = children; }
}
@json
class ColumnElement extends LayoutElementBase {
  type: string = "Column";
  span: i32 = 0; // Use i32 for integer span
  constructor(children: Array<LayoutElementBase>) { super(); this.children = children; }
}
@json
class TextElement extends LayoutElementBase {
  type: string = "Text";
  content: string = "";
  variant: string | null = null;
  constructor(content: string, variant: string | null = null) { super(); this.content = content; this.variant = variant; this.children = null; } // Text elements typically don't have children
}
// ... Define other element classes (ImageElement, etc.) similarly ...

// NOTE: Ensure your class definitions and the use of `json-as` correctly
// serialize to the JSON structure expected by the layout renderer.
// Test serialization carefully.
```

*   **`generateLayout(invoiceDataJson: string): string`**
    *   **Parameter:** Receives the `InvoiceViewModel` data as a standard JavaScript `string` (UTF-16).
    *   **Input Data Structure (`InvoiceViewModel`):** This JSON string contains all necessary information about the invoice. *Refer to the actual `InvoiceViewModel` type definition in the host codebase (`server/src/lib/invoice-renderer/types.ts`) for the precise fields.*
    *   **Return Value:** Must return a standard JavaScript `string` (UTF-16) which is the JSON representation of the desired invoice layout (`LayoutElement` structure). The loader handles converting this string back to the host environment. Returning an empty string or a JSON representing a minimal error document is appropriate for handling issues gracefully. Use `abort` for unrecoverable errors.

## 4. Host Functions (Available Imports)

Your AssemblyScript module can import and call the following functions provided by the host environment. Import them from the `"env"` module (though they might be re-exported via local type definition files).

*   **`log(messagePtr: usize): void`**
    *   Logs a message string (pointed to by `messagePtr`) to the server console, prefixed with `[Wasm Log]:`. Useful for debugging. **Note:** You'll need to convert your AssemblyScript string to a pointer (`usize`) to pass it, often handled by loader helpers or implicitly when calling imported functions expecting strings (check loader specifics). The example above uses `log("Wasm Info: ...")` assuming the loader or a wrapper handles the string conversion.
*   **`abort(messagePtr: usize, fileNamePtr: usize, lineNumber: u32, columnNumber: u32): void`**
    *   Immediately terminates Wasm execution and signals a fatal error to the host.
    *   Requires pointers (`usize`) to the message and filename strings.
    *   The host will log these details and throw an exception, stopping the invoice rendering process.

**Example Usage (AssemblyScript):**

```typescript
import { log, abort } from "env"; // Or from local types file

// Assuming you have a way to get string pointers if needed,
// otherwise the loader might handle it for `log`.
const message = "Something went wrong!";
const file = "my-template.ts";

log("Processing item ID: " + itemId.toString()); // Loader might handle string conversion

if (errorCondition) {
  // Abort requires explicit pointers (implementation depends on setup)
  // abort(getStringPtr(message), getStringPtr(file), 105, 4);
  log("Error: Condition failed for item " + itemId.toString());
  // Consider returning an error document instead of aborting
}
```

## 5. Output Format: The LayoutElement JSON

Your `generateLayout` function must construct and return a JSON string representing the invoice layout. This structure is defined by a tree of `LayoutElement` objects (or classes implementing that structure).

**`LayoutElement` Structure (Conceptual TypeScript):**

```typescript
// Defined in: server/src/lib/invoice-renderer/types.ts

// Enum defining valid element types (use these string values in your JSON)
export enum LayoutElementType {
  Document = 'Document',
  Section = 'Section',
  Row = 'Row',
  Column = 'Column',
  Text = 'Text',
  Image = 'Image',
  // Note: Spacer, Table etc. were NOT implemented in the provided renderer
}

// Style properties (camelCase in TS/AS, converted to kebab-case for CSS)
interface ElementStyle {
  // Examples (use valid CSS values):
  fontSize?: string; // '10px', '1.2em'
  fontWeight?: 'normal' | 'bold' | number;
  color?: string; // '#333333', 'rgb(0,0,0)'
  backgroundColor?: string;
  padding?: string; // '10px', '5px 10px'
  margin?: string;
  border?: string; // '1px solid #ccc'
  textAlign?: 'left' | 'center' | 'right';
  width?: string; // '100%', '50px'
  height?: string;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: string;
  // ... other standard CSS properties (camelCase)
}

// Global styles applied at the Document level
interface GlobalStyles {
  variables?: { [key: string]: string }; // CSS variables (--primary-color: #ff0000;)
  classes?: { [key: string]: ElementStyle }; // Custom global CSS classes (.my-custom-class { ... })
  baseElementStyles?: {
    [key in LayoutElementType]?: ElementStyle | { [variant: string]: ElementStyle };
  }; // Default styles for element types (e.g., all 'Row's) or variants (e.g., 'Text-heading1')
}

// Base interface for all layout elements
interface LayoutElement {
  type: LayoutElementType; // Must be one of the enum values
  id?: string; // Optional unique ID for direct CSS targeting (#myElementId)
  style?: ElementStyle; // Styles applied directly to this element
  children?: LayoutElement[]; // Nested child elements
  pageBreakBefore?: boolean; // Hint for printing: add 'page-break-before: always'
  keepTogether?: boolean; // Hint for printing: add 'page-break-inside: avoid'
}

// Specific element interfaces (inheriting from LayoutElement)
interface DocumentElement extends LayoutElement {
  type: LayoutElementType.Document;
  globalStyles?: GlobalStyles;
}

interface SectionElement extends LayoutElement {
  type: LayoutElementType.Section;
}

interface RowElement extends LayoutElement {
  type: LayoutElementType.Row; // Typically uses flex display
}

interface ColumnElement extends LayoutElement {
  type: LayoutElementType.Column; // Child of a Row, uses flex properties
  span?: number; // Optional: for grid-like layouts (adds class .span-X)
}

interface TextElement extends LayoutElement {
  type: LayoutElementType.Text;
  content: string; // The text to display
  variant?: 'heading1' | 'heading2' | 'label' | 'caption' | 'paragraph'; // Maps to h1, h2, label, span, p tags and adds .Text-variant class
}

interface ImageElement extends LayoutElement {
  type: LayoutElementType.Image;
  src: string; // Image URL
  alt?: string; // Alt text
}

// It's common practice in AssemblyScript to create classes that correspond
// to these interfaces, potentially adding helper methods like `.toJsonString()`
// or methods for applying styles.
```

**JSON Example (Simplified):**

```json
{
  "type": "Document",
  "globalStyles": {
    "variables": { "--main-text-color": "#333" },
    "baseElementStyles": {
      "Text": { "color": "var(--main-text-color)" },
      "Row": { "marginBottom": "15px" }
    }
  },
  "children": [
    {
      "type": "Section",
      "id": "header",
      "style": { "padding": "20px", "borderBottom": "1px solid #eee" },
      "children": [
        {
          "type": "Row",
          "children": [
            {
              "type": "Column",
              "style": { "flexBasis": "50%" },
              "children": [
                { "type": "Image", "props": { "src": "logo_url", "alt": "Company Logo" }, "style": { "width": "150px" } }
              ]
            },
            {
              "type": "Column",
              "style": { "flexBasis": "50%", "textAlign": "right" },
              "children": [
                { "type": "Text", "variant": "heading1", "content": "INVOICE", "style": { "color": "#000" } },
                { "type": "Text", "content": "Invoice #: INV-001" }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "Section",
      "style": { "padding": "20px" },
      "keepTogether": true,
      "children": [
         { "type": "Text", "content": "Line items details go here..." }
      ]
    }
    // ... more sections, rows, columns etc.
  ]
}
```

## 6. Rendering Process (`layout-renderer.ts`)

The JSON string returned by your `generateLayout` function is received by the host (`wasm-executor.ts`) and parsed into a JavaScript `LayoutElement` object. This object is then passed to the `renderLayout` function in `server/src/lib/invoice-renderer/layout-renderer.ts`.

The `renderLayout` function performs the following steps:

1.  **Parses Global Styles:** Processes `globalStyles` from the root `DocumentElement`.
2.  **Traverses Tree:** Recursively walks the `LayoutElement` tree.
3.  **Generates HTML:** Maps element `type` to HTML tags, adds classes (`type`, `variant`, pagination hints), adds `id`, sets content/attributes.
4.  **Generates Element CSS:** Creates specific CSS rules for elements with `element.style`, converting camelCase to kebab-case.
5.  **Adds Default CSS:** Prepends basic resets and default styles.
6.  **Outputs:** Returns `{ html: string, css: string }`.
7.  **Final Document:** This HTML/CSS is used to create the final invoice (e.g., PDF).

By controlling the structure, content, and styling of the `LayoutElement` tree (serialized to JSON) returned from your AssemblyScript code, you dictate the final appearance of the rendered invoice. Use a compatible JSON library like `json-as` and structure your code using classes or functions as appropriate.