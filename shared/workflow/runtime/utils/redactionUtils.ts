const REDACTED = '[REDACTED]';

export function maskSecretRefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSecretRefs);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
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
