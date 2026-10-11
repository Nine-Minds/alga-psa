/**
 * DOM knowledge shared by the shortcut layer and the modal containers about
 * "the user is typing here" — so a shortcut, a dismiss or a navigation never
 * fires on keys that belong to a text field or rich-text editor.
 */

const EDITABLE_TAGS = new Set(['input', 'textarea', 'select']);

/**
 * `contenteditable` is truthy for "", "true" and "plaintext-only"; only the
 * literal "false" opts out. jsdom does not implement `isContentEditable`, so
 * the attribute is checked as well.
 */
const CONTENT_EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';

/** Roots that mark rich-text editor surfaces (BlockNote / ProseMirror / our own wrapper). */
const EDITOR_ROOT_SELECTOR = [
  '[data-keyboard-shortcuts-editor-root="true"]',
  '.ProseMirror',
  '.bn-editor',
].join(',');

/**
 * Popups owned by the rich-text editor (BlockNote suggestion menus and our
 * mention/emoji popups). Escape dismisses these before it may dismiss the
 * dialog or drawer that hosts the editor.
 */
export const EDITOR_POPUP_SELECTOR = [
  '.bn-suggestion-menu',
  '.bn-grid-suggestion-menu',
  '[data-editor-popup="true"]',
].join(',');

export function isEditableElement(element: Element | null | undefined): boolean {
  if (!element) {
    return false;
  }

  const htmlElement = element as HTMLElement;

  if (EDITABLE_TAGS.has(htmlElement.tagName.toLowerCase())) {
    return true;
  }

  if (htmlElement.isContentEditable) {
    return true;
  }

  if (htmlElement.closest(CONTENT_EDITABLE_SELECTOR)) {
    return true;
  }

  const role = htmlElement.getAttribute('role');
  if (role === 'textbox' || role === 'combobox') {
    return true;
  }

  return Boolean(htmlElement.closest(EDITOR_ROOT_SELECTOR));
}

/**
 * True when the key event belongs to an editable element: either it was
 * dispatched at one, or focus is inside one. The focus check covers events
 * whose target is retargeted or dispatched at the document/window while the
 * caret is still in an editor.
 */
export function isKeyboardEventInEditable(event: Pick<Event, 'target'>): boolean {
  if (event.target instanceof Element && isEditableElement(event.target)) {
    return true;
  }

  if (typeof document === 'undefined') {
    return false;
  }

  return isEditableElement(document.activeElement);
}

export function hasOpenEditorPopup(root: ParentNode = document): boolean {
  return root.querySelector(EDITOR_POPUP_SELECTOR) !== null;
}

/**
 * True while an editor popup is open and the caret is still in an editor, i.e.
 * Escape is meant to close that popup and must not also dismiss the container.
 */
export function editorPopupOwnsEscape(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  return isEditableElement(document.activeElement) && hasOpenEditorPopup();
}
