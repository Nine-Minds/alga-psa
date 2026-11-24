import { applyEmailPalette } from './applyEmailPalette';
import { STOCK_EMAIL_PALETTE } from './stockPalette';
import type { EmailPaletteTokens } from './types';

export interface DerivableTemplate {
  subject: string;
  html_content: string;
  text_content: string;
}

/**
 * A system template as a tenant's branded copy of it reads: the palette
 * substituted into the HTML, then the brand decoration. Subject and plain text
 * carry no colors, so they are the system's own. This is the single definition
 * of "derived": the apply flow writes it, the resolver serves it.
 */
export function deriveTemplate(
  system: DerivableTemplate,
  palette: EmailPaletteTokens,
  decorate?: (html: string) => string,
): DerivableTemplate {
  const html = applyEmailPalette(system.html_content, STOCK_EMAIL_PALETTE, palette);
  return {
    subject: system.subject,
    html_content: decorate ? decorate(html) : html,
    text_content: system.text_content,
  };
}
