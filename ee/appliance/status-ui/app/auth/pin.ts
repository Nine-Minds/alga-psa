// Pure helpers for the one-time-token PIN entry. Kept free of React so the
// distribution/assembly logic can be unit-tested directly.

export const TOKEN_GROUPS = [4, 4, 4, 4, 4];
export const TOKEN_DIGIT_COUNT = TOKEN_GROUPS.reduce((sum, size) => sum + size, 0); // 20

export function onlyDigits(value: string): string {
  return (value || '').replace(/\D+/g, '');
}

// Distribute typed/pasted digits across the fixed-width boxes starting at
// `startIndex`. Non-digits are ignored; overflow is dropped.
export function fillFrom(current: string[], startIndex: number, incoming: string): string[] {
  const digits = onlyDigits(incoming);
  const next = current.slice();
  let cursor = startIndex;
  for (const digit of digits) {
    if (cursor >= TOKEN_DIGIT_COUNT) break;
    next[cursor] = digit;
    cursor += 1;
  }
  return next;
}

// The index of the first empty box at or after `from`, or the last box if full.
export function nextEmptyIndex(boxes: string[], from = 0): number {
  for (let i = Math.max(0, from); i < TOKEN_DIGIT_COUNT; i += 1) {
    if (!/\d/.test(boxes[i] || '')) return i;
  }
  return TOKEN_DIGIT_COUNT - 1;
}

// Join the boxes into the canonical 5x4 dashed token, e.g. 4817-2039-6152-...
export function assembleToken(boxes: string[]): string {
  const digits = onlyDigits(boxes.join('')).slice(0, TOKEN_DIGIT_COUNT);
  const groups: string[] = [];
  let pos = 0;
  for (const size of TOKEN_GROUPS) {
    groups.push(digits.slice(pos, pos + size));
    pos += size;
  }
  return groups.join('-');
}

export function isComplete(boxes: string[]): boolean {
  return onlyDigits(boxes.join('')).length === TOKEN_DIGIT_COUNT;
}

export function emptyBoxes(): string[] {
  return Array.from({ length: TOKEN_DIGIT_COUNT }, () => '');
}
