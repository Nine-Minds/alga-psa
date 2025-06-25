// Removed: import { JSON } from "json-as";

// --- Mirrored Host Types ---
// These types mirror the structures defined in the host environment (server/src/lib/invoice-renderer/types.ts)
// They need to be compatible with `json-as` for serialization/deserialization across the Wasm boundary.
// Key Mappings:
// - Host `number` -> AS `f64` (float) or `i32` (integer)
// - Host `boolean` -> AS `bool`
// - Host `string | undefined` or `string?` -> AS `string | null`
// - Host `enum` -> AS `string` (using exact string values)
// - Host complex objects/arrays -> AS corresponding classes/arrays decorated with `@json`

// Define classes matching the host structure, keep original names
// @ts-ignore: decorator is valid
@json
export class Customer { // Keep exported if needed elsewhere, ensure structure matches host
    name: string = "";
    address: string = "";
}

// @ts-ignore: decorator is valid
@json
export class InvoiceItem { // Keep exported, ensure structure matches host
    id: string = "";
    description: string = "";
    quantity: f64 = 0.0;
    unitPrice: f64 = 0.0;
    total: f64 = 0.0;
    category: string | null = "";
    itemType: string | null = ""; // Host uses 'service' | 'project' | 'product', AS receives as string
}

// @ts-ignore: decorator is valid
@json
export class TimeEntry { // Keep exported, ensure structure matches host
    id: string = "";
    date: string = "";
    user: string = "";
    hours: f64 = 0.0;
    description: string = "";
}

// @ts-ignore: decorator is valid
@json
export class TenantCompany { // New class mirroring host structure
    name: string | null = null;
    address: string | null = null;
    logoUrl: string | null = null;
}

// @ts-ignore: decorator is valid
@json // Use lowercase decorator
export class InvoiceViewModel {
  invoiceNumber: string = ""; // Initialize
  issueDate: string = ""; // Initialize
  dueDate: string = ""; // Initialize
  customer: Customer | null = null; // Initialize as null
  tenantCompany: TenantCompany | null = null; // ADDED tenantCompany field
  items: Array<InvoiceItem> = []; // Use InvoiceItem class
  subtotal: f64 = 0.0; // Initialize
  tax: f64 = 0.0; // Initialize
  total: f64 = 0.0; // Initialize
  notes: string | null = null; // Keep as string | null for now, initialize
  timeEntries: Array<TimeEntry> | null = null; // Use TimeEntry class, nullable array
  companyLogoUrl: string | null = null; // KEEPING OLD FIELD FOR NOW - might be removable later
}

// --- Layout Data Structure (for Wasm to return) ---

// --- JSON String Escaping Helper ---
// Basic escaping for control characters and quotes/backslashes.
function escapeJsonString(str: string): string {
    if (str == null) {
        return "";
    }
    
    log('escapeJsonString called');
    log('escapeJsonString content: ' + str);
    let result = "";
    
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        switch (char) {
            case 34: result += '\\"'; break; // "
            case 92: result += '\\\\'; break; // \
            case 8: result += '\\b'; break;   // \b
            case 12: result += '\\f'; break;  // \f
            case 10: result += '\\n'; break;  // \n
            case 13: result += '\\r'; break;  // \r
            case 9: result += '\\t'; break;   // \t
            default:
                // Basic check for control characters (0-31) - skip them
                if (char >= 32) {
                    result += String.fromCharCode(char);
                }
        }
    }
    return result;
}

// --- Layout Data Structure (for Wasm to return) ---

// Use simple string type for element types due to union type limitations
export type LayoutElementType = string; // Represents the host's LayoutElementType enum using string values

// Using `string | null` for optional fields and `f64` for numbers where appropriate in styles
// Note: Explicitly defining common style properties (like individual borders) is preferred over index signatures
// due to `json-as` limitations.
// @ts-ignore: decorator is valid - REMOVED @json
export class ElementStyle {
  width: string | null = null;
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
  borderTop: string | null = null;
  borderRight: string | null = null;
  borderBottom: string | null = null;
  borderLeft: string | null = null;
  borderRadius: string | null = null;
  flexGrow: f64 = 0;
  flexShrink: f64 = 0;
  flexBasis: string | null = null;
  alignSelf: string | null = null;
  fontSize: string | null = null;
  fontWeight: string | null = null;
  fontFamily: string | null = null;
  textAlign: string | null = null;
  lineHeight: string | null = null;
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

  // Helper functions moved outside toJsonString to avoid closure issues
  private _addStyleProp(props: string[], key: string, value: string | null): void {
      if (value !== null) {
          props.push('"' + key + '":"' + escapeJsonString(value) + '"');
      }
  }
  private _addStyleNumProp(props: string[], key: string, value: f64, defaultValue: f64): void {
      if (value != defaultValue) {
           // Handle potential NaN/Infinity - convert to null in JSON
           if (isNaN(value) || !isFinite(value)) {
               props.push('"' + key + '":null');
           } else {
               props.push('"' + key + '":' + value.toString());
           }
      }
  }

  // Method to convert style properties to a JSON string
  toJsonString(): string {
    let props: string[] = [];

    // Call helper functions, passing 'props' array
    this._addStyleProp(props, "width", this.width);
    this._addStyleProp(props, "height", this.height);
    this._addStyleProp(props, "padding", this.padding);
    this._addStyleProp(props, "paddingTop", this.paddingTop);
    this._addStyleProp(props, "paddingRight", this.paddingRight);
    this._addStyleProp(props, "paddingBottom", this.paddingBottom);
    this._addStyleProp(props, "paddingLeft", this.paddingLeft);
    this._addStyleProp(props, "margin", this.margin);
    this._addStyleProp(props, "marginTop", this.marginTop);
    this._addStyleProp(props, "marginRight", this.marginRight);
    this._addStyleProp(props, "marginBottom", this.marginBottom);
    this._addStyleProp(props, "marginLeft", this.marginLeft);
    this._addStyleProp(props, "border", this.border);
    this._addStyleProp(props, "borderTop", this.borderTop);
    this._addStyleProp(props, "borderRight", this.borderRight);
    this._addStyleProp(props, "borderBottom", this.borderBottom);
    this._addStyleProp(props, "borderLeft", this.borderLeft);
    this._addStyleProp(props, "borderRadius", this.borderRadius);
    this._addStyleNumProp(props, "flexGrow", this.flexGrow, 0);
    this._addStyleNumProp(props, "flexShrink", this.flexShrink, 0);
    this._addStyleProp(props, "flexBasis", this.flexBasis);
    this._addStyleProp(props, "alignSelf", this.alignSelf);
    this._addStyleProp(props, "fontSize", this.fontSize);
    this._addStyleProp(props, "fontWeight", this.fontWeight);
    this._addStyleProp(props, "fontFamily", this.fontFamily);
    this._addStyleProp(props, "textAlign", this.textAlign);
    this._addStyleProp(props, "lineHeight", this.lineHeight);
    this._addStyleProp(props, "color", this.color);
    this._addStyleProp(props, "backgroundColor", this.backgroundColor);
    this._addStyleProp(props, "borderColor", this.borderColor);
    this._addStyleProp(props, "borderWidth", this.borderWidth);
    this._addStyleProp(props, "borderTopWidth", this.borderTopWidth);
    this._addStyleProp(props, "borderRightWidth", this.borderRightWidth);
    this._addStyleProp(props, "borderBottomWidth", this.borderBottomWidth);
    this._addStyleProp(props, "borderLeftWidth", this.borderLeftWidth);
    this._addStyleProp(props, "borderStyle", this.borderStyle);
    this._addStyleProp(props, "borderTopStyle", this.borderTopStyle);
    this._addStyleProp(props, "borderRightStyle", this.borderRightStyle);
    this._addStyleProp(props, "borderBottomStyle", this.borderBottomStyle);
    this._addStyleProp(props, "borderLeftStyle", this.borderLeftStyle);
    this._addStyleProp(props, "borderTopColor", this.borderTopColor);
    this._addStyleProp(props, "borderRightColor", this.borderRightColor);
    this._addStyleProp(props, "borderBottomColor", this.borderBottomColor);
    // this._addStyleProp(props, "borderLeftColor", this.borderLeftColor);

    if (props.length == 0) {
        return "{}"; // Return empty object if no styles were added
    }
    return "{" + props.join(",") + "}";
  }
}

