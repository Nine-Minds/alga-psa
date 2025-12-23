const REDACTED = '[REDACTED]';
const SECRET_REDACTED = '[SECRET:REDACTED]';

/**
 * Mask secret references in a value.
 * Handles both old-style { secretRef: "..." } and new-style { $secret: "..." } references.
 *
 * @param value - The value to process
 * @returns The value with secret references masked
 */
export function maskSecretRefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSecretRefs);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Check for new-style $secret reference: { $secret: "SECRET_NAME" }
    if ('$secret' in obj && typeof obj.$secret === 'string') {
      return { $secret: SECRET_REDACTED };
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      // Handle old-style secretRef key
      if (key === 'secretRef') {
        result[key] = REDACTED;
      } else {
        result[key] = maskSecretRefs(val);
      }
    }
    return result;
  }
  return value;
}

/**
 * Mask resolved secret values in the output.
 * This is used after secrets have been resolved to their actual values.
 *
 * @param value - The value to process
 * @param secretPaths - JSON Pointer paths to resolved secrets (e.g., "/apiKey", "/config/password")
 * @returns The value with secret values masked at the specified paths
 */
export function maskResolvedSecrets(value: unknown, secretPaths: string[]): unknown {
  if (!secretPaths || secretPaths.length === 0) {
    return value;
  }

  let result = value;
  for (const pointer of secretPaths) {
    result = applyJsonPointerRedaction(result, pointer);
  }
  return result;
}

export function applyRedactions(value: unknown, redactions: string[] = []): unknown {
  let result = maskSecretRefs(value);
  for (const pointer of redactions) {
    result = applyJsonPointerRedaction(result, pointer);
  }
  return result;
}

function applyJsonPointerRedaction(value: unknown, pointer: string): unknown {
  if (!pointer || pointer === '/' || pointer === '#') {
    return REDACTED;
  }
  const parts = pointer
    .replace(/^#?\//, '')
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .filter((part) => part.length > 0);

  if (!parts.length) {
    return REDACTED;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const cloned = Array.isArray(value) ? [...value] : { ...(value as Record<string, unknown>) };
  let cursor: any = cloned;

  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i];
    const isLast = i === parts.length - 1;
    if (cursor == null) {
      return cloned;
    }
    if (isLast) {
      if (Array.isArray(cursor)) {
        const index = Number(key);
        if (!Number.isNaN(index) && index >= 0 && index < cursor.length) {
          cursor[index] = REDACTED;
        }
      } else if (typeof cursor === 'object') {
        cursor[key] = REDACTED;
      }
    } else {
      cursor = cursor[key];
    }
  }

  return cloned;
}

export function safeSerialize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function enforceSnapshotSize<T>(value: T, maxBytes: number): T | { truncated: true; size: number; max: number } {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxBytes) {
    return value;
  }
  return {
    truncated: true,
    size: serialized.length,
    max: maxBytes
  } as { truncated: true; size: number; max: number };
}
