// iPads show a full keyboard regardless of keyboardType, so quantity-style
// fields sanitize their own input.

/** Whole quantities: digits only. */
export function sanitizeQuantityInput(text: string): string {
  return text.replace(/[^0-9]/g, "");
}

/** Signed whole quantities (adjustments): optional leading minus, then digits. */
export function sanitizeSignedQuantityInput(text: string): string {
  const negative = text.trimStart().startsWith("-");
  const digits = text.replace(/[^0-9]/g, "");
  return negative ? `-${digits}` : digits;
}

/** Money-ish input: digits with at most one decimal separator. */
export function sanitizeDecimalInput(text: string): string {
  const normalized = text.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const [head, ...rest] = normalized.split(".");
  return rest.length > 0 ? `${head}.${rest.join("")}` : head;
}
