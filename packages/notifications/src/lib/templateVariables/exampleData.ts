import { templateVariableRegistry } from "./registry";

export function getFlatTemplateExampleData(
  templateName: string,
): Record<string, string> {
  const entry = templateVariableRegistry[templateName];
  if (!entry) return {};

  return Object.fromEntries(
    entry.variables.map((variable) => [variable.path, variable.example]),
  );
}

export function getNestedTemplateExampleData(
  templateName: string,
): Record<string, unknown> {
  const entry = templateVariableRegistry[templateName];
  if (!entry) return {};

  const result: Record<string, unknown> = {};
  for (const variable of entry.variables) {
    const parts = variable.path.replace(/\[\]/g, "").split(".");
    let cursor = result;
    parts.forEach((part, index) => {
      if (part === "this") return;
      if (index === parts.length - 1) {
        cursor[part] =
          variable.type === "array"
            ? [{}]
            : variable.type === "number"
              ? Number(variable.example.replace(/[^0-9.-]/g, "")) || 1
              : variable.type === "boolean"
                ? variable.example === "true"
                : variable.example;
        return;
      }
      if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
      const next = cursor[part];
      cursor = (Array.isArray(next) ? next[0] : next) as Record<
        string,
        unknown
      >;
    });
  }
  return result;
}
