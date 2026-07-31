export type BigintValue = bigint | string;

export function parseBigint(value: BigintValue, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  if (!/^-?\d+$/.test(value)) {
    throw new Error(`${fieldName} must be an integer string or bigint`);
  }

  return BigInt(value);
}

export function requireNonNegativeBigint(value: BigintValue, fieldName: string): bigint {
  const parsed = parseBigint(value, fieldName);
  if (parsed < 0n) {
    throw new Error(`${fieldName} must be non-negative`);
  }
  return parsed;
}

export function requirePositiveBigint(value: BigintValue, fieldName: string): bigint {
  const parsed = parseBigint(value, fieldName);
  if (parsed <= 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return parsed;
}

export function requireNonZeroBigint(value: BigintValue, fieldName: string): bigint {
  const parsed = parseBigint(value, fieldName);
  if (parsed === 0n) {
    throw new Error(`${fieldName} must not be zero`);
  }
  return parsed;
}
