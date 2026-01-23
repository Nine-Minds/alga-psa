import { // Changed 'import type' to 'import' for LayoutElementType
  LayoutElementType,
} from '@alga-psa/types';
import type { // Keep 'import type' for interfaces
  LayoutElement,
  DocumentElement,
  SectionElement,
  RowElement,
  ColumnElement,
  TextElement,
  ImageElement, // Added ImageElement type
  ElementStyle,
  RenderOutput,
  GlobalStyles,
} from '@alga-psa/types'; // Removed LayoutElementType from here as it's imported above

// Helper to convert camelCase style properties to kebab-case for CSS
function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`);
}

// Helper to generate CSS rules from an ElementStyle object
function generateStyleCss(selector: string, style: ElementStyle): string {
  let css = `${selector} {\n`;
  for (const key in style) {
    if (Object.prototype.hasOwnProperty.call(style, key) && style[key] !== undefined) {
      css += `  ${camelToKebab(key)}: ${style[key]};\n`;
    }
  }
  css += '}\n';
  return css;
}

// Helper to generate CSS from GlobalStyles
function generateGlobalCss(globalStyles: GlobalStyles | undefined): string {
  if (!globalStyles) return '';
  let css = '';

  // Variables
  if (globalStyles.variables) {
    css += ':root {\n';
    for (const key in globalStyles.variables) {
      css += `  ${key}: ${globalStyles.variables[key]};\n`;
    }
    css += '}\n\n';
  }

  // Classes
  if (globalStyles.classes) {
    for (const className in globalStyles.classes) {
      css += generateStyleCss(`.${className}`, globalStyles.classes[className]);
    }
    css += '\n';
  }

  // Base Element Styles
  if (globalStyles.baseElementStyles) {
    for (const elementType in globalStyles.baseElementStyles) {
      const styles = globalStyles.baseElementStyles[elementType as LayoutElementType];
      if (styles) {
        // Check if 'styles' directly represents an ElementStyle (for the base type)
        // or if it's an object mapping variants to ElementStyles.
        // A simple check: does it have common style properties OR is it not an object?
        // (A more robust check might involve listing known ElementStyle keys)
        const styleKeys = Object.keys(styles);
        const looksLikeElementStyle = styleKeys.some(key => ['width', 'height', 'color', 'fontSize', 'margin', 'padding', 'border'].includes(key));

        if (looksLikeElementStyle) {
             // Apply style to the base element type (e.g., 'Row', 'Column')
             // Use a class selector matching the type name
             css += generateStyleCss(`.${elementType}`, styles as ElementStyle);
        } else {
            // Assume it's an object mapping variants to styles
            for (const variant in styles) {
                 // Use a class convention like .ElementType-variant (e.g., .Text-heading1)
                 const variantStyle = (styles as { [key: string]: ElementStyle })[variant];
                 if (variantStyle && typeof variantStyle === 'object') { // Ensure it's actually a style object
                    css += generateStyleCss(`.${elementType}-${variant}`, variantStyle);
                 }
            }
        }
      }
    }
    css += '\n';
  }

  return css;
}


// --- Rendering Functions for Each Element Type ---

interface RenderContext {
  css: string; // Accumulates CSS rules
  globalStyles?: GlobalStyles; // Access to global styles if needed
}

function renderElement(element: LayoutElement, context: RenderContext): string {
  let elementHtml = '';
  let elementCss = '';
  const baseSelector = element.type; // Use type as base class
  const idSelector = element.id ? `#${element.id}` : '';
  // Explicitly type classList as string[]
  const classList: string[] = [baseSelector]; // Start with base type class

  // Add pagination hint classes
  if (element.pageBreakBefore) {
    classList.push('page-break-before');
  }
  if (element.keepTogether) {
    classList.push('keep-together');
  }

  // Generate CSS for the current element's specific styles using ID if available, otherwise class
  const selector = idSelector || `.${baseSelector}`; // Prioritize ID for specific styles
  if (element.style) {
    context.css += generateStyleCss(selector, element.style);
  }

  // Basic XSS prevention - replace < and >. Use a proper sanitizer in production.
  const sanitize = (text: string | undefined) => text?.replace(/</g, '<').replace(/>/g, '>') || '';

  // Render based on type
  switch (element.type) {
    case LayoutElementType.Document:
      elementHtml = renderDocument(element as DocumentElement, context);
      break;
    case LayoutElementType.Section:
      elementHtml = renderSection(element as SectionElement, context);
      break;
    case LayoutElementType.Row:
      elementHtml = renderRow(element as RowElement, context);
      break;
    case LayoutElementType.Column:
      elementHtml = renderColumn(element as ColumnElement, context);
      break;
    case LayoutElementType.Text:
      elementHtml = renderText(element as TextElement, context);
      break;
    case LayoutElementType.Image:
       elementHtml = renderImage(element as ImageElement, context);
       break;
    // Add cases for other element types here
    default:
      console.warn(`Unsupported layout element type: ${element.type}`);
      elementHtml = `<!-- Unsupported element: ${sanitize(element.type)} -->`;
  }

  return elementHtml;
}

