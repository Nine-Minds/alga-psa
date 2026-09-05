import { convertBlockNoteToHTML, convertProseMirrorToHTML } from '@alga-psa/formatting/blocknoteUtils';
import { parseTicketMobileRichTextDocument } from './ticketRichText';

// Kept out of ticketRichText.ts on purpose: that module is bundled into the
// mobile editor webview (ee/mobile/scripts/generate-ticket-mobile-editor-html.mjs),
// which has no use for the HTML serializer.

const BLANK_HTML_PARAGRAPH = '<p>(?:\\s|&nbsp;|<br\\s*/?>)*</p>';
const LEADING_BLANK_HTML_PARAGRAPHS = new RegExp(`^(?:\\s*${BLANK_HTML_PARAGRAPH})+`);
const TRAILING_BLANK_HTML_PARAGRAPHS = new RegExp(`(?:${BLANK_HTML_PARAGRAPH}\\s*)+$`);

export function extractTicketRichTextHtml(content: string | object | null | undefined): string {
  if (!content) {
    return '';
  }

  if (typeof content === 'string' && !content.trim()) {
    return '';
  }

  try {
    const document = parseTicketMobileRichTextDocument(content);
    const html =
      document.format === 'prosemirror'
        ? convertProseMirrorToHTML(document.content)
        : convertBlockNoteToHTML(document.content);

    if (typeof html !== 'string') {
      return '';
    }

    // BlockNote always appends an empty trailing paragraph; drop it (and any
    // leading twin) so a paste does not start or end with a blank line.
    return html
      .replace(LEADING_BLANK_HTML_PARAGRAPHS, '')
      .replace(TRAILING_BLANK_HTML_PARAGRAPHS, '')
      .trim();
  } catch {
    return '';
  }
}
