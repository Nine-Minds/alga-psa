/**
 * Workflow-task form classifier.
 *
 * Operates purely on the form's domain data (JSON Schema + uiSchema) and is
 * independent of the v1 endpoint shape. A form is "simple" — and therefore
 * renderable by the minimal native form — when EVERY property is a basic field
 * (boolean / number / single-line string / single-select enum), there are no
 * nested objects or arrays, and the uiSchema declares no custom `ui:widget`.
 * Anything else falls back to the "Complete in web app" deep-link. No
 * partially-rendered forms.
 */

type JsonValue = Record<string, unknown>;

export type SimpleFieldKind = "boolean" | "number" | "enum" | "string";

export type SimpleFormField = {
  name: string;
  kind: SimpleFieldKind;
  title: string;
  description?: string;
  required: boolean;
  /** Present for `enum` fields. */
  options?: { value: string | number | boolean; label: string }[];
  defaultValue?: string | number | boolean;
};

// RJSF built-in widgets we can faithfully reproduce natively. Anything outside
// this set (alert, button-link, highlight, file, etc.) is treated as custom.
const SAFE_WIDGETS = new Set([
  "text",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "checkboxes",
  "updown",
  "number",
  "password",
  "email",
]);

const BASIC_TYPES = new Set(["boolean", "number", "integer", "string"]);

function isObject(value: unknown): value is JsonValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively reject any `ui:widget` that is not a known-safe widget. */
function uiSchemaHasCustomWidget(uiSchema: unknown): boolean {
  if (!isObject(uiSchema)) return false;
  for (const [key, value] of Object.entries(uiSchema)) {
    if (key === "ui:widget") {
      if (typeof value !== "string" || !SAFE_WIDGETS.has(value)) return true;
      continue;
    }
    if (isObject(value) && uiSchemaHasCustomWidget(value)) return true;
  }
  return false;
}

function propIsSimple(prop: unknown): boolean {
  if (!isObject(prop)) return false;
  // Nested object / array structures are out of scope for the native renderer.
  if ("properties" in prop || "items" in prop) return false;

  const type = prop.type;
  const hasEnum = Array.isArray(prop.enum) && prop.enum.length > 0;

  // Enum without an explicit type is still a single-select.
  if (type === undefined) return hasEnum;
  if (typeof type !== "string") return false;
  if (!BASIC_TYPES.has(type)) return false;
  if (type === "object" || type === "array") return false;
  return true;
}

export function isSimpleTaskForm(jsonSchema: unknown, uiSchema?: unknown): boolean {
  if (!isObject(jsonSchema)) return false;
  if (jsonSchema.type !== undefined && jsonSchema.type !== "object") return false;

  const properties = jsonSchema.properties;
  if (!isObject(properties)) return false;
  const propEntries = Object.entries(properties);
  if (propEntries.length === 0) return false;

  for (const [, prop] of propEntries) {
    if (!propIsSimple(prop)) return false;
  }

  if (uiSchemaHasCustomWidget(uiSchema)) return false;
  return true;
}

function asLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Extract the renderable fields for a form already classified as simple.
 * Returns an empty array for non-simple schemas.
 */
export function extractSimpleFields(jsonSchema: unknown, uiSchema?: unknown): SimpleFormField[] {
  if (!isSimpleTaskForm(jsonSchema, uiSchema)) return [];
  const schema = jsonSchema as JsonValue;
  const properties = schema.properties as JsonValue;
  const required = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const requiredSet = new Set(required);

  return Object.entries(properties).map(([name, raw]) => {
    const prop = raw as JsonValue;
    const enumValues = Array.isArray(prop.enum) ? (prop.enum as unknown[]) : null;
    const enumNames = Array.isArray(prop.enumNames) ? (prop.enumNames as unknown[]) : null;
    const type = typeof prop.type === "string" ? (prop.type as string) : undefined;

    let kind: SimpleFieldKind;
    if (enumValues) kind = "enum";
    else if (type === "boolean") kind = "boolean";
    else if (type === "number" || type === "integer") kind = "number";
    else kind = "string";

    const field: SimpleFormField = {
      name,
      kind,
      title: asLabel(prop.title) || name,
      description: typeof prop.description === "string" ? prop.description : undefined,
      required: requiredSet.has(name),
    };

    if (enumValues) {
      field.options = enumValues.map((value, index) => ({
        value: value as string | number | boolean,
        label: enumNames && enumNames[index] !== undefined ? asLabel(enumNames[index]) : asLabel(value),
      }));
    }

    if (
      prop.default !== undefined &&
      (typeof prop.default === "string" ||
        typeof prop.default === "number" ||
        typeof prop.default === "boolean")
    ) {
      field.defaultValue = prop.default;
    }

    return field;
  });
}
