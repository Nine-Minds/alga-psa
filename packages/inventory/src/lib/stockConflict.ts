/**
 * Serializable stock-conflict result returned by material server actions when
 * recordStockConsumption refuses an add (B1). Pure types + guard — no imports, safe for
 * client components. Thrown error messages do not cross the server-action boundary, so
 * dialogs branch on this payload instead.
 */
export interface StockConflictResult {
  stockConflict: {
    /** 'reserved' is overrideable; 'held' and 'on_hand' never are. */
    reason: 'on_hand' | 'held' | 'reserved';
    overrideable: boolean;
    /** on_hand - reserved - held at the consumed location (may be negative). */
    free: number;
    onHand: number;
    reserved: number;
    held: number;
    requested: number;
    /** English fallback copy; dialogs localize from the numeric fields. */
    message: string;
  };
}

export function isStockConflictResult(value: unknown): value is StockConflictResult {
  const c = (value as { stockConflict?: unknown } | null)?.stockConflict;
  return typeof value === 'object' && value !== null && typeof c === 'object' && c !== null
    && typeof (c as { reason?: unknown }).reason === 'string';
}
