export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

export function requireObject(value: unknown, fieldName = 'body'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InputValidationError(`${fieldName} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function parseJsonInteger(value: unknown, fieldName: string): bigint {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  throw new InputValidationError(
    `${fieldName} must be a safe integer number or integer string`,
  );
}

export function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InputValidationError(`${fieldName} is required`);
  }
  return value.trim();
}
