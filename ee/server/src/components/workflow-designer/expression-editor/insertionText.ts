export const SNIPPET_CURSOR_PLACEHOLDER = '$0';

export const normalizeInsertedText = (value: string): string =>
  value.endsWith(SNIPPET_CURSOR_PLACEHOLDER)
    ? value.slice(0, -SNIPPET_CURSOR_PLACEHOLDER.length)
    : value;
