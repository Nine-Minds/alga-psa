import {
    DocumentElement, LayoutElement, ElementStyle,
    TextElement, ImageElement, ColumnElement, RowElement, SectionElement, SimpleGlobalStyles
} from "../types"; // Adjust path as needed

// --- JSON String Escaping ---
// Basic escaping for control characters and quotes/backslashes.
// Note: This is a simplified version and might not cover all edge cases (e.g., Unicode).
function escapeString(str: string): string {
    let result = "";
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        switch (char) {
            case 34: // "
                result += '\\"';
                break;
            case 92: // \
                result += '\\\\';
                break;
            case 8: // \b
                result += '\\b';
                break;
            case 12: // \f
                result += '\\f';
                break;
            case 10: // \n
                result += '\\n';
                break;
            case 13: // \r
                result += '\\r';
                break;
            case 9: // \t
                result += '\\t';
                break;
            default:
                // Basic check for control characters (0-31)
                if (char < 32) {
                    // Represent as \uXXXX - More robust handling might be needed
                    // For simplicity, we might skip them or use a placeholder if they are not expected.
                    // Let's skip them for now, assuming clean input strings.
                    // result += "\\u" + char.toString(16).padStart(4, "0");
                } else {
                    result += String.fromCharCode(char);
                }
        }
    }
    return result;
}


// --- Value Serialization ---
function serializeValue(value: any): string {
    if (value == null) {
        return "null";
    } else if (isString(value)) {
        // Ensure it's treated as a string before escaping
        const strValue = value as string;
        return '"' + escapeString(strValue) + '"';
    } else if (isBoolean(value)) {
        return value ? "true" : "false";
    } else if (isFloat(value) || isInteger(value)) {
        // Check for NaN and Infinity which are not valid JSON numbers
        const numValue = value as number; // Assuming f64 or similar maps to number
        if (isNaN(numValue) || !isFinite(numValue)) {
            return "null"; // Or throw an error, depending on desired behavior
        }
        return numValue.toString();
    } else if (isArray(value)) {
        return serializeArray(value as Array<any>);
    } else if (isObject(value)) {
        // Check if it's a known LayoutElement or ElementStyle
        if (value instanceof LayoutElement) {
             return serializeLayoutElement(value as LayoutElement);
        } else if (value instanceof ElementStyle) {
             return serializeStyle(value as ElementStyle);
        } else if (value instanceof SimpleGlobalStyles) {
             return serializeGlobalStyles(value as SimpleGlobalStyles);
        }
        // Fallback for generic objects (might be limited in AS)
        // This part is tricky without reflection. We rely on specific type checks above.
        // If we hit this, it's likely an unsupported type or requires specific handling.
        // For now, return empty object as a placeholder.
        // Consider logging an error here in debug builds.
        // log("Warning: Attempting to serialize unknown object type.");
        return "{}";
    }
    // Default case for unsupported types
    return "null";
}

// --- Array Serialization ---
function serializeArray(arr: Array<any>): string {
    let result = "[";
    for (let i = 0; i < arr.length; i++) {
        result += serializeValue(arr[i]);
        if (i < arr.length - 1) {
            result += ",";
        }
    }
    result += "]";
    return result;
}

// --- Object Serialization (Generic - Limited Use in AS) ---
// This is a basic object serializer. It relies on the object having a structure
// that can be iterated or known properties. In AS, we mostly rely on specific
// serializers like serializeStyle or serializeLayoutElement.
function serializeObject(obj: any): string {
    // This is problematic in AS without reflection or specific knowledge of the object's structure.
    // We will primarily use the specific serializers below.
    // Returning a placeholder or throwing an error might be appropriate.
    return "{}"; // Placeholder
}


// --- Specific Serializers ---

function serializeStyle(style: ElementStyle): string {
    let result = "{";
    let firstProp = true;

    // Helper to add property if value is not null/default
    function addProp(key: string, value: any, isDefault: boolean = false): void {
        if (value !== null && !isDefault) {
            if (!firstProp) {
                result += ",";
            }
            result += '"' + key + '":' + serializeValue(value);
            firstProp = false;
        }
    }

    addProp("width", style.width);
    addProp("height", style.height);
    addProp("padding", style.padding);
    addProp("paddingTop", style.paddingTop);
    addProp("paddingRight", style.paddingRight);
    addProp("paddingBottom", style.paddingBottom);
    addProp("paddingLeft", style.paddingLeft);
    addProp("margin", style.margin);
    addProp("marginTop", style.marginTop);
    addProp("marginRight", style.marginRight);
    addProp("marginBottom", style.marginBottom);
    addProp("marginLeft", style.marginLeft);
    addProp("border", style.border);
    addProp("borderTop", style.borderTop);
    addProp("borderRight", style.borderRight);
    addProp("borderBottom", style.borderBottom);
    addProp("borderLeft", style.borderLeft);
    addProp("borderRadius", style.borderRadius);
    addProp("flexGrow", style.flexGrow, style.flexGrow == 0); // Default is 0
    addProp("flexShrink", style.flexShrink, style.flexShrink == 0); // Default is 0
    addProp("flexBasis", style.flexBasis);
    addProp("alignSelf", style.alignSelf);
    addProp("fontSize", style.fontSize);
    addProp("fontWeight", style.fontWeight);
    addProp("fontFamily", style.fontFamily);
    addProp("textAlign", style.textAlign);
    addProp("lineHeight", style.lineHeight);
    addProp("color", style.color);
    addProp("backgroundColor", style.backgroundColor);
    addProp("borderColor", style.borderColor);
    addProp("borderWidth", style.borderWidth);
    addProp("borderTopWidth", style.borderTopWidth);
    addProp("borderRightWidth", style.borderRightWidth);
    addProp("borderBottomWidth", style.borderBottomWidth);
    addProp("borderLeftWidth", style.borderLeftWidth);
    addProp("borderStyle", style.borderStyle);
    addProp("borderTopStyle", style.borderTopStyle);
    addProp("borderRightStyle", style.borderRightStyle);
    addProp("borderBottomStyle", style.borderBottomStyle);
    addProp("borderLeftStyle", style.borderLeftStyle);
    addProp("borderTopColor", style.borderTopColor);
    addProp("borderRightColor", style.borderRightColor);
    addProp("borderBottomColor", style.borderBottomColor);
    addProp("borderLeftColor", style.borderLeftColor);

    result += "}";
    // Return "null" if the style object resulted in empty JSON "{}" ?
    // No, the host expects an empty object if style is present but has no non-default values.
    return result;
}