// Base class for layout elements
// @ts-ignore: decorator is valid - REMOVED @json export
export class LayoutElement {
  type: LayoutElementType;
  id: string | null = null;
  style: ElementStyle | null = null;
  pageBreakBefore: bool = false;
  keepTogether: bool = false;

  constructor(type: LayoutElementType) {
    this.type = type;
  }

  // Base method to start JSON string construction
  // Subclasses will override and add their specific properties
  protected buildJsonProps(): string[] {
      let props: string[] = [];
      props.push('"type":"' + this.type + '"'); // Type is mandatory
      if (this.id !== null) {
          props.push('"id":"' + escapeJsonString(this.id!) + '"');
      }
      if (this.style !== null) {
          const styleJson = this.style!.toJsonString();
          if (styleJson != "{}") { // Only add style if it's not empty
              props.push('"style":' + styleJson); // styleJson is already a JSON string
          }
      }
      if (this.pageBreakBefore) {
          props.push('"pageBreakBefore":true');
      }
      if (this.keepTogether) {
          props.push('"keepTogether":true');
      }
      return props;
  }

  // Final method to get the full JSON string for the element
  toJsonString(): string {
      const props = this.buildJsonProps();
      return "{" + props.join(",") + "}";
  }
}

// @ts-ignore: decorator is valid - REMOVED @json
export class TextElement extends LayoutElement {
  content: string = "";
  variant: string | null = null;

  constructor(content: string, variant: string | null = null) {
    super("Text");
    this.content = content;
    this.variant = variant;
  }

  // Override to add specific properties
  protected buildJsonProps(): string[] {
    let props = super.buildJsonProps(); // Get base properties
    props.push('"content":"' + escapeJsonString(this.content) + '"');
    if (this.variant !== null) {
        props.push('"variant":"' + escapeJsonString(this.variant!) + '"');
    }
    return props;
  }
}

// @ts-ignore: decorator is valid - REMOVED @json
export class ImageElement extends LayoutElement {
  src: string = "";
  alt: string | null = null;

  constructor(src: string, alt: string | null = null) {
    super("Image");
    this.src = src;
    this.alt = alt;
  }

   protected buildJsonProps(): string[] {
    let props = super.buildJsonProps();
    props.push('"src":"' + escapeJsonString(this.src) + '"');
     if (this.alt !== null) {
        props.push('"alt":"' + escapeJsonString(this.alt!) + '"');
    }
    return props;
  }
}

// @ts-ignore: decorator is valid - REMOVED @json
export class ColumnElement extends LayoutElement {
  children: Array<LayoutElement> = [];
  span: i32 = 0;

  constructor(children: Array<LayoutElement> = [], span: i32 = 0) {
    super("Column");
    this.children = children;
    this.span = span;
  }

   protected buildJsonProps(): string[] {
    let props = super.buildJsonProps();
    if (this.span != 0) {
        props.push('"span":' + this.span.toString());
    }
    if (this.children.length > 0) {
        let childrenJson: string[] = [];
        for (let i = 0; i < this.children.length; i++) {
            childrenJson.push(this.children[i].toJsonString());
        }
        props.push('"children":[' + childrenJson.join(",") + ']');
    }
    return props;
  }
}

// @ts-ignore: decorator is valid - REMOVED @json
export class RowElement extends LayoutElement {
  // Row children MUST be ColumnElements according to host definition
  children: Array<ColumnElement> = [];

  constructor(children: Array<ColumnElement> = []) {
    super("Row");
    this.children = children;
  }

