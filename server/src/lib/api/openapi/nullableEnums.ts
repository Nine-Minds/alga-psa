/**
 * zod-to-openapi's OpenApiGeneratorV31 turns `z.enum([...]).nullable()` into
 * `{ "type": ["string", "null"], "enum": [...] }` without `null` in `enum`. Under
 * JSON Schema 2020-12 `enum` constrains every instance regardless of `type`, so a real
 * `null` value fails validation. This pass appends `null` to such enums.
 *
 * Pure (returns a new tree, input untouched) and idempotent. It walks every object and
 * array in the document, so schemas under components, paths, parameters, and any
 * nested keyword (properties, items, anyOf/oneOf/allOf, additionalProperties, ...) are covered.
 */
// LEVERAGE: friction zod-openapi-v31-nullable-enum — generator output needs a post-pass to be valid JSON Schema
export function includeNullInNullableEnums<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((item) => includeNullInNullableEnums(item)) as unknown as T;
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = includeNullInNullableEnums(value);
  }

  const nullableByType = Array.isArray(out.type) && (out.type as unknown[]).includes('null');
  const nullableByFlag = out.nullable === true; // OpenAPI 3.0 style
  if ((nullableByType || nullableByFlag) && Array.isArray(out.enum) && !out.enum.includes(null)) {
    out.enum = [...out.enum, null];
  }
  return out as T;
}
