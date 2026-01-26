import { generateKeyBetween } from 'fractional-indexing';

/**
 * Utility functions for fractional indexing / ordering
 */
export function generateInitialKeys(count: number): string[] {
  const keys: string[] = [];
  let lastKey: string | null = null;

  for (let i = 0; i < count; i++) {
    const newKey = generateKeyBetween(lastKey, null);
    keys.push(newKey);
    lastKey = newKey;
  }

  return keys;
}

export function generateKeyForPosition(beforeKey: string | null | undefined, afterKey: string | null | undefined): string {
  const normalizedBeforeKey = beforeKey === undefined ? null : beforeKey;
  const normalizedAfterKey = afterKey === undefined ? null : afterKey;

  if (normalizedBeforeKey && normalizedAfterKey) {
    if (normalizedBeforeKey >= normalizedAfterKey) {
      console.error('Invalid key order: beforeKey must be less than afterKey', {
        beforeKey: normalizedBeforeKey,
        afterKey: normalizedAfterKey,
      });
      throw new Error(
        `Invalid key order: beforeKey (${normalizedBeforeKey}) must be less than afterKey (${normalizedAfterKey})`,
      );
    }
  }

  if (normalizedBeforeKey && normalizedAfterKey && normalizedBeforeKey === normalizedAfterKey) {
    console.error('Identical keys provided', { beforeKey: normalizedBeforeKey, afterKey: normalizedAfterKey });
    throw new Error('Cannot generate key between identical keys');
  }

  try {
    const newKey = generateKeyBetween(normalizedBeforeKey, normalizedAfterKey);
    console.log('Generated new key:', newKey, 'for position between', normalizedBeforeKey, 'and', normalizedAfterKey);
    return newKey;
  } catch (error) {
    console.error('Error generating key between:', {
      beforeKey: normalizedBeforeKey,
      afterKey: normalizedAfterKey,
      error,
    });
    throw error;
  }
}

// Namespace export for backward compatibility
export const OrderingService = {
  generateInitialKeys,
  generateKeyForPosition,
};