   protected buildJsonProps(): string[] {
    let props = super.buildJsonProps();
    if (this.children.length > 0) {
        let childrenJson: string[] = [];
        // Children are ColumnElements, call their toJsonString
        for (let i = 0; i < this.children.length; i++) {
            childrenJson.push(this.children[i].toJsonString());
        }
        props.push('"children":[' + childrenJson.join(",") + ']');
    }
    return props;
  }
}

// @ts-ignore: decorator is valid - REMOVED @json
export class SectionElement extends LayoutElement {
  // Section children can be any LayoutElement (e.g., RowElement, TextElement)
  children: Array<LayoutElement> = [];

  constructor(children: Array<LayoutElement> = []) {
    super("Section");
    this.children = children;
  }

   protected buildJsonProps(): string[] {
    let props = super.buildJsonProps();
    if (this.children.length > 0) {
        let childrenJson: string[] = [];
        for (let i = 0; i < this.children.length; i++) {
            childrenJson.push(this.children[i].toJsonString());
        }
        props.push('"children":[' + childrenJson.join(",") + ']');
    }
    return props;
  }
}

// GlobalStyles might be complex to represent directly.
// For simplicity, we might omit it or use a simpler structure initially.
// Example: A Map for variables and classes. BaseElementStyles are harder.
// @ts-ignore: decorator is valid - REMOVED @json
export class SimpleGlobalStyles {
    // NOTE: This is a simplified version of the host's `GlobalStyles`.
    variables: Map<string, string> | null = null;

    toJsonString(): string {
        let props: string[] = [];
        if (this.variables !== null && this.variables!.size > 0) {
            let varProps: string[] = [];
            const keys = this.variables!.keys();
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const value = this.variables!.get(key);
                varProps.push('"' + escapeJsonString(key) + '":"' + escapeJsonString(value) + '"');
            }
            props.push('"variables":{' + varProps.join(",") + '}');
        }
        // Add serialization for classes, baseElementStyles if implemented

        if (props.length == 0) {
            return "{}";
        }
        return "{" + props.join(",") + "}";
    }
}

// @ts-ignore: decorator is valid - REMOVED @json
export class DocumentElement extends LayoutElement {
  children: Array<LayoutElement> = [];
  globalStyles: SimpleGlobalStyles | null = null;

  constructor(children: Array<LayoutElement> = []) {
    super("Document");
    this.children = children;
    this.globalStyles = null; // Explicitly null initially
  }

   protected buildJsonProps(): string[] {
    // Document doesn't call super.buildJsonProps() because it's the root
    let props: string[] = [];
    props.push('"type":"Document"'); // Type is mandatory

    if (this.id !== null) { // Add ID if present
        props.push('"id":"' + escapeJsonString(this.id!) + '"');
    }
    // Document doesn't typically have style, pageBreakBefore, keepTogether at the root

    if (this.children.length > 0) {
        let childrenJson: string[] = [];
        for (let i = 0; i < this.children.length; i++) {
            childrenJson.push(this.children[i].toJsonString());
        }
        props.push('"children":[' + childrenJson.join(",") + ']');
    } else {
        props.push('"children":[]'); // Ensure children array is always present
    }

    if (this.globalStyles !== null) {
        const stylesJson = this.globalStyles!.toJsonString();
        if (stylesJson != "{}") {
            props.push('"globalStyles":' + stylesJson);
        }
    }
    return props; // Return props array for the final toJsonString method
  }

   // Override the final toJsonString for DocumentElement
   toJsonString(): string {
       const props = this.buildJsonProps();
       return "{" + props.join(",") + "}";
   }
}

// --- Host Function Imports ---
// Define the functions expected from the host environment using `@external`.
// The names ("env", "log") and signatures must exactly match the host implementation.

// @ts-ignore: decorator
@external("env", "log") // Imports the 'log' function from the 'env' module provided by the host
export declare function log(message: string): void;

// Add declarations for other host functions if defined (e.g., formatCurrency)
