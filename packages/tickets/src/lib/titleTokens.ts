/**
 * Generic `{{token}}` engine for ticket title templates. Pure: safe for the client bundle.
 *
 * Callers define their own token set (recurring tickets, batch duplicate). An unknown token is an
 * error rather than literal text, so a typo can never reach a ticket title.
 */

const TOKEN_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Tokens in `template` that are not in `known`, in first-seen order. */
export function findUnknownTokens(template: string, known: readonly string[]): string[] {
  const knownSet = new Set(known);
  const unknown: string[] = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (!knownSet.has(token) && !unknown.includes(token)) unknown.push(token);
  }
  return unknown;
}

/** True when `template` contains at least one `{{token}}`. */
export function hasTokens(template: string): boolean {
  return new RegExp(TOKEN_PATTERN.source).test(template);
}

/** Replaces every token using `values`; throws `Unknown title token(s): …` for tokens without a value. */
export function substituteTokens(template: string, values: Record<string, () => string>): string {
  const unknown = findUnknownTokens(template, Object.keys(values));
  if (unknown.length > 0) {
    throw new Error(`Unknown title token${unknown.length > 1 ? 's' : ''}: ${unknown.map((t) => `{{${t}}}`).join(', ')}`);
  }
  return template.replace(TOKEN_PATTERN, (_whole, token: string) => values[token]());
}
