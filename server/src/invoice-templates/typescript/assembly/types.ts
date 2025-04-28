// This file now re-exports standard TypeScript types from the host renderer definitions.
// The original AssemblyScript-specific types and serialization logic have been removed.

// Import necessary types from the host environment and interfaces
import type {
    InvoiceViewModel, // From renderer types
    LayoutElement,
    ElementStyle,
    GlobalStyles,
    DocumentElement, // Import DocumentElement
    SectionElement,  // Import SectionElement
    RowElement,
    ColumnElement,
    TextElement,
    ImageElement
} from '../../../lib/invoice-renderer/types';

// Import IInvoiceItem from the interfaces file - Adjusting path
import type { IInvoiceItem } from '../../../interfaces/invoice.interfaces';


// Import the enum directly if needed, or rely on string literals matching the host enum values
import { LayoutElementType } from '../../../lib/invoice-renderer/types';

// Re-export the types for use in TypeScript templates
export type {
    InvoiceViewModel,
    IInvoiceItem as InvoiceItem, // Re-export IInvoiceItem as InvoiceItem
    LayoutElement,
    ElementStyle,
    GlobalStyles, // Note: Templates might need to handle the full host GlobalStyles structure now
    DocumentElement,
    SectionElement,
    RowElement,
    ColumnElement,
    TextElement,
    ImageElement
}; // Removed duplicate InvoiceViewModel and incorrect InvoiceItem import

// Re-export the enum
export { LayoutElementType };

// Helper function for creating basic elements (optional, but can be useful)
// These replace the AssemblyScript classes with simple object creation.

// Correct return types for factory functions using imported interfaces
export function createDocument(children: LayoutElement[] = [], globalStyles?: GlobalStyles): DocumentElement {
    return { type: LayoutElementType.Document, children, globalStyles };
}

export function createSection(children: LayoutElement[] = [], id?: string): SectionElement {
    return { type: LayoutElementType.Section, children, id };
}

export function createRow(children: ColumnElement[] = [], id?: string): RowElement {
    return { type: LayoutElementType.Row, children, id };
}

export function createColumn(children: LayoutElement[] = [], span?: number, id?: string): ColumnElement {
    return { type: LayoutElementType.Column, children, span, id };
}

export function createText(
    content: string,
    variant?: 'heading1' | 'heading2' | 'paragraph' | 'label' | 'caption',
    style?: ElementStyle,
    id?: string
): TextElement {
    return { type: LayoutElementType.Text, content, variant, style, id };
}

export function createImage(src: string, alt?: string, style?: ElementStyle, id?: string): ImageElement {
    return { type: LayoutElementType.Image, src, alt, style, id };
}