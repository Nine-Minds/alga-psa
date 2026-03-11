import { convertBlockContentToHTML } from '@alga-psa/formatting';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackTicketHtml(content: unknown): string {
  if (content === null || content === undefined) {
    return '<p></p>';
  }

  if (typeof content === 'string' && content.trim().length === 0) {
    return '<p></p>';
  }

  const plainText = typeof content === 'string' ? content : JSON.stringify(content);
  return `<p>${escapeHtml(plainText)}</p>`;
}

export function renderTicketRichTextHtml(content: unknown): string {
  try {
    const html = convertBlockContentToHTML(content);
    if (
      typeof html === 'string'
      && html.length > 0
      && html !== '<p>[Invalid content format]</p>'
    ) {
      return html;
    }

    return fallbackTicketHtml(content);
  } catch {
    return fallbackTicketHtml(content);
  }
}

export function renderTicketDescriptionHtml(attributes: unknown): string {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return fallbackTicketHtml('');
  }

  const description = (attributes as Record<string, unknown>).description;
  return renderTicketRichTextHtml(description ?? '');
}
