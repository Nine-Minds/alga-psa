export type JsonSchemaReferenceRoot = {
  definitions?: Record<string, unknown>;
  $defs?: Record<string, unknown>;
  [key: string]: unknown;
};

const decodeJsonPointerSegment = (segment: string): string =>
  segment.replace(/~1/g, '/').replace(/~0/g, '~');

export const resolveLocalJsonSchemaRef = <T extends object>(
  ref: string | undefined,
  root: T | undefined
): T | undefined => {
  if (!ref || !root) return undefined;

  if (ref === '#') return root;

  if (ref.startsWith('#/')) {
    const parts = ref.slice(2).split('/').map(decodeJsonPointerSegment);
    let current: unknown = root;

    for (const part of parts) {
      if (!current || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current && typeof current === 'object' ? (current as T) : undefined;
  }

  if (ref.startsWith('#/definitions/')) {
    const refKey = decodeJsonPointerSegment(ref.replace('#/definitions/', ''));
    const resolved = (root as JsonSchemaReferenceRoot).definitions?.[refKey];
    return resolved && typeof resolved === 'object' ? (resolved as T) : undefined;
  }

  if (ref.startsWith('#/$defs/')) {
    const refKey = decodeJsonPointerSegment(ref.replace('#/$defs/', ''));
    const resolved = (root as JsonSchemaReferenceRoot).$defs?.[refKey];
    return resolved && typeof resolved === 'object' ? (resolved as T) : undefined;
  }

  return undefined;
};
