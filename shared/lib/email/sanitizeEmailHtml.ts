import type { DOMPurify } from 'dompurify';

let purifier: Promise<DOMPurify> | undefined;

export interface SanitizeEmailHtmlOptions {
  /**
   * Send every surviving link to a new tab, replacing whatever `rel` the sender
   * supplied with `noopener noreferrer`.
   */
  hardenLinks?: boolean;
}

/**
 * Harden one anchor the sanitizer has just cleaned. A hook rather than a pass
 * over the serialized output: a regex cannot tell an attribute value that
 * happens to contain `target=` from a real attribute, and whatever it writes is
 * markup the sanitizer never inspected.
 */
function hardenLink(node: Element): void {
  if (node.nodeName !== 'A') return;
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
}

/** Server-only HTML boundary; never enable jsdom script execution or resources. */
export async function sanitizeEmailHtml(
  html: string | undefined,
  options: SanitizeEmailHtmlOptions = {}
): Promise<string | undefined> {
  if (html === undefined) return undefined;
  purifier ??= Promise.all([import('dompurify'), import('jsdom')]).then(([{ default: createDOMPurify }, { JSDOM }]) =>
    createDOMPurify(new JSDOM('').window));
  const purify = await purifier;
  if (!options.hardenLinks) {
    return purify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  // The instance is shared, but add → sanitize → remove is one synchronous run,
  // so no concurrent caller can sanitize while the hook is installed.
  purify.addHook('afterSanitizeAttributes', hardenLink);
  try {
    return purify.sanitize(html, { USE_PROFILES: { html: true } });
  } finally {
    purify.removeHook('afterSanitizeAttributes', hardenLink);
  }
}
