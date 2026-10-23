/**
 * Which inputs are free text, and how they're edited. One decision for every action input: a free
 * text input always gets the Text editor (type text, Insert field, field chips, preview, Expand),
 * single- or multi-line. Editor metadata only chooses the size (a large-text dialog or a textarea
 * means multi-line); it never swaps Text mode for a plain box.
 */

export type WorkflowTextInputEditorLike = {
  kind?: string;
  inline?: { mode?: string };
  dialog?: { mode?: string };
  softEnum?: unknown;
};

export type WorkflowTextInputFieldLike = {
  name: string;
  type: string;
  enum?: ReadonlyArray<unknown>;
  editor?: WorkflowTextInputEditorLike;
  picker?: { kind?: string };
  presentation?: { inputControl?: string };
  constraints?: { format?: string };
};

// Values with a fixed shape (an address, a date, an id) aren't text to compose; they're typed or
// picked as a whole, or come from a field.
const NON_TEXT_FORMATS = new Set(['email', 'date', 'date-time', 'time', 'uuid']);

// Inputs that hold paragraphs rather than one line, by the last word of their name.
const MULTILINE_NAME_WORDS = new Set([
  'body', 'comment', 'content', 'description', 'details', 'html', 'instructions', 'message', 'note',
  'notes', 'prompt', 'text',
]);

const lastNameWord = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .pop() ?? '';

/** The editor the field asks for, with the legacy picker and multiline hints folded in. */
export const resolveWorkflowTextInputEditor = (
  field: WorkflowTextInputFieldLike
): WorkflowTextInputEditorLike | undefined => {
  if (field.editor) return field.editor;
  if (field.picker?.kind) return { kind: 'picker', inline: { mode: 'picker-summary' } };
  if (field.presentation?.inputControl === 'multiline') return { kind: 'text', inline: { mode: 'textarea' } };
  return undefined;
};

/** True for free text: a string with no options, no picker or special editor, and no fixed format. */
export const isWorkflowFreeTextInput = (field: WorkflowTextInputFieldLike): boolean => {
  if (field.type !== 'string' || field.enum?.length) return false;
  if (field.constraints?.format && NON_TEXT_FORMATS.has(field.constraints.format)) return false;
  const editor = resolveWorkflowTextInputEditor(field);
  if (!editor) return true;
  return editor.kind === 'text' && !editor.softEnum && editor.inline?.mode !== 'swatch';
};

/** Whether a free-text input is edited over several lines. */
export const isWorkflowMultilineTextInput = (field: WorkflowTextInputFieldLike): boolean => {
  const editor = resolveWorkflowTextInputEditor(field);
  return (
    editor?.inline?.mode === 'textarea' ||
    editor?.dialog?.mode === 'large-text' ||
    MULTILINE_NAME_WORDS.has(lastNameWord(field.name))
  );
};
