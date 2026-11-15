/**
 * The form builder's draft, as pure data. Everything the canvas, the outline and the inspector
 * do is one of these functions, so the behaviour is testable without a browser and undo/redo is
 * a stack of documents rather than a pile of special cases.
 */
import {
  canRedoDesignerHistory,
  canUndoDesignerHistory,
  createDesignerHistory,
  pushDesignerHistory,
  redoDesignerHistory,
  undoDesignerHistory,
  type DesignerHistory,
} from '@alga-psa/ui/components/designer';
import { getFieldType } from '@alga-psa/ui/form-fields';
import type {
  BasicFormField,
  BasicFormSettings,
} from '../../../../lib/service-requests/formSchema';

export interface FormBuilderDocument {
  elements: BasicFormField[];
  settings: BasicFormSettings;
}

export interface FormBuilderState {
  history: DesignerHistory<FormBuilderDocument>;
  selectedKey: string | null;
  /** The last edit's coalesce key, so typing a label is one undo step, not one per keystroke. */
  lastCoalesceKey: string | null;
}

export function createFormBuilderState(document: FormBuilderDocument): FormBuilderState {
  return {
    history: createDesignerHistory(document),
    selectedKey: null,
    lastCoalesceKey: null,
  };
}

export const getDocument = (state: FormBuilderState): FormBuilderDocument => state.history.present;

export const canUndo = (state: FormBuilderState): boolean => canUndoDesignerHistory(state.history);
export const canRedo = (state: FormBuilderState): boolean => canRedoDesignerHistory(state.history);

function commit(
  state: FormBuilderState,
  next: FormBuilderDocument,
  options?: { selectedKey?: string | null; coalesceKey?: string | null }
): FormBuilderState {
  const history = pushDesignerHistory(state.history, next, {
    coalesceKey: options?.coalesceKey ?? null,
    lastCoalesceKey: state.lastCoalesceKey,
  });
  return {
    history,
    selectedKey: options?.selectedKey !== undefined ? options.selectedKey : state.selectedKey,
    lastCoalesceKey: options?.coalesceKey ?? null,
  };
}

/** A key the schema validator accepts: lower-case, starts with a letter, underscores only. */
export function slugifyElementKey(source: string): string {
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefixed = /^[a-z]/.test(normalized) ? normalized : `field_${normalized}`;
  return prefixed.replace(/_+$/g, '') || 'field';
}

export function uniqueElementKey(base: string, taken: ReadonlySet<string>): string {
  const slug = slugifyElementKey(base);
  if (!taken.has(slug)) return slug;
  let suffix = 2;
  while (taken.has(`${slug}_${suffix}`)) suffix += 1;
  return `${slug}_${suffix}`;
}

const keysOf = (elements: readonly BasicFormField[]): Set<string> =>
  new Set(elements.map((element) => element.key));

export function findElement(
  document: FormBuilderDocument,
  key: string | null
): BasicFormField | null {
  if (!key) return null;
  return document.elements.find((element) => element.key === key) ?? null;
}

export function indexOfElement(document: FormBuilderDocument, key: string | null): number {
  if (!key) return -1;
  return document.elements.findIndex((element) => element.key === key);
}

/** Inserts a new element at `index` (clamped), selects it, and gives it a unique key. */
export function insertElement(
  state: FormBuilderState,
  element: Omit<BasicFormField, 'key'> & { key?: string },
  index?: number
): FormBuilderState {
  const document = getDocument(state);
  const key = uniqueElementKey(element.key || element.label || element.type, keysOf(document.elements));
  const next: BasicFormField = { ...element, key };
  const elements = [...document.elements];
  const target = Math.max(0, Math.min(index ?? elements.length, elements.length));
  elements.splice(target, 0, next);
  return commit(state, { ...document, elements }, { selectedKey: key });
}

export function updateElement(
  state: FormBuilderState,
  key: string,
  patch: Partial<BasicFormField>,
  options?: { coalesceKey?: string | null }
): FormBuilderState {
  const document = getDocument(state);
  const elements = document.elements.map((element) =>
    element.key === key ? { ...element, ...patch, key: element.key } : element
  );
  return commit(state, { ...document, elements }, { coalesceKey: options?.coalesceKey ?? null });
}

/**
 * Renames an element's storage key, keeping its position. Returns the state unchanged when the
 * new key is empty or already taken — the caller shows why rather than silently renaming.
 */
