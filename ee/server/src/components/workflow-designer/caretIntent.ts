import { useMemo, useRef, type KeyboardEvent, type MutableRefObject } from 'react';

type CaretElement = Pick<HTMLInputElement | HTMLTextAreaElement, 'selectionStart' | 'selectionEnd'>;

// Keys that move focus or only modify other keys; they don't place the caret.
const NON_PLACING_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape', 'CapsLock']);

/**
 * Tracks whether the caret in a text box sits where the author put it. Inserting a field goes to a
 * deliberately placed caret (after typing, arrow keys, Home/End, or a click once the box has focus);
 * otherwise it goes at the end of the text. The click that focuses the box, and keyboard focus, do
 * not count: they leave the caret wherever the browser put it.
 */
export const createCaretIntent = () => {
  let deliberate = false;
  let focusing = false;
  return {
    onFocus() {
      focusing = true;
      deliberate = false;
    },
    onMouseUp(element: CaretElement | null) {
      if (focusing) {
        focusing = false;
        // Dragging a selection while focusing is deliberate; a plain focusing click is not.
        deliberate = Boolean(element && element.selectionStart !== element.selectionEnd);
        return;
      }
      deliberate = true;
    },
    onKeyDown(key: string) {
      if (NON_PLACING_KEYS.has(key)) return;
      focusing = false;
      deliberate = true;
    },
    /** After an insert, the caret sits after the inserted field, which the next insert continues from. */
    onInserted() {
      deliberate = true;
    },
    /** Where an insert goes: the author's caret or selection, or the end of the text. */
    insertionRange(element: CaretElement | null, textLength: number): { start: number; end: number } {
      if (!deliberate || !element || element.selectionStart === null || element.selectionEnd === null) {
        return { start: textLength, end: textLength };
      }
      return { start: element.selectionStart, end: element.selectionEnd };
    },
  };
};

export type CaretIntent = ReturnType<typeof createCaretIntent>;

/** A caret intent for one text box, plus the event handlers to spread on it. */
export const useCaretIntent = <T extends HTMLInputElement | HTMLTextAreaElement>(
  elementRef: MutableRefObject<T | null>
) => {
  const intentRef = useRef<CaretIntent | null>(null);
  if (!intentRef.current) intentRef.current = createCaretIntent();
  const intent = intentRef.current;
  const handlers = useMemo(
    () => ({
      onFocus: () => intent.onFocus(),
      onMouseUp: () => intent.onMouseUp(elementRef.current),
      onKeyDown: (event: KeyboardEvent) => intent.onKeyDown(event.key),
    }),
    [elementRef, intent]
  );
  return { intent, handlers };
};