function renderDocument(element: DocumentElement, context: RenderContext): string {
  context.globalStyles = element.globalStyles; // Make global styles available
  context.css += generateGlobalCss(element.globalStyles); // Add global styles to CSS output

  const childrenHtml = Array.isArray(element.children) ? element.children.map(child => renderElement(child, context)).join('\n') : '';
  // Using a simple div wrapper for the document for now. Could use <html><body> etc. if needed.
  const classList: string[] = ['Document']; // Explicitly type
  if (element.pageBreakBefore) classList.push('page-break-before');
  if (element.keepTogether) classList.push('keep-together');
  const classAttr = `class="${classList.filter(Boolean).join(' ')}"`;
  return `<div ${classAttr}${element.id ? ` id="${element.id}"` : ''}>\n${childrenHtml}\n</div>`;
}

function renderSection(element: SectionElement, context: RenderContext): string {
  const childrenHtml = Array.isArray(element.children) ? element.children.map(child => renderElement(child, context)).join('\n') : '';
  // Using <section> semantic tag
  const classList: string[] = ['Section']; // Explicitly type
  if (element.pageBreakBefore) classList.push('page-break-before');
  if (element.keepTogether) classList.push('keep-together');
  const classAttr = `class="${classList.filter(Boolean).join(' ')}"`;
  return `<section ${classAttr}${element.id ? ` id="${element.id}"` : ''}>\n${childrenHtml}\n</section>`;
}

function renderRow(element: RowElement, context: RenderContext): string {
  const childrenHtml = Array.isArray(element.children) ? element.children.map(child => renderElement(child, context)).join('\n') : '';
  // Simple div for row, assuming flexbox/grid styling will be applied via CSS
  const classList: string[] = ['Row']; // Explicitly type
  if (element.pageBreakBefore) classList.push('page-break-before');
  if (element.keepTogether) classList.push('keep-together');
  const classAttr = `class="${classList.filter(Boolean).join(' ')}"`;
  return `<div ${classAttr}${element.id ? ` id="${element.id}"` : ''}>\n${childrenHtml}\n</div>`;
}

function renderColumn(element: ColumnElement, context: RenderContext): string {
  const childrenHtml = Array.isArray(element.children) ? element.children.map(child => renderElement(child, context)).join('\n') : '';
  // Simple div for column
  const classList: string[] = ['Column']; // Explicitly type
  if (element.span) classList.push(`span-${element.span}`);
  if (element.pageBreakBefore) classList.push('page-break-before');
  if (element.keepTogether) classList.push('keep-together');
  const classAttr = `class="${classList.filter(Boolean).join(' ')}"`;
  return `<div ${classAttr}${element.id ? ` id="${element.id}"` : ''}>\n${childrenHtml}\n</div>`;
}