export function renameElementKey(
  state: FormBuilderState,
  key: string,
  nextKeyInput: string
): FormBuilderState {
  const document = getDocument(state);
  const slug = slugifyElementKey(nextKeyInput);
  if (!slug || slug === key) return state;
  if (document.elements.some((element) => element.key === slug)) return state;
  const elements = document.elements.map((element) =>
    element.key === key ? { ...element, key: slug } : element
  );
  return commit(state, { ...document, elements }, { selectedKey: slug });
}

export function moveElement(
  state: FormBuilderState,
  key: string,
  toIndex: number
): FormBuilderState {
  const document = getDocument(state);
  const fromIndex = indexOfElement(document, key);
  if (fromIndex < 0) return state;
  const elements = [...document.elements];
  const [moved] = elements.splice(fromIndex, 1);
  const target = Math.max(0, Math.min(toIndex, elements.length));
  elements.splice(target, 0, moved);
  return commit(state, { ...document, elements });
}

/** Moves the selected element one slot up or down; the keyboard reordering path. */
export function nudgeElement(
  state: FormBuilderState,
  key: string,
  direction: -1 | 1
): FormBuilderState {
  const document = getDocument(state);
  const index = indexOfElement(document, key);
  if (index < 0) return state;
  const target = index + direction;
  if (target < 0 || target >= document.elements.length) return state;
  return moveElement(state, key, target);
}

export function duplicateElement(state: FormBuilderState, key: string): FormBuilderState {
  const document = getDocument(state);
  const index = indexOfElement(document, key);
  if (index < 0) return state;
  const source = document.elements[index];
  const nextKey = uniqueElementKey(source.key, keysOf(document.elements));
  const copy: BasicFormField = { ...source, key: nextKey };
  const elements = [...document.elements];
  elements.splice(index + 1, 0, copy);
  return commit(state, { ...document, elements }, { selectedKey: nextKey });
}

export function deleteElement(state: FormBuilderState, key: string): FormBuilderState {
  const document = getDocument(state);
  const index = indexOfElement(document, key);
  if (index < 0) return state;
  const elements = document.elements.filter((element) => element.key !== key);
  const nextSelected = elements[Math.min(index, elements.length - 1)]?.key ?? null;
  return commit(state, { ...document, elements }, { selectedKey: nextSelected });
}

export function updateSettings(
  state: FormBuilderState,
  patch: Partial<BasicFormSettings>,
  options?: { coalesceKey?: string | null }
): FormBuilderState {
  const document = getDocument(state);
  return commit(
    state,
    { ...document, settings: { ...document.settings, ...patch } },
    { coalesceKey: options?.coalesceKey ?? null }
  );
}

/** Replaces the whole document, e.g. when the author picks a template. */
export function replaceDocument(
  state: FormBuilderState,
  document: FormBuilderDocument
): FormBuilderState {
  return commit(state, document, { selectedKey: document.elements[0]?.key ?? null });
}

export function selectElement(state: FormBuilderState, key: string | null): FormBuilderState {
  if (state.selectedKey === key) return state;
  return { ...state, selectedKey: key, lastCoalesceKey: null };
}

export function undo(state: FormBuilderState): FormBuilderState {
  if (!canUndo(state)) return state;
  const history = undoDesignerHistory(state.history);
  return { history, selectedKey: keepSelection(state.selectedKey, history.present), lastCoalesceKey: null };
}

export function redo(state: FormBuilderState): FormBuilderState {
  if (!canRedo(state)) return state;
  const history = redoDesignerHistory(state.history);
  return { history, selectedKey: keepSelection(state.selectedKey, history.present), lastCoalesceKey: null };
}

function keepSelection(selectedKey: string | null, document: FormBuilderDocument): string | null {
  if (!selectedKey) return null;
  return document.elements.some((element) => element.key === selectedKey) ? selectedKey : null;
}

/**
 * The seeded values a Try-it session starts from, so the live form behaves exactly as the
 * portal would on first load.
 */
export function buildTryItValues(document: FormBuilderDocument): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const element of document.elements) {
    const definition = getFieldType(element.type);
    if (!definition || definition.kind === 'display' || element.type === 'file-upload') {
      continue;
    }
    if (element.type === 'checkbox') {
      values[element.key] = element.defaultValue === true;
    } else if (element.type === 'multi-select') {
      values[element.key] = [];
    } else {
      values[element.key] = typeof element.defaultValue === 'string' ? element.defaultValue : '';
    }
  }
  return values;
}
