import { LayoutElement, ElementStyle } from "../types";

// Define a class for the partial style structure (internal helper)
export class PartialStyle {
    textAlign: string | null = null;
    fontWeight: string | null = null;
    borderBottom: string | null = null;
    paddingBottom: string | null = null;
    paddingLeft: string | null = null;
    paddingRight: string | null = null;
    marginTop: string | null = null;
    marginBottom: string | null = null; // Add marginBottom
    borderTop: string | null = null;
    paddingTop: string | null = null;
    border: string | null = null; // Add border shorthand
    width: string | null = null; // Add width

    constructor(
        textAlign: string | null = null,
        fontWeight: string | null = null,
        borderBottom: string | null = null,
        paddingBottom: string | null = null,
        marginTop: string | null = null,
        borderTop: string | null = null,
        paddingTop: string | null = null,
        border: string | null = null, // Add border to constructor
        paddingLeft: string | null = null,
        paddingRight: string | null = null,
        marginBottom: string | null = null, // Add marginBottom
        width: string | null = null // Add width
    ) {
        this.textAlign = textAlign;
        this.fontWeight = fontWeight;
        this.borderBottom = borderBottom;
        this.paddingBottom = paddingBottom;
        this.marginTop = marginTop;
        this.borderTop = borderTop;
        this.paddingTop = paddingTop;
        this.border = border; // Assign border in constructor
        this.paddingLeft = paddingLeft;
        this.paddingRight = paddingRight;
        this.marginBottom = marginBottom;
        this.width = width;
    }
}

// Helper to instantiate ElementStyle from a PartialStyle object
export function instantiateStyle(partialStyle: PartialStyle): ElementStyle {
    const style = new ElementStyle();
    if (partialStyle.textAlign !== null) style.textAlign = partialStyle.textAlign;
    if (partialStyle.fontWeight !== null) style.fontWeight = partialStyle.fontWeight;
    if (partialStyle.borderBottom !== null) style.borderBottom = partialStyle.borderBottom;
    if (partialStyle.paddingBottom !== null) style.paddingBottom = partialStyle.paddingBottom;
    if (partialStyle.marginTop !== null) style.marginTop = partialStyle.marginTop;
    if (partialStyle.marginBottom !== null) style.marginBottom = partialStyle.marginBottom;
    if (partialStyle.borderTop !== null) style.borderTop = partialStyle.borderTop;
    if (partialStyle.paddingTop !== null) style.paddingTop = partialStyle.paddingTop;
    if (partialStyle.border !== null) style.border = partialStyle.border; // Handle border shorthand
    if (partialStyle.paddingLeft !== null) style.paddingLeft = partialStyle.paddingLeft;
    if (partialStyle.paddingRight !== null) style.paddingRight = partialStyle.paddingRight;
    if (partialStyle.width !== null) style.width = partialStyle.width;
    return style;
}

// Generic function to apply a style object to a layout element
export function applyStyle<T extends LayoutElement>(element: T, style: ElementStyle): T {
    element.style = style;
    return element;
}