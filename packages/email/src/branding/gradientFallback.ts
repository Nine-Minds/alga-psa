/**
 * Flat-color fallback for gradient surfaces in mail.
 *
 * Every Outlook (classic Windows, new Windows/Mac, Outlook.com) drops a
 * `background: linear-gradient(...)` declaration and paints nothing in its
 * place, so a header that carries only the gradient renders as the white card
 * behind it and its white text disappears. A `background-color` declaration and
 * a `bgcolor` attribute survive that pass; browsers, Gmail and Apple Mail let
 * the gradient paint over them.
 *
 * `addGradientFallback` runs at send time over every message, so rows written
 * before the templates carried the fallback (system, branded and hand-edited
 * alike) are repaired on their next send with no migration. It covers both
 * inline `style` attributes and the rules of a `<style>` block, which is how the
 * auth templates paint their header. `stripGradientFallback` is the
 * normalization the classifier uses so those older rows still compare equal to
 * the corrected system templates.
 */

const TAG = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const RULE_BODY = /\{([^{}]*)\}/g;

/**
 * A gradient background declaration, split into what precedes it (a delimiter
 * and the whitespace run after it, which the fallback repeats so a `<style>`
 * rule stays one declaration per line), the property and the function.
 */
const GRADIENT_DECLARATION = /(^|[;"'{])(\s*)(background(?:-image)?\s*:\s*)(linear-gradient\()/i;
const BACKGROUND_COLOR = /(^|[\s;"'{])background-color\s*:/i;
const BACKGROUND_COLOR_DECLARATION = /background-color\s*:\s*[^;"'}]+;?\s*/i;
const BGCOLOR_ATTRIBUTE = /\sbgcolor\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/i;
const HAS_GRADIENT = /linear-gradient\(/i;

/** Elements whose `bgcolor` attribute the Word-based Outlook honors. */
const BGCOLOR_ELEMENTS = new Set(['td', 'th', 'table', 'tr', 'body']);

/** The text between the gradient's parentheses, nesting-aware for rgba stops. */
function gradientArguments(source: string, openParenIndex: number): string | null {
  let depth = 0;
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, index);
    }
  }
  return null;
}

/** The first color stop of the gradient, which is the flat color it degrades to. */
function firstGradientColor(declarations: string): string | null {
  const declaration = GRADIENT_DECLARATION.exec(declarations);
  if (!declaration) return null;

  const openParen = declaration.index + declaration[0].length - 1;
  const args = gradientArguments(declarations, openParen);
  return args ? COLOR_LITERAL.exec(args)?.[0] ?? null : null;
}

interface FallbackDeclarations {
  text: string;
  color: string;
}

/**
 * Adds `background-color` ahead of the gradient in a run of CSS declarations
 * (a style attribute's value, or a rule body). Null when there is nothing to do.
 */
function withFallbackDeclaration(declarations: string): FallbackDeclarations | null {
  if (!GRADIENT_DECLARATION.test(declarations) || BACKGROUND_COLOR.test(declarations)) return null;

  const color = firstGradientColor(declarations);
  if (!color) return null;

  const text = declarations.replace(
    GRADIENT_DECLARATION,
    (_match, lead: string, whitespace: string, property: string, gradient: string) =>
      `${lead}${whitespace}background-color:${color};${whitespace}${property}${gradient}`,
  );

  return { text, color };
}

function addToStyleBlocks(html: string): string {
  return html.replace(STYLE_BLOCK, (match, open: string, css: string, close: string) => {
    if (!HAS_GRADIENT.test(css)) return match;

    const updated = css.replace(RULE_BODY, (rule, body: string) => {
      const fallback = withFallbackDeclaration(body);
      return fallback ? `{${fallback.text}}` : rule;
    });

    return `${open}${updated}${close}`;
  });
}

function addToTags(html: string): string {
  return html.replace(TAG, (match, tagName: string, attributes: string) => {
    const fallback = withFallbackDeclaration(attributes);
    if (!fallback) return match;

    let updated = fallback.text;
    if (BGCOLOR_ELEMENTS.has(tagName.toLowerCase()) && !BGCOLOR_ATTRIBUTE.test(updated)) {
      updated = ` bgcolor="${fallback.color}"${updated}`;
    }

    return `<${tagName}${updated}>`;
  });
}

/**
 * Gives every gradient-painted surface a flat `background-color` (and, on table
 * cells, a `bgcolor`) equal to the gradient's first stop. Idempotent: a surface
 * that already declares a background color is left alone.
 */
export function addGradientFallback(html: string): string {
  if (!html || !HAS_GRADIENT.test(html)) return html;
  return addToTags(addToStyleBlocks(html));
}

function stripDeclaration(declarations: string): string {
  return GRADIENT_DECLARATION.test(declarations)
    ? declarations.replace(BACKGROUND_COLOR_DECLARATION, '')
    : declarations;
}

/**
 * Removes the fallback from every gradient-painted surface, so a row written
 * before the templates carried it compares equal to one written after.
 */
export function stripGradientFallback(html: string): string {
  if (!html || !HAS_GRADIENT.test(html)) return html;

  const withoutStyleRules = html.replace(STYLE_BLOCK, (match, open: string, css: string, close: string) => {
    if (!HAS_GRADIENT.test(css)) return match;
    return `${open}${css.replace(RULE_BODY, (_rule, body: string) => `{${stripDeclaration(body)}}`)}${close}`;
  });

  return withoutStyleRules.replace(TAG, (match, tagName: string, attributes: string) => {
    if (!GRADIENT_DECLARATION.test(attributes)) return match;

    const stripped = stripDeclaration(attributes.replace(BGCOLOR_ATTRIBUTE, ''));
    return stripped === attributes ? match : `<${tagName}${stripped}>`;
  });
}
