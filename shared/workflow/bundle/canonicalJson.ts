type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export const canonicalizeJsonValue = (value: unknown): JsonValue => {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value as JsonPrimitive;
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (!isPlainObject(value)) {
    throw new Error('canonicalizeJsonValue expected only JSON-compatible values (plain objects / arrays / primitives).');
  }

  const out: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out[key] = canonicalizeJsonValue(v);
  }
  return out;
};

export const stringifyCanonicalJson = (value: unknown): string => {
  const canonical = canonicalizeJsonValue(value);
  return `${JSON.stringify(canonical, null, 2)}\n`;
};

