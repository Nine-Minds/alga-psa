/**
 * Synthesize a sample value from a JSON schema.
 *
 * Used by the simulator to fabricate schema-shaped action outputs and by the
 * simulate endpoint to synthesize a trigger payload when the caller omits one.
 * Values are deliberately obvious placeholders — the simulation trace marks
 * everything derived from them as stubbed.
 */

type JsonSchemaNode = Record<string, unknown>;

const MAX_DEPTH = 12;

export function buildSampleFromJsonSchema(schema: Record<string, unknown>): unknown {
  return sampleNode(schema, schema, 0, new Set());
}

function sampleNode(node: unknown, root: JsonSchemaNode, depth: number, seenRefs: Set<string>): unknown {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') {
    return null;
  }
  const schema = node as JsonSchemaNode;

  if (typeof schema.$ref === 'string') {
    if (seenRefs.has(schema.$ref)) return null;
    const resolved = resolveLocalRef(schema.$ref, root);
    if (resolved) {
      const nextSeen = new Set(seenRefs);
      nextSeen.add(schema.$ref);
      return sampleNode(resolved, root, depth + 1, nextSeen);
    }
    return null;
  }

  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];

  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const variants = schema[key];
    if (Array.isArray(variants) && variants.length > 0) {
      if (key === 'allOf') {
        // Merge object variants shallowly; good enough for sample synthesis.
        const merged: Record<string, unknown> = {};
        for (const variant of variants) {
          const sample = sampleNode(variant, root, depth + 1, seenRefs);
          if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
            Object.assign(merged, sample);
          }
        }
        return merged;
      }
      const nonNull = variants.find((variant) => (variant as JsonSchemaNode)?.type !== 'null') ?? variants[0];
      return sampleNode(nonNull, root, depth + 1, seenRefs);
    }
  }

  const type = Array.isArray(schema.type)
    ? (schema.type.find((t) => t !== 'null') ?? schema.type[0])
    : schema.type;

  switch (type) {
    case 'object':
    case undefined: {
      const properties = schema.properties;
      const result: Record<string, unknown> = {};
      if (properties && typeof properties === 'object') {
        for (const [key, value] of Object.entries(properties as JsonSchemaNode)) {
          result[key] = sampleNode(value, root, depth + 1, seenRefs);
        }
      }
      return result;
    }
    case 'array': {
      const items = schema.items;
      if (items && typeof items === 'object' && !Array.isArray(items)) {
        return [sampleNode(items, root, depth + 1, seenRefs)];
      }
      return [];
    }
    case 'string':
      return sampleString(schema);
    case 'number':
    case 'integer':
      return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return null;
  }
}

function sampleString(schema: JsonSchemaNode): string {
  switch (schema.format) {
    case 'uuid':
      return '00000000-0000-0000-0000-000000000000';
    case 'date-time':
      return '2026-01-01T00:00:00.000Z';
    case 'date':
      return '2026-01-01';
    case 'email':
      return 'sample@example.com';
    case 'uri':
    case 'url':
      return 'https://example.com';
    default:
      return 'sample-string';
  }
}

function resolveLocalRef(ref: string, root: JsonSchemaNode): JsonSchemaNode | null {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return null;
  const parts = ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cursor: unknown = root;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as JsonSchemaNode)[part];
  }
  return cursor && typeof cursor === 'object' ? (cursor as JsonSchemaNode) : null;
}
