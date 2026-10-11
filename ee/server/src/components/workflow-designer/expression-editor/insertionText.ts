export const SNIPPET_CURSOR_PLACEHOLDER = '$0';

export const normalizeInsertedText = (value: string): string =>
  value.endsWith(SNIPPET_CURSOR_PLACEHOLDER)
    ? value.slice(0, -SNIPPET_CURSOR_PLACEHOLDER.length)
    : value;

const PARTIAL_PATH_BEFORE_CARET = /[A-Za-z_$][A-Za-z0-9_$.]*$/;

/**
 * Where an inserted field path should start. When the text before the caret ends with a partly
 * typed path that the inserted path completes ("vars.ticket.pri" + "vars.ticket.priority_id"),
 * the partial path is replaced rather than duplicated.
 */
export const getPathInsertionStart = (textBeforeCaret: string, insertedText: string): number => {
  const match = PARTIAL_PATH_BEFORE_CARET.exec(textBeforeCaret);
  if (!match) return textBeforeCaret.length;
  return insertedText.startsWith(match[0]) ? textBeforeCaret.length - match[0].length : textBeforeCaret.length;
};
