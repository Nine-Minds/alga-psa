export type SharedInsertionNoopReason =
  | 'missing-target'
  | 'readonly'
  | 'disabled'
  | 'unfocused'
  | 'missing-selection'
  | 'missing-model';

export type SharedInsertionResult = {
  didInsert: boolean;
  nextValue: string;
  insertedText: string;
  selectionStart: number;
  selectionEnd: number;
  reason?: SharedInsertionNoopReason;
};

export type TextValueInsertionTarget = {
  value: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};

const asOffset = (value: number | null | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(fallback, Number(value)));
};

const createNoopResult = (
  target: Pick<TextValueInsertionTarget, 'value' | 'selectionStart' | 'selectionEnd'>,
  reason: SharedInsertionNoopReason
): SharedInsertionResult => {
  const valueLength = target.value.length;
  const selectionStart = asOffset(target.selectionStart, valueLength);
  const selectionEnd = asOffset(target.selectionEnd, valueLength);
  return {
    didInsert: false,
    nextValue: target.value,
    insertedText: '',
    selectionStart,
    selectionEnd,
    reason,
  };
};

export const insertTextIntoValue = (
  target: TextValueInsertionTarget,
  insertText: string
): SharedInsertionResult => {
  const baseValue = target.value ?? '';
  const safeInsertText = insertText ?? '';
  const valueLength = baseValue.length;
  const selectionStart = asOffset(target.selectionStart, valueLength);
  const selectionEnd = asOffset(target.selectionEnd, valueLength);
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const nextValue = `${baseValue.slice(0, start)}${safeInsertText}${baseValue.slice(end)}`;
  const nextCursor = start + safeInsertText.length;
  return {
    didInsert: true,
    nextValue,
    insertedText: safeInsertText,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
};

type SupportedDomInsertElement = HTMLInputElement | HTMLTextAreaElement;

const isSupportedInputType = (element: HTMLInputElement): boolean => {
  const textLikeTypes = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password']);
  return textLikeTypes.has(element.type);
};

const isSupportedDomInsertElement = (element: Element | null): element is SupportedDomInsertElement => {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return isSupportedInputType(element);
  }
  return false;
};

export type InsertIntoDomControlOptions = {
  requireFocus?: boolean;
};

export const insertTextIntoDomControl = (
  element: Element | null,
  insertText: string,
  options: InsertIntoDomControlOptions = {}
): SharedInsertionResult => {
  if (!isSupportedDomInsertElement(element)) {
    return createNoopResult({ value: '', selectionStart: 0, selectionEnd: 0 }, 'missing-target');
  }

  if (element.readOnly) {
    return createNoopResult(element, 'readonly');
  }

  if (element.disabled) {
    return createNoopResult(element, 'disabled');
  }

  if ((options.requireFocus ?? true) && typeof document !== 'undefined' && document.activeElement !== element) {
    return createNoopResult(element, 'unfocused');
  }

  const result = insertTextIntoValue(
    {
      value: element.value ?? '',
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
    },
    insertText
  );

  if (!result.didInsert) {
    return result;
  }

  element.value = result.nextValue;
  element.setSelectionRange(result.selectionStart, result.selectionEnd);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return result;
};

type MonacoPositionLike = {
  lineNumber: number;
  column: number;
};

type MonacoRangeLike = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

type MonacoSelectionLike = MonacoRangeLike;

type MonacoModelLike = {
  getValue: () => string;
  getOffsetAt: (position: MonacoPositionLike) => number;
  getPositionAt: (offset: number) => MonacoPositionLike;
};

type MonacoEditorLike = {
  getSelection: () => MonacoSelectionLike | null;
  getModel: () => MonacoModelLike | null;
  executeEdits: (
    source: string,
    edits: Array<{ range: MonacoRangeLike; text: string; forceMoveMarkers?: boolean }>
  ) => void;
  setSelection?: (selection: MonacoSelectionLike) => void;
  setPosition?: (position: MonacoPositionLike) => void;
  focus?: () => void;
  hasTextFocus?: () => boolean;
};

export type InsertIntoMonacoOptions = {
  requireFocus?: boolean;
  source?: string;
};

export const insertTextIntoMonacoEditor = (
  editor: MonacoEditorLike | null | undefined,
  insertText: string,
  options: InsertIntoMonacoOptions = {}
): SharedInsertionResult => {
  if (!editor) {
    return createNoopResult({ value: '', selectionStart: 0, selectionEnd: 0 }, 'missing-target');
  }

  if ((options.requireFocus ?? true) && editor.hasTextFocus && !editor.hasTextFocus()) {
    const model = editor.getModel();
    return createNoopResult(
      {
        value: model?.getValue() ?? '',
        selectionStart: 0,
        selectionEnd: 0,
      },
      'unfocused'
    );
  }

  const model = editor.getModel();
  if (!model) {
    return createNoopResult({ value: '', selectionStart: 0, selectionEnd: 0 }, 'missing-model');
  }

  const selection = editor.getSelection();
  if (!selection) {
    return createNoopResult({ value: model.getValue(), selectionStart: 0, selectionEnd: 0 }, 'missing-selection');
  }

  const currentValue = model.getValue();
  const startOffset = model.getOffsetAt({
    lineNumber: selection.startLineNumber,
    column: selection.startColumn,
  });
  const endOffset = model.getOffsetAt({
    lineNumber: selection.endLineNumber,
    column: selection.endColumn,
  });

  const result = insertTextIntoValue(
    {
      value: currentValue,
      selectionStart: startOffset,
      selectionEnd: endOffset,
    },
    insertText
  );

  editor.executeEdits(options.source ?? 'shared-expression-insertion', [
    {
      range: selection,
      text: insertText,
      forceMoveMarkers: true,
    },
  ]);

  const nextPosition = model.getPositionAt(result.selectionStart);
  editor.setPosition?.(nextPosition);
  editor.setSelection?.({
    startLineNumber: nextPosition.lineNumber,
    startColumn: nextPosition.column,
    endLineNumber: nextPosition.lineNumber,
    endColumn: nextPosition.column,
  });
  editor.focus?.();
  return result;
};