function serializeGlobalStyles(styles: SimpleGlobalStyles): string {
     let result = "{";
     let firstProp = true;

     // Serialize variables (Map<string, string>)
     if (styles.variables !== null && styles.variables!.size > 0) {
         if (!firstProp) { result += ","; }
         result += '"variables":{';
         let firstVar = true;
         const keys = styles.variables!.keys();
         for (let i = 0; i < keys.length; i++) {
             const key = keys[i];
             const value = styles.variables!.get(key);
             if (!firstVar) { result += ","; }
             result += serializeValue(key) + ":" + serializeValue(value);
             firstVar = false;
         }
         result += '}';
         firstProp = false;
     }

     // Add other global style parts here if implemented (classes, baseElementStyles)

     result += "}";
     return result;
}


function serializeLayoutElement(element: LayoutElement): string {
    let result = "{";
    let firstProp = true;

    // Helper to add property
    function addProp(key: string, value: any, isDefault: boolean = false): void {
         // Check for null or default boolean value
        if (value !== null && !(isBoolean(value) && value === isDefault)) {
            if (!firstProp) {
                result += ",";
            }
            result += '"' + key + '":' + serializeValue(value);
            firstProp = false;
        }
    }

    // Common properties
    addProp("type", element.type);
    addProp("id", element.id);
    if (element.style !== null) {
        const styleJson = serializeStyle(element.style!);
        // Only add style if it's not empty braces, unless specifically required
        if (styleJson != "{}") {
             addProp("style", styleJson); // Add raw style JSON string, not as escaped string
             // Need to adjust addProp or handle this case separately
             if (!firstProp) { result += ","; } // Add comma if needed
             result += '"style":' + styleJson; // Append directly
             firstProp = false; // Mark that a property was added
        }
    }
    addProp("pageBreakBefore", element.pageBreakBefore, false); // Default is false
    addProp("keepTogether", element.keepTogether, false); // Default is false


    // Type-specific properties
    if (element instanceof TextElement) {
        const textElement = element as TextElement;
        addProp("content", textElement.content);
        addProp("variant", textElement.variant);
    } else if (element instanceof ImageElement) {
        const imageElement = element as ImageElement;
        addProp("src", imageElement.src);
        addProp("alt", imageElement.alt);
    } else if (element instanceof ColumnElement) {
        const columnElement = element as ColumnElement;
        addProp("span", columnElement.span, columnElement.span == 0); // Default is 0
        // Children need special handling for array serialization
        if (columnElement.children.length > 0) {
             if (!firstProp) { result += ","; }
             result += '"children":' + serializeArray(columnElement.children);
             firstProp = false;
        }
    } else if (element instanceof RowElement) {
        const rowElement = element as RowElement;
        if (rowElement.children.length > 0) {
             if (!firstProp) { result += ","; }
             result += '"children":' + serializeArray(rowElement.children);
             firstProp = false;
        }
    } else if (element instanceof SectionElement) {
        const sectionElement = element as SectionElement;
        if (sectionElement.children.length > 0) {
             if (!firstProp) { result += ","; }
             result += '"children":' + serializeArray(sectionElement.children);
             firstProp = false;
        }
    } else if (element instanceof DocumentElement) {
        const documentElement = element as DocumentElement;
         if (documentElement.children.length > 0) {
             if (!firstProp) { result += ","; }
             result += '"children":' + serializeArray(documentElement.children);
             firstProp = false;
         }
         if (documentElement.globalStyles !== null) {
             const globalStylesJson = serializeGlobalStyles(documentElement.globalStyles!);
             if (globalStylesJson != "{}") {
                 if (!firstProp) { result += ","; }
                 result += '"globalStyles":' + globalStylesJson;
                 firstProp = false;
             }
         }
    }
    // Add other element types here...

    result += "}";
    return result;
}


// --- Main Exported Function ---
export function serializeDocument(doc: DocumentElement): string {
    // The top-level element is always a DocumentElement, which is a LayoutElement.
    // We can directly use serializeLayoutElement.
    return serializeLayoutElement(doc);
}