export type NormalizedClientType = 'company' | 'individual';

export class InvalidClientTypeError extends Error {
  constructor(value: unknown) {
    super(`client_type must be 'company' or 'individual' (received ${String(value)})`);
    this.name = 'InvalidClientTypeError';
  }
}

export function normalizeClientType(value: unknown): NormalizedClientType {
  if (value === null || value === undefined) {
    return 'company';
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '') {
      return 'company';
    }
    if (normalized === 'company' || normalized === 'individual') {
      return normalized;
    }
  }

  throw new InvalidClientTypeError(value);
}