function renderText(element: TextElement, context: RenderContext): string {
  const sanitize = (text: string | undefined) => text?.replace(/</g, '<').replace(/>/g, '>') || '';
  const content = sanitize(element.content);
  let tag = 'p'; // Default to paragraph
  const classList: string[] = ['Text']; // Explicitly type

  if (element.pageBreakBefore) classList.push('page-break-before');
  if (element.keepTogether) classList.push('keep-together');


  switch (element.variant) {
    case 'heading1': tag = 'h1'; classList.push('heading1'); break;
    case 'heading2': tag = 'h2'; classList.push('heading2'); break;
    case 'label': tag = 'label'; classList.push('label'); break;
    case 'caption': tag = 'span'; classList.push('caption'); break; // Or figcaption depending on context
    case 'paragraph': // Fallthrough to default
    default: tag = 'p'; classList.push('paragraph'); break;
  }
   // Add variant class for potential global styling
   if (element.variant) {
       classList.push(`${element.type}-${element.variant}`);
   }

  const classAttr = `class="${classList.filter(Boolean).join(' ')}"`;
  return `<${tag} ${classAttr}${element.id ? ` id="${element.id}"` : ''}>${content}</${tag}>`;
}

function renderImage(element: ImageElement, context: RenderContext): string {
   const sanitize = (text: string | undefined) => text?.replace(/</g, '<').replace(/>/g, '>') || '';
   const src = sanitize(element.src); // Basic sanitization for src
   const alt = sanitize(element.alt || ''); // Sanitize alt text
   const classList: string[] = ['Image']; // Explicitly type
   if (element.pageBreakBefore) classList.push('page-break-before');
   if (element.keepTogether) classList.push('keep-together');
   const classAttr = `class="${classList.filter(Boolean).join(' ')}"`;
   return `<img ${classAttr}${element.id ? ` id="${element.id}"` : ''} src="${src}" alt="${alt}">`;
}


// --- Main Renderer Function ---

/**
 * Renders a Layout Data Structure into HTML and CSS.
 *
 * @param layout - The root LayoutElement (typically a DocumentElement).
 * @returns A RenderOutput object containing the generated HTML and CSS.
 */
export function renderLayout(layout: LayoutElement): RenderOutput {
  if (layout.type !== LayoutElementType.Document) {
    console.warn('Root layout element is not a Document. Wrapping it in a default Document.');
    // Wrap the non-document root in a proper DocumentElement
    // This also resolves the 'children' property error (line 235)
    const wrapperDoc: DocumentElement = {
        type: LayoutElementType.Document,
        children: [layout]
        // Inherited optional properties like id, style, etc., will be undefined, which is fine here.
    };
    layout = wrapperDoc;
  }

  const context: RenderContext = { css: '' };
  const html = renderElement(layout, context);

  // Basic CSS reset and default styles (optional)
  const defaultCss = `
/* Basic Reset */
* { box-sizing: border-box; margin: 0; padding: 0; }

/* Example default styles */
body { font-family: sans-serif; line-height: 1.5; }
.Row { display: flex; margin-bottom: 1rem; } /* Example: Flexbox for rows */
.Column { flex: 1; padding: 0 0.5rem; } /* Example: Basic column styling */
.Column:first-child { padding-left: 0; }
.Column:last-child { padding-right: 0; }
h1, h2, h3 { margin-bottom: 0.5em; }
p { margin-bottom: 1em; }
img { max-width: 100%; height: auto; display: block; }

/* Pagination Hint Styles (for printing) */
@media print {
  .page-break-before { page-break-before: always; }
  .keep-together { page-break-inside: avoid; }
  /* Add more print-specific styles if needed */
}

`; // Add more defaults as needed

  return {
    html: html,
    css: defaultCss + context.css, // Prepend defaults to generated CSS
  };
}
