/**
 * Undo / redo for a designer's draft: a past stack, the present, a future stack.
 * Pure and document-shaped, so a form, a dashboard or a report designer reuses it as-is.
 *
 * LEVERAGE: pattern designer-undo-history — the invoice designer keeps the same shape inside
 * its zustand store; this is the standalone copy a store-free designer uses.
 */
export interface DesignerHistory<TDocument> {
  past: TDocument[];
  present: TDocument;
  future: TDocument[];
}

/** How many undo steps are kept. Deep enough for a session, shallow enough to stay cheap. */
export const DESIGNER_HISTORY_LIMIT = 100;

export function createDesignerHistory<TDocument>(present: TDocument): DesignerHistory<TDocument> {
  return { past: [], present, future: [] };
}

/**
 * Records a new present. `coalesceId` merges consecutive edits of the same thing into one
 * undo step — typing a label is one step, not one per keystroke.
 */
export function pushDesignerHistory<TDocument>(
  history: DesignerHistory<TDocument>,
  next: TDocument,
  options?: { coalesceId?: string | null; lastCoalesceId?: string | null }
): DesignerHistory<TDocument> {
  if (Object.is(history.present, next)) {
    return history;
  }
  const coalesce =
    !!options?.coalesceId &&
    options.coalesceId === options.lastCoalesceId &&
    history.past.length > 0;

  if (coalesce) {
    return { past: history.past, present: next, future: [] };
  }

  const past = [...history.past, history.present];
  return {
    past: past.length > DESIGNER_HISTORY_LIMIT ? past.slice(past.length - DESIGNER_HISTORY_LIMIT) : past,
    present: next,
    future: [],
  };
}

export function canUndoDesignerHistory<TDocument>(history: DesignerHistory<TDocument>): boolean {
  return history.past.length > 0;
}

export function canRedoDesignerHistory<TDocument>(history: DesignerHistory<TDocument>): boolean {
  return history.future.length > 0;
}

export function undoDesignerHistory<TDocument>(
  history: DesignerHistory<TDocument>
): DesignerHistory<TDocument> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoDesignerHistory<TDocument>(
  history: DesignerHistory<TDocument>
): DesignerHistory<TDocument> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}
