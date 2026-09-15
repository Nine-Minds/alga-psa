import type { DOMPurify } from 'dompurify';

let purifier: Promise<DOMPurify> | undefined;

/** Server-only HTML boundary; never enable jsdom script execution or resources. */
export async function sanitizeEmailHtml(html: string | undefined): Promise<string | undefined> {
  if (html === undefined) return undefined;
  purifier ??= Promise.all([import('dompurify'), import('jsdom')]).then(([{ default: createDOMPurify }, { JSDOM }]) =>
    createDOMPurify(new JSDOM('').window));
  return (await purifier).sanitize(html, { USE_PROFILES: { html: true } });
}
