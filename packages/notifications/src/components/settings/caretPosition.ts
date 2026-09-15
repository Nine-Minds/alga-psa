type EditableTemplateElement = HTMLInputElement | HTMLTextAreaElement;

export type CaretMenuPosition = {
  left: number;
  top: number;
};

const MIRRORED_STYLE_PROPERTIES = [
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRightWidth",
  "borderTopWidth",
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "textAlign",
  "textIndent",
  "textTransform",
  "wordSpacing",
] as const;

/**
 * A hidden copy of the editor with the same typography, width and wrapping, cut
 * off at `caret`, so the marker span sits exactly where that character does.
 * The caller is responsible for removing the mirror.
 */
function mirrorUpTo(element: EditableTemplateElement, caret: number) {
  const style = window.getComputedStyle(element);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const elementRect = element.getBoundingClientRect();
  const isSingleLine = element instanceof HTMLInputElement;

  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "fixed";
  mirror.style.left = "-10000px";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = isSingleLine ? "pre" : "pre-wrap";
  mirror.style.wordWrap = "break-word";

  for (const property of MIRRORED_STYLE_PROPERTIES) {
    mirror.style[property] = style[property];
  }

  if (isSingleLine) {
    // Inputs never wrap. Let the mirror grow to its content so the marker is
    // measured after the typed text instead of against the input's full width.
    mirror.style.display = "inline-block";
    mirror.style.width = "auto";
    mirror.style.height = "auto";
  } else {
    mirror.style.width = `${elementRect.width}px`;
    mirror.style.height = `${elementRect.height}px`;
  }

  mirror.textContent = element.value.slice(0, caret);
  marker.textContent = element.value.slice(caret, caret + 1) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);

  return { mirror, marker, style, elementRect, isSingleLine };
}

/**
 * Measure the viewport position immediately below a native input/textarea caret.
 * A hidden mirror keeps wrapping, padding, and typography identical without
 * replacing the accessible native editor.
 */
export function measureCaretMenuPosition(
  element: EditableTemplateElement,
  caret: number,
): CaretMenuPosition {
  const { mirror, marker, style, elementRect, isSingleLine } = mirrorUpTo(element, caret);

  const lineHeight =
    Number.parseFloat(style.lineHeight) ||
    Number.parseFloat(style.fontSize) * 1.2;
  const left = elementRect.left + marker.offsetLeft - element.scrollLeft;
  const top = isSingleLine
    ? elementRect.bottom
    : elementRect.top + marker.offsetTop - element.scrollTop + lineHeight;
  mirror.remove();

  return {
    left: Math.max(8, Math.min(left, window.innerWidth - 328)),
    top,
  };
}

/**
 * How far down an offset sits inside a textarea's own scrollable content.
 *
 * Counting newlines would be cheaper and wrong: one line of an email template
 * is a tag with a long style attribute, which wraps into a dozen visual lines
 * in a half-width editor, so the count lands near the top of a long document.
 */
export function measureOffsetTop(element: HTMLTextAreaElement, offset: number): number {
  const { mirror, marker } = mirrorUpTo(element, offset);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

/**
 * Where to scroll a textarea so `offsetTop` sits a third of the way down,
 * clamped to the top: near enough to the caret to read what surrounds it.
 */
export function scrollTopForOffset(offsetTop: number, clientHeight: number): number {
  if (!Number.isFinite(offsetTop)) return 0;
  return Math.max(0, offsetTop - clientHeight / 3);
}

/**
 * How far a surrounding pane has to move to bring a point at viewport `top` a
 * third of the way down itself. Positive scrolls down.
 */
export function scrollDeltaForOffset(top: number, paneTop: number, paneHeight: number): number {
  if (!Number.isFinite(top)) return 0;
  return top - (paneTop + paneHeight / 3);
}

/** The nearest ancestor that is actually scrolling right now. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Brings a character of a textarea's value into view.
 *
 * Asking the textarea first costs nothing and is clamped to whatever room it
 * has — TextArea grows to fit its content, so that is usually none and the pane
 * around it does the work. Whatever the textarea managed is subtracted before
 * the pane is asked for the rest, so the two can never fight.
 */
export function revealOffset(element: HTMLTextAreaElement, offset: number): void {
  const offsetTop = measureOffsetTop(element, offset);
  if (!Number.isFinite(offsetTop)) return;

  element.scrollTop = scrollTopForOffset(offsetTop, element.clientHeight);

  const pane = scrollParent(element);
  if (!pane) return;

  const paneRect = pane.getBoundingClientRect();
  pane.scrollTop += scrollDeltaForOffset(
    element.getBoundingClientRect().top + offsetTop - element.scrollTop,
    paneRect.top,
    pane.clientHeight,
  );
}
