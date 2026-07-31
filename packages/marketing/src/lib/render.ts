/**
 * Text rendering for the marketing module: per-channel post text and
 * sequence-email merge fields + a deliberately small markdown -> HTML
 * renderer (paragraphs, **bold**, *italic*, [links](url), - lists).
 * Nurture emails should read like a person wrote them, not a newsletter.
 */

export interface MergeContext {
  contact?: {
    full_name?: string | null;
    email?: string | null;
  } | null;
  client?: {
    client_name?: string | null;
  } | null;
  extra?: Record<string, string>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstNameOf(fullName?: string | null): string {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0] ?? '';
}

function lastNameOf(fullName?: string | null): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

/** Resolves {{contact.first_name}}, {{contact.full_name}}, {{contact.email}},
 *  {{client.name}} plus anything in context.extra. Unknown fields render ''. */
export function applyMergeFields(template: string, context: MergeContext): string {
  const contact = context.contact ?? {};
  const client = context.client ?? {};
  const lookup: Record<string, string> = {
    'contact.first_name': firstNameOf(contact.full_name),
    'contact.last_name': lastNameOf(contact.full_name),
    'contact.full_name': contact.full_name ?? '',
    'contact.email': contact.email ?? '',
    'client.name': client.client_name ?? '',
    ...(context.extra ?? {}),
  };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => lookup[key] ?? '');
}

/** Per-channel post text: variant override for the channel's platform, else the base body. */
export function renderPostText(
  content: { body_markdown: string; channel_variants: Record<string, string> },
  platform: string,
): string {
  const variant = content.channel_variants?.[platform];
  if (typeof variant === 'string' && variant.trim().length > 0) return variant;
  return content.body_markdown;
}

function renderInline(markdown: string): string {
  let html = escapeHtml(markdown);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) => `<a href="${url}">${text}</a>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return html;
}

/** Minimal markdown -> HTML. Escapes everything first; only the constructs
 *  above are re-enabled. Safe against injected markup. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
      list = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks.join('\n');
}

/** Strips markdown formatting for the text/plain part. */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '- ');
}
