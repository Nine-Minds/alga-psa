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
 * Measure the viewport position immediately below a native input/textarea caret.
 * A hidden mirror keeps wrapping, padding, and typography identical without
 * replacing the accessible native editor.
 */
export function measureCaretMenuPosition(
  element: EditableTemplateElement,
  caret: number,
): CaretMenuPosition {
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
