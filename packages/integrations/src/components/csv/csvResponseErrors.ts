export function getCsvResponseErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') {
    return fallback;
  }

  const record = body as Record<string, unknown>;

  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message;
  }

  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error;
  }

  if (record.error && typeof record.error === 'object') {
    const nestedError = record.error as Record<string, unknown>;
    if (typeof nestedError.message === 'string' && nestedError.message.trim()) {
      return nestedError.message;
    }
  }

  return fallback;
}
