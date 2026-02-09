import { LayoutElement, ElementStyle } from "../types";

// Helper class for partial style definitions
export class PartialStyle {
  width: string | null = null;
  height: string | null = null;
  textAlign: string | null = null;
  fontWeight: string | null = null;
  marginTop: string | null = null;
  paddingLeft: string | null = null;
  paddingRight: string | null = null;
  paddingTop: string | null = null;
  paddingBottom: string | null = null;
  borderBottom: string | null = null;
  borderTop: string | null = null;
  border: string | null = null;
  marginBottom: string | null = null;
}

// Convert PartialStyle to ElementStyle
export function instantiateStyle(partial: PartialStyle): ElementStyle {
  const style = new ElementStyle();
  style.width = partial.width;
  style.height = partial.height;
  style.textAlign = partial.textAlign;
  style.fontWeight = partial.fontWeight;
  style.marginTop = partial.marginTop;
  style.paddingLeft = partial.paddingLeft;
  style.paddingRight = partial.paddingRight;
  style.paddingTop = partial.paddingTop;
  style.paddingBottom = partial.paddingBottom;
  style.borderBottom = partial.borderBottom;
  style.borderTop = partial.borderTop;
  style.border = partial.border;
  style.marginBottom = partial.marginBottom;
  return style;
}

// Apply style to a layout element
export function applyStyle<T extends LayoutElement>(element: T, style: ElementStyle): T {
  element.style = style;
  return element;
}
