# AssemblyScript Invoice Template Developer Guide

This guide provides information for developers creating custom invoice templates using AssemblyScript, compiled to WebAssembly (Wasm), for the Alga PSA invoice rendering system.

**Table of Contents:**

1.  [Architecture Overview](#1-architecture-overview)
2.  [Getting Started: Using the Boilerplate](#2-getting-started-using-the-boilerplate)
3.  [AssemblyScript for Templates](#3-assemblyscript-for-templates)
    *   [Key Concepts & Constraints](#key-concepts--constraints)
    *   [Best Practices](#best-practices)
4.  [The Layout Schema](#4-the-layout-schema)
5.  [Host Function API](#5-host-function-api)
6.  [Generating Layout Structures (Tutorials/Examples)](#6-generating-layout-structures-tutorials-examples)
    *   [Basic Structure](#basic-structure)
    *   [Working with Data (ViewModel)](#working-with-data-viewmodel)
    *   [Loops and Conditionals](#loops-and-conditionals)
    *   [Applying Styles](#applying-styles)
    *   [Pagination Hints](#pagination-hints)
    *   [Generating Multiple Sections (Side Reports)](#generating-multiple-sections-side-reports)
7.  [Development Workflow](#7-development-workflow)
    *   [Compilation](#compilation)
    *   [Debugging](#debugging)
    *   [Testing (Considerations)](#testing-considerations)
8.  [Security Considerations](#8-security-considerations)

---

## 1. Architecture Overview

The invoice rendering system utilizes a secure and flexible architecture based on WebAssembly:

1.  **Host Environment (Node.js/TypeScript):** The main application server.
    *   Prepares the `InvoiceViewModel` data.
    *   Loads the compiled Wasm template module (`.wasm` file).
    *   Instantiates the Wasm module within the **Wasmer** runtime, providing a sandboxed execution environment.
    *   Provides minimal, secure **Host Functions** (like `log`) accessible from within the Wasm module.
    *   Calls the exported `generateLayout` function within the Wasm module, passing the `InvoiceViewModel` as a JSON string.
2.  **Wasm Module (AssemblyScript Template):** Your compiled template code.
    *   Receives the `InvoiceViewModel` JSON string.
    *   Deserializes the JSON into AssemblyScript objects using `json-as`.
    *   Contains the logic to process the view model data.
    *   Constructs a **Layout Data Structure** (defined by the Layout Schema, starting with `DocumentElement`) representing the desired invoice layout. This structure describes elements like sections, rows, columns, text, etc., and their styles.
    *   Serializes the resulting `DocumentElement` object back into a JSON string using `json-as`.
    *   Returns the layout JSON string to the host.
3.  **Host Renderer (Node.js/TypeScript):**
    *   Receives the layout JSON string from the Wasm module.
    *   Deserializes the layout JSON.
    *   Interprets the Layout Data Structure and translates it into the final output format (currently HTML and CSS). It handles the actual rendering based on the abstract layout description provided by the Wasm template.

**Key Benefits:**

*   **Security:** Wasm runs in a sandbox, isolating template code from the host system. Templates only have access to explicitly provided data and host functions.
*   **Flexibility:** Templates are written in a Turing-complete language (AssemblyScript), allowing complex logic and calculations.
*   **Decoupling:** Templates generate an abstract layout structure, not final HTML/CSS. This separates template logic from presentation concerns and allows the host renderer to target different output formats in the future.
*   **Performance:** Wasm is designed for near-native execution speed.

```mermaid
graph LR
    A[Host Environment (Node.js)] -- JSON(ViewModel) --> B{Wasmer Runtime};
    B -- Calls --> C[Wasm Template (AssemblyScript)];
    C -- Uses --> D(json-as);
    C -- Calls --> E[Host Functions (e.g., log)];
    A -- Provides --> E;
    C -- Returns JSON(Layout) --> B;
    B -- JSON(Layout) --> F[Host Renderer (Node.js)];
    F -- Generates --> G[Final Output (HTML/CSS)];

    style C fill:#f9f,stroke:#333,stroke-width:2px
    style F fill:#ccf,stroke:#333,stroke-width:2px
```

---

## 2. Getting Started: Using the Boilerplate

The easiest way to start a new template is to copy the boilerplate project:

1.  **Copy:** Duplicate the `server/src/invoice-templates/assemblyscript/boilerplate/` directory and rename it (e.g., `my-custom-template`).
2.  **Navigate:** `cd server/src/invoice-templates/assemblyscript/my-custom-template`
3.  **Install Dependencies:** Run `npm install`.
4.  **Customize `package.json`:** Update the `name`, `version`, `description`, and `author` fields.
5.  **Develop:** Modify `assembly/index.ts` to implement your template logic. Refer to `assembly/types.ts` for available data structures and layout elements.
6.  **Compile:** Run `npm run build` to create the release Wasm file (`build/release.wasm`) or `npm run build:debug` for a debug build (`build/debug.wasm`).

The boilerplate includes:
*   Pre-configured `package.json` with build scripts.
*   `tsconfig.json` for AssemblyScript compilation settings.
*   `assembly/types.ts`: Mirrored type definitions for data and layout structures.
*   `assembly/common/abort.ts`: A utility for handling fatal errors.
*   `assembly/index.ts`: The main entry point with example code.

---

## 3. AssemblyScript for Templates

AssemblyScript (AS) is a variant of TypeScript that compiles to WebAssembly. While familiar to TypeScript developers, there are specific constraints and best practices to keep in mind when writing templates.

### Key Concepts & Constraints

*   **Strong Typing:** AS is statically typed. Use the types defined in `assembly/types.ts`.
*   **Wasm Limitations:** You are running in a Wasm environment, not Node.js or a browser.
    *   **No Direct DOM Access:** Templates generate layout data, they don't manipulate HTML directly.
    *   **Limited APIs:** Only standard AS library features and explicitly provided Host Functions are available. No Node.js APIs.
    *   **Garbage Collection:** AS has its own garbage collector. Be mindful of object allocations in complex loops, though it's generally efficient.
*   **Serialization (`json-as`):**
    *   Data exchange with the host relies on JSON serialization/deserialization using the `json-as` library.
    *   Decorate classes intended for serialization with `@json`.
    *   Be aware of `json-as` limitations (e.g., complex types, index signatures might require workarounds or simplification compared to host TypeScript). Refer to the comments in `assembly/types.ts`.
    *   Use `JSON.parse<Type>(jsonString)` to deserialize and `JSON.stringify(object)` to serialize.
*   **Numeric Types:** Use `i32`, `f64`, etc., as appropriate. Host `number` typically maps to `f64`.
*   **Nullability:** Use `Type | null` for optional/nullable fields and initialize them (e.g., `myField: string | null = null;`).
*   **Host Functions:** Access host-provided utilities (like `log`) via `@external` declarations in `types.ts`.

### Best Practices

*   **Keep Logic Focused:** Templates should focus on transforming `InvoiceViewModel` data into the `DocumentElement` layout structure. Avoid overly complex, unrelated computations.
*   **Use Types:** Leverage the provided types for clarity and safety.
*   **Modularity:** Break down complex layout generation into smaller helper functions within your `index.ts` or separate `.ts` files within the `assembly/` directory.
*   **Error Handling:** Use `try...catch` blocks when parsing input JSON (`JSON.parse`) and serializing output JSON (`JSON.stringify`). Use the `log` host function to report errors. Consider using the `abort` function for unrecoverable errors.
*   **Logging:** Use the `log` host function liberally during development for debugging state and values. Remember to remove or reduce excessive logging in production builds.
*   **Performance:** While AS/Wasm is fast, avoid extremely deeply nested structures or highly inefficient algorithms if processing very large datasets within the template. Profile if necessary.
*   **Readability:** Write clean, well-commented code.

---

## 4. The Layout Schema

The core idea is that your AssemblyScript template generates a hierarchical structure of **Layout Elements**. This structure is a language-agnostic description of the invoice's content and layout, which the host renderer then translates into final HTML/CSS.

All layout elements share a common base structure defined by the `LayoutElement` interface (represented as the `LayoutElement` class in AssemblyScript).

### Base `LayoutElement` Properties

All layout elements inherit these properties:

*   `type` (`LayoutElementType` / `string` in AS): Specifies the kind of element (e.g., 'Section', 'Text'). See [Element Types](#element-types) below.
*   `id` (`string | null`): An optional unique identifier for the element. Useful for targeting specific elements with styles or for identifying sections (like side reports).
*   `style` (`ElementStyle | null`): An optional object containing CSS-like style rules to be applied directly to this element. See [Element Styles](#element-styles) below.
*   `pageBreakBefore` (`boolean` / `bool` in AS): If `true`, suggests to the renderer that a page break should occur *before* this element (useful for PDF generation). Default: `false`.
*   `keepTogether` (`boolean` / `bool` in AS): If `true`, suggests to the renderer that this element and its direct children should be kept on the same page if possible. Default: `false`.

### Element Types (`LayoutElementType`)

This defines the different kinds of building blocks available for your layout.

| Host Enum Value | AssemblyScript String Value | Description                                                                 | Child Elements Expected                               |
| :-------------- | :-------------------------- | :-------------------------------------------------------------------------- | :---------------------------------------------------- |
| `Document`      | `"Document"`                | The root element of the entire layout structure.                            | `LayoutElement[]` (Sections, Rows, etc.)              |
| `Section`       | `"Section"`                 | A logical division of the document (e.g., header, main content, footer).    | `LayoutElement[]` (Rows, Columns, Text, Images, etc.) |
| `Row`           | `"Row"`                     | A horizontal container, typically used to hold `Column` elements side-by-side. | `ColumnElement[]`                                     |
| `Column`        | `"Column"`                  | A vertical container within a `Row`. Often used for grid-like layouts.      | `LayoutElement[]` (Text, Images, nested Rows, etc.)   |
| `Text`          | `"Text"`                    | Represents a block of text content.                                         | None                                                  |
| `Image`         | `"Image"`                   | Represents an image.                                                        | None                                                  |

*(Note: More element types like `Table`, `List`, `Spacer` might be added in the future.)*

### Specific Element Details

#### `DocumentElement`

*   **Purpose:** The single root node of the layout tree returned by the `generateLayout` function.
*   **Properties:**
    *   Inherits all `LayoutElement` properties.
    *   `children` (`LayoutElement[]`): An array containing the top-level elements of the document (usually `SectionElement`s).
    *   `globalStyles` (`GlobalStyles | null` / `SimpleGlobalStyles | null` in AS): Defines styles applicable to the entire document (e.g., variables, base styles). See [Global Styles](#global-styles).

#### `SectionElement`

*   **Purpose:** Groups related content logically (e.g., header, footer, item list, side report). Can be used with `pageBreakBefore` or `id` for identification.
*   **Properties:**
    *   Inherits all `LayoutElement` properties.
    *   `children` (`LayoutElement[]`): An array of elements contained within the section.

#### `RowElement`

*   **Purpose:** Arranges child `ColumnElement`s horizontally. The host renderer typically implements this using flexbox or a similar CSS layout mechanism.
*   **Properties:**
    *   Inherits all `LayoutElement` properties.
    *   `children` (`ColumnElement[]`): An array of the columns within this row.

#### `ColumnElement`

*   **Purpose:** Represents a vertical region within a `Row`. Can contain any other layout elements.
*   **Properties:**
    *   Inherits all `LayoutElement` properties.
    *   `children` (`LayoutElement[]`): An array of elements contained within the column.
    *   `span` (`number | undefined` / `i32` in AS): Optional. If the host renderer uses a grid system, this could indicate how many grid columns this element should occupy. (Default interpretation depends on the renderer).

#### `TextElement`

*   **Purpose:** Displays text content.
*   **Properties:**
    *   Inherits all `LayoutElement` properties.
    *   `content` (`string`): The text to be displayed.
    *   `variant` (`string | null`): Optional semantic variant (e.g., `'heading1'`, `'heading2'`, `'paragraph'`, `'label'`, `'caption'`). The host renderer uses this to apply default styling (which can be overridden by `style` or `globalStyles`).

#### `ImageElement`

*   **Purpose:** Displays an image.
*   **Properties:**
    *   Inherits all `LayoutElement` properties.
    *   `src` (`string`): The URL or potentially a Base64 data URI of the image.
    *   `alt` (`string | null`): Optional alternative text for accessibility.

### Element Styles (`ElementStyle`)

The optional `style` property on any `LayoutElement` allows applying direct, inline CSS-like styles.

*   **Property Names:** Use `camelCase` (e.g., `backgroundColor`, `fontSize`).
*   **Values:** Typically strings (e.g., `'10px'`, `'#FF0000'`, `'bold'`). Numeric values might be used for properties like `flexGrow`.
*   **Common Properties:**
    *   Layout & Box Model: `width`, `height`, `padding`, `paddingTop`, `margin`, `marginLeft`, `border`, `borderRadius`, etc.
    *   Flexbox/Grid Children: `flexGrow`, `flexShrink`, `flexBasis`, `alignSelf`.
    *   Typography: `fontSize`, `fontWeight`, `fontFamily`, `textAlign`, `lineHeight`, `color`.
    *   Background & Borders: `backgroundColor`, `borderColor`, `borderWidth`, `borderStyle`.
*   **AssemblyScript Note:** The AS `ElementStyle` class defines many common properties explicitly (like `borderTopWidth`, `borderRightStyle`, etc.) because `json-as` doesn't easily support the arbitrary key-value index signature (`[key: string]: string | number | undefined;`) used in the host TypeScript definition. Ensure styles needed in AS are explicitly defined in `assembly/types.ts`.

### Global Styles (`GlobalStyles` / `SimpleGlobalStyles`)

The `globalStyles` property on the root `DocumentElement` provides a way to define styles that apply more broadly than inline styles.

*   **Host Definition (`GlobalStyles`):**
    *   `variables`: Defines CSS-like variables (e.g., `{ "--primary-color": "#007bff" }`).
    *   `classes`: Defines reusable style objects assignable by class name (e.g., `{ ".highlight": { backgroundColor: "yellow" } }`). *(Currently not easily usable/serializable from AssemblyScript)*.
    *   `baseElementStyles`: Applies default styles based on element type and optionally variant (e.g., style all `TextElement`s with `variant: 'caption'`). *(Currently not easily usable/serializable from AssemblyScript)*.
*   **AssemblyScript Definition (`SimpleGlobalStyles`):**
    *   Due to `json-as` serialization limitations, the AS version currently only supports the `variables` property, represented as a `Map<string, string> | null`.
    *   Future enhancements might explore ways to support classes or base styles if needed, potentially through different serialization strategies or host function interactions.

---

## 5. Host Function API

Host functions are utilities provided by the Node.js host environment that can be called from within your AssemblyScript Wasm template. They provide a secure way to perform actions that Wasm cannot do directly (like I/O or accessing external services).

The available host functions are declared using `@external` in `assembly/types.ts`. You must import them in your `assembly/index.ts` to use them.

### Available Functions

#### `log`

*   **Declaration (in `assembly/types.ts`):**
    ```typescript
    // @ts-ignore: decorator
    @external("env", "log") // Imports the 'log' function from the 'env' module provided by the host
    export declare function log(message: string): void;
    ```
*   **Import (in `assembly/index.ts`):**
    ```typescript
    import { log } from "./types";
    ```
*   **Signature:** `log(message: string): void`
*   **Purpose:** Sends a string message from the Wasm module to the host environment for logging. This is the primary mechanism for debugging template execution.
*   **Parameters:**
    *   `message` (`string`): The message to log.
*   **Returns:** `void`
*   **Usage Example:**
    ```typescript
    import { log } from "./types";
    // ... inside a function ...
    const itemCount = viewModel.items.length;
    log(`Processing ${itemCount} invoice items.`);
    ```
*   **Host Behavior:** The host environment receives this message and typically prints it to its standard output or logging system (e.g., `console.log` on the server).

*(Note: More host functions, such as `formatCurrency(amount: f64, currencyCode: string): string` or utility functions for complex date/number formatting, might be added in the future if deemed necessary and safe.)*

---

## 6. Generating Layout Structures (Tutorials/Examples)

This section provides practical examples of how to generate layout structures within your AssemblyScript template (`assembly/index.ts`).

### Basic Structure

The entry point `generateLayout` function receives the `InvoiceViewModel` as a JSON string and must return the `DocumentElement` layout structure as a JSON string.

```typescript
// assembly/index.ts
import { JSON } from "json-as";
import {
  InvoiceViewModel, DocumentElement, SectionElement, RowElement,
  ColumnElement, TextElement, LayoutElement, log
} from "./types";

// @ts-ignore: decorator is valid
@json
export function generateLayout(viewModelJson: string): string {
  log("WASM: generateLayout started.");

  // 1. Deserialize Input
  let viewModel: InvoiceViewModel;
  try {
    viewModel = JSON.parse<InvoiceViewModel>(viewModelJson);
  } catch (e) {
    log(`WASM: Error parsing input: ${e.message}`);
    // Return empty document or handle error
    return JSON.stringify(new DocumentElement([]));
  }

  // 2. Build Layout Elements (See examples below)
  const documentChildren: LayoutElement[] = [];

  // Example: Add a header section
  documentChildren.push(createHeaderSection(viewModel));
  // Example: Add an items section
  documentChildren.push(createItemsSection(viewModel));
  // ... add more sections ...

  // Create the root document element
  const document = new DocumentElement(documentChildren);

  // 3. Serialize Output
  let resultJson: string;
  try {
    resultJson = JSON.stringify(document);
  } catch (e) {
    log(`WASM: Error serializing output: ${e.message}`);
    return "{}"; // Return empty object on error
  }

  log("WASM: generateLayout finished.");
  return resultJson;
}

// --- Helper Functions for Creating Sections ---

function createHeaderSection(vm: InvoiceViewModel): SectionElement {
  return new SectionElement([
    new RowElement([
      new ColumnElement([ new TextElement(`Invoice: ${vm.invoiceNumber}`, "heading1") ]),
      new ColumnElement([ new TextElement(`Date: ${vm.issueDate}`, "paragraph") ])
    ])
  ]);
}

function createItemsSection(vm: InvoiceViewModel): SectionElement {
  // ... implementation ... (see Loops example)
  return new SectionElement([]); // Placeholder
}

// ... other helper functions ...

```

### Working with Data (ViewModel)

Access data from the deserialized `viewModel` object using standard object property access.

```typescript
function createCustomerSection(vm: InvoiceViewModel): SectionElement {
  const customer = vm.customer; // Access nested object
  return new SectionElement([
    new TextElement("Bill To:", "heading2"),
    new TextElement(customer.name, "paragraph"), // Access string property
    new TextElement(customer.address, "paragraph")
  ]);
}
```

### Loops and Conditionals

Use standard AssemblyScript loops (`for`, `while`) and conditionals (`if`, `else`) to generate elements dynamically based on data.

```typescript
function createItemsSection(vm: InvoiceViewModel): SectionElement {
  const itemRows: LayoutElement[] = [];

  // Add header row (optional)
  itemRows.push(
    new RowElement([
      new ColumnElement([new TextElement("Description", "label")]),
      new ColumnElement([new TextElement("Qty", "label")]),
      new ColumnElement([new TextElement("Price", "label")]),
      new ColumnElement([new TextElement("Total", "label")])
    ])
  );

  // Loop through items
  for (let i = 0; i < vm.items.length; i++) {
    const item = vm.items[i];
    itemRows.push(
      new RowElement([
        new ColumnElement([new TextElement(item.description, "paragraph")]),
        // Convert numbers to strings for TextElement content
        new ColumnElement([new TextElement(item.quantity.toString(), "paragraph")]),
        new ColumnElement([new TextElement(item.unitPrice.toString(), "paragraph")]),
        new ColumnElement([new TextElement(item.total.toString(), "paragraph")])
      ])
    );
  }

  // Conditionally add notes
  if (vm.notes && vm.notes!.length > 0) { // Check for null and empty string
     itemRows.push(new TextElement(`Notes: ${vm.notes!}`, "caption"));
  }

  return new SectionElement(itemRows);
}
```

### Applying Styles

Styles can be applied directly to elements using the `style` property. Create an `ElementStyle` object (remember it needs the `@json` decorator in `types.ts` if you modify it).

```typescript
function createTotalsSection(vm: InvoiceViewModel): SectionElement {
    const totalRow = new RowElement([
        new ColumnElement([ new TextElement("Total:", "label") ]),
        new ColumnElement([ new TextElement(vm.total.toString(), "paragraph") ])
    ]);

    // Apply bold style to the 'Total:' label
    const totalLabel = (totalRow.children[0].children[0] as TextElement);
    totalLabel.style = new ElementStyle(); // Create a style object
    totalLabel.style!.fontWeight = "bold"; // Set properties

    // Apply right-alignment to the total amount
    const totalAmount = (totalRow.children[1].children[0] as TextElement);
    totalAmount.style = new ElementStyle();
    totalAmount.style!.textAlign = "right";

    return new SectionElement([
        // ... other rows for subtotal, tax ...
        totalRow
    ]);
}
```
*(Note: Using global styles or variants via the host renderer is often preferred for consistency over many inline styles.)*

### Pagination Hints

Set `pageBreakBefore` or `keepTogether` on elements to guide the renderer (especially for PDF output).

```typescript
function createReportSection(vm: InvoiceViewModel): SectionElement {
  const section = new SectionElement([
    // ... content of the report ...
  ]);
  section.id = "summary-report";
  section.pageBreakBefore = true; // Start this report on a new page
  return section;
}
```

### Generating Multiple Sections (Side Reports)

Generate different `SectionElement`s for different parts of the output (e.g., main invoice, time log summary). Use the optional `id` property on sections to help the host identify them if needed.

```typescript
// In generateLayout function:

const documentChildren: LayoutElement[] = [];

// Main Invoice Sections
documentChildren.push(createHeaderSection(viewModel));
documentChildren.push(createCustomerSection(viewModel));
documentChildren.push(createItemsSection(viewModel));
documentChildren.push(createTotalsSection(viewModel));

// Conditionally add Time Log Section
if (viewModel.timeEntries && viewModel.timeEntries!.length > 0) {
  documentChildren.push(createTimeLogSection(viewModel));
}

const document = new DocumentElement(documentChildren);
// ... serialize and return ...

// --- Helper for Time Log ---
function createTimeLogSection(vm: InvoiceViewModel): SectionElement {
  const timeRows: LayoutElement[] = [];
  // ... loop through vm.timeEntries and create RowElements ...
  const section = new SectionElement(timeRows);
  section.id = "time-log-summary"; // Identify the section
  section.pageBreakBefore = true; // Optional: Start on new page
  return section;
}
```
The host renderer receives the single `DocumentElement` containing all these sections and can choose how to display them (e.g., concatenate them, or potentially render the section with `id="time-log-summary"` separately).

---

## 7. Development Workflow

### Compilation

*   **Release Build:** `npm run build`
    *   Compiles `assembly/index.ts` to `build/release.wasm`.
    *   Optimized for production use (`--optimize --noAssert`).
*   **Debug Build:** `npm run build:debug`
    *   Compiles `assembly/index.ts` to `build/debug.wasm`.
    *   Includes debug symbols and assertions (`--target debug --sourceMap`). Useful for debugging.

The host application will typically load the `release.wasm` file.

### Debugging

Debugging Wasm can be challenging. Strategies include:

*   **Logging:** Use the `log` host function extensively to print variable values and trace execution flow. Check the host application's logs.
*   **Debug Builds:** Use the `debug.wasm` build. Some Wasm runtimes (potentially Wasmer with specific configurations or browser devtools if testing there) might offer step-debugging capabilities, but this often requires specific setup.
*   **Unit Testing (Conceptual):** While direct AS unit testing frameworks might be complex to set up in this context, you can test logic by:
    *   Creating mock `InvoiceViewModel` JSON strings.
    *   Running the Wasm module (using a simple loader script or the host application).
    *   Deserializing and inspecting the output layout JSON string.
*   **Simplify and Isolate:** If facing issues, simplify the template logic or comment out sections to isolate the problem area.

### Testing (Considerations)

*   Focus testing on the *output layout structure* generated by the Wasm module for given inputs.
*   Verify that the generated layout JSON is valid and correctly represents the desired structure based on the input `ViewModel`.
*   The host renderer component should have its own tests to ensure it correctly translates various layout structures into the final HTML/CSS.

---

## 8. Security Considerations

While Wasm provides a strong security sandbox, template authors should still be mindful:

*   **Input Data:** Trust the `InvoiceViewModel` data provided by the host, but be aware that complex logic could potentially have unintended consequences if data is malformed (though parsing errors should be caught).
*   **Host Functions:** Only use the explicitly provided host functions. Do not assume access to any other system resources. The available functions (`log`) are designed to be safe.
*   **Resource Limits:** The Wasmer runtime imposes limits on memory and execution time, preventing runaway templates from consuming excessive server resources.
*   **Denial of Service:** Avoid infinite loops or extremely computationally expensive operations within the template logic that could exhaust allocated resources or time limits.
*   **Serialization Complexity:** Very large or deeply nested layout structures could consume significant memory during serialization/deserialization on both the Wasm and host sides. Keep layouts reasonably sized.

---
**(Further sections like Layout Schema, API, Tutorials will be filled in subsequent steps)**