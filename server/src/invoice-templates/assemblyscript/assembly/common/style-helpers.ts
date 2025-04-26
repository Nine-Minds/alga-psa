import { LayoutElement, ElementStyle } from "../types";

// Define a class for the partial style structure (internal helper)
export class PartialStyle {
    textAlign: string | null = null;
    fontWeight: string | null = null;
    borderBottom: string | null = null;
    paddingBottom: string | null = null;
    marginTop: string | null = null;
    borderTop: string | null = null;
    paddingTop: string | null = null;

    constructor(
        textAlign: string | null = null,
        fontWeight: string | null = null,
        borderBottom: string | null = null,
        paddingBottom: string | null = null,
        marginTop: string | null = null,
        borderTop: string | null = null,
        paddingTop: string | null = null
    ) {
        this.textAlign = textAlign;
        this.fontWeight = fontWeight;
        this.borderBottom = borderBottom;
        this.paddingBottom = paddingBottom;
        this.marginTop = marginTop;
        this.borderTop = borderTop;
        this.paddingTop = paddingTop;
    }
}

// Helper to instantiate ElementStyle from a PartialStyle object
export function instantiateStyle(partialStyle: PartialStyle): ElementStyle {
    const style = new ElementStyle();
    // if (partialStyle.textAlign !== null) style.textAlign = partialStyle.textAlign;
    // if (partialStyle.fontWeight !== null) style.fontWeight = partialStyle.fontWeight;
    // if (partialStyle.borderBottom !== null) style.borderBottom = partialStyle.borderBottom;
    // if (partialStyle.paddingBottom !== null) style.paddingBottom = partialStyle.paddingBottom;
    // if (partialStyle.marginTop !== null) style.marginTop = partialStyle.marginTop;
    // if (partialStyle.borderTop !== null) style.borderTop = partialStyle.borderTop;
    // if (partialStyle.paddingTop !== null) style.paddingTop = partialStyle.paddingTop;
    return style;
}

// Generic function to apply a style object to a layout element
export function applyStyle<T extends LayoutElement>(element: T, style: ElementStyle): T {
    // element.style = style;
    return element;
}