import { transformEmailHtmlFragment } from '@shared/lib/email/sanitizeEmailHtml';

export interface TicketEmailAudiencePolicy {
  allowInlineImages: boolean;
  suppressProtectedContent: boolean;
}

interface TicketEmailContentPolicy extends TicketEmailAudiencePolicy {
  missingImageText: string;
  protectedContentText: string;
  deniedDocumentIds?: ReadonlySet<string>;
  deniedImageIds?: ReadonlySet<string>;
}

export function isImageFile(name: string | null | undefined, mimeType: string | null | undefined): boolean {
  return Boolean(mimeType?.toLowerCase().startsWith('image/') ||
    (name && /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(name)));
}

function documentUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value, 'https://email.invalid');
  } catch {
    return null;
  }
}

export function referencedDocumentFileId(value: unknown, action?: 'view' | 'download'): string | null {
  const url = documentUrl(value);
  if (!url) return null;
  try {
    const path = decodeURIComponent(url.pathname);
    const match = /^\/api\/documents\/(view|download)\/([^/?#]+)\/?$/i.exec(path);
    if (match) return !action || match[1].toLowerCase() === action ? match[2] : null;
    if (action) return null;
    const documentRoute = [
      /^\/api\/documents\/([^/]+)\/(?:download|preview|content|thumbnail)\/?$/i,
      /^\/api\/client-portal\/documents\/([^/]+)(?:\/(?:file|export))?\/?$/i,
      /^\/api\/v1\/documents\/([^/]+)(?:\/.*)?$/i,
      /^\/api\/v1\/assets\/documents\/([^/]+)(?:\/.*)?$/i,
      /^\/api\/v1\/(?:tickets|assets)\/[^/]+\/documents\/([^/]+)(?:\/.*)?$/i,
    ];
    for (const route of documentRoute) {
      const document = route.exec(path);
      if (document) return document[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function isProtectedDocumentUrl(value: string): boolean {
  const url = documentUrl(value);
  if (!url) return true;
  try {
    const path = decodeURIComponent(url.pathname);
    return /^\/api\/(?:documents|ticket-comment-attachments|client-portal\/documents|v1\/documents)(?:\/|$)/i.test(path) ||
      /^\/api\/v1\/(?:tickets|assets)\/[^/]+\/documents(?:\/|$)/i.test(path) ||
      /^\/api\/v1\/assets\/documents(?:\/|$)/i.test(path);
  } catch {
    return true;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function replaceMarkdownImages(value: string, marker: string): { value: string; redacted: boolean } {
  const starts = /!\[[^\]\r\n]*\]\(/g;
  let result = '';
  let previous = 0;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(value)) !== null) {
    let depth = 1;
    let end = starts.lastIndex;
    for (; end < value.length && value[end] !== '\n' && value[end] !== '\r'; end++) {
      if (value[end] === '\\') {
        end++;
      } else if (value[end] === '(') {
        depth++;
      } else if (value[end] === ')' && --depth === 0) {
        end++;
        break;
      }
    }
    result += value.slice(previous, match.index) + marker;
    previous = end;
    starts.lastIndex = end;
  }
  return { value: result + value.slice(previous), redacted: previous > 0 };
}

function mayLoadImage(style: string): boolean {
  const withoutComments = style.replace(/\/\*[\s\S]*?\*\//g, '');
  return /\\|@import|(?:url|(?:-webkit-)?image-set|cross-fade|image|var)\s*\(/i.test(withoutComments);
}

function hasInlineStyle(element: Element): element is HTMLElement | SVGElement {
  return 'style' in element;
}

/**
 * Replace media blocks before formatting, so a mixed message does not retain
 * protected file, audio, video, or embed URLs as ordinary rendered links.
 */
export function redactTicketEmailStructuredContent(
  content: unknown,
  policy: TicketEmailContentPolicy,
): { content: unknown; redacted: boolean } {
  let structured = content;
  if (typeof content === 'string') {
    try {
      structured = JSON.parse(content);
    } catch {
      return { content, redacted: false };
    }
  }
  if (!structured || typeof structured !== 'object') return { content, redacted: false };

  const proseMirror = !Array.isArray(structured) &&
    (structured as Record<string, unknown>).type === 'doc';
  let redacted = false;
  const visit = (value: unknown, parentType?: string): unknown => {
    if (Array.isArray(value)) {
      return value.map(child => visit(child, parentType)).filter(child => child !== null);
    }
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : undefined;
    const props = record.props && typeof record.props === 'object' ? record.props as Record<string, unknown> : {};
    const attrs = record.attrs && typeof record.attrs === 'object' ? record.attrs as Record<string, unknown> : {};
    const reference = props.url ?? props.src ?? record.href ?? attrs.src ?? attrs.url ?? attrs.href;
    const documentId = referencedDocumentFileId(reference);
    const denied = Boolean(documentId && policy.deniedDocumentIds?.has(documentId));
    if (type === 'text' && Array.isArray(record.marks) && record.marks.some(mark => {
      if (!mark || typeof mark !== 'object') return false;
      const link = mark as Record<string, unknown>;
      const linkAttrs = link.attrs && typeof link.attrs === 'object' ? link.attrs as Record<string, unknown> : {};
      if (link.type !== 'link' || typeof linkAttrs.href !== 'string') return false;
      const linkedId = referencedDocumentFileId(linkAttrs.href);
      return Boolean((linkedId && policy.deniedDocumentIds?.has(linkedId)) ||
        (policy.suppressProtectedContent && isProtectedDocumentUrl(linkAttrs.href)));
    })) {
      redacted = true;
      return { type: 'text', text: policy.protectedContentText };
    }
    const image = type === 'image' || Boolean(documentId && policy.deniedImageIds?.has(documentId));
    const media = type && ['file', 'audio', 'video', 'embed'].includes(type);
    const protectedLink = type === 'link' && typeof reference === 'string' &&
      policy.suppressProtectedContent && isProtectedDocumentUrl(reference);

    if (denied || (image && !policy.allowInlineImages) ||
      (policy.suppressProtectedContent && media) || protectedLink) {
      redacted = true;
      if (type === 'link' && parentType === 'text') return null;
      const marker = image ? policy.missingImageText : policy.protectedContentText;
      if (type === 'link' || (proseMirror && ['paragraph', 'heading'].includes(parentType ?? ''))) {
        return { type: 'text', text: marker, ...(proseMirror ? {} : { styles: {} }) };
      }
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: marker, ...(proseMirror ? {} : { styles: {} }) }],
        ...(Array.isArray(record.children) ? { children: visit(record.children, type) } : {}),
      };
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, visit(child, type)]));
  };

  const result = visit(structured);
  return { content: typeof content === 'string' ? JSON.stringify(result) : result, redacted };
}

/**
 * Also cover old queued HTML and text, whose structured source may be absent.
 * The application controls the rendered rich-text markup, not the template.
 */
export async function redactTicketEmailRenderedContent(
  value: string,
  format: 'html' | 'text',
  policy: TicketEmailContentPolicy,
): Promise<{ value: string; redacted: boolean }> {
  let result = value;
  let redacted = false;
  const shouldRedact = (url: string) => {
    const documentId = referencedDocumentFileId(url);
    return Boolean((documentId && policy.deniedDocumentIds?.has(documentId)) ||
      (policy.suppressProtectedContent && isProtectedDocumentUrl(url)));
  };
  const restrictContent = !policy.allowInlineImages || policy.suppressProtectedContent || policy.deniedDocumentIds?.size;
  const containsMarkup = /<\/?[a-z][\w:-]*(?:\s|\/?>)/i.test(value);
  if (restrictContent && (format === 'html' || containsMarkup)) {
    result = await transformEmailHtmlFragment(result, fragment => {
      const marker = (text: string): Node => {
        if (format === 'text') return fragment.ownerDocument.createTextNode(text);
        const span = fragment.ownerDocument.createElement('span');
        span.textContent = text;
        return span;
      };
      const replace = (element: Element, text: string) => {
        if (!fragment.contains(element)) return;
        element.replaceWith(marker(text));
        redacted = true;
      };

      if (!policy.allowInlineImages) {
        for (const element of fragment.querySelectorAll('picture, svg, img, canvas, input[type="image"]')) {
          replace(element, policy.missingImageText);
        }
        // These can load an image even when their content type is not known.
        for (const element of fragment.querySelectorAll('iframe, object, embed, style, link')) {
          replace(element, policy.protectedContentText);
        }
      }
      if (policy.suppressProtectedContent) {
        for (const element of fragment.querySelectorAll('audio, video, iframe, object, embed, source')) {
          replace(element, policy.protectedContentText);
        }
      }

      for (const element of fragment.querySelectorAll('*')) {
        if (!fragment.contains(element)) continue;
        let imageRemoved = false;
        if (!policy.allowInlineImages) {
          for (const attribute of ['background', 'poster', 'srcset']) {
            if (element.hasAttribute(attribute)) {
              element.removeAttribute(attribute);
              imageRemoved = true;
            }
          }
          const inlineStyle = element.getAttribute('style');
          if (inlineStyle && mayLoadImage(inlineStyle)) {
            if (inlineStyle.includes('\\') || !hasInlineStyle(element)) {
              element.removeAttribute('style');
            } else {
              const style = element.style;
              for (const property of Array.from(style)) {
                if (mayLoadImage(style.getPropertyValue(property))) style.removeProperty(property);
              }
              if (style.cssText) element.setAttribute('style', style.cssText);
              else element.removeAttribute('style');
            }
            imageRemoved = true;
          }
        }

        const urls = ['href', 'src', 'data', 'action', 'formaction', 'xlink:href']
          .map(attribute => element.getAttribute(attribute))
          .filter((url): url is string => url !== null);
        const dataImage = !policy.allowInlineImages && urls.some(url => /^data:image\//i.test(url.trim()));
        if (dataImage) {
          replace(element, policy.missingImageText);
        } else if (urls.some(shouldRedact)) {
          replace(element, element.localName === 'img' ? policy.missingImageText : policy.protectedContentText);
        } else if (imageRemoved) {
          element.before(marker(policy.missingImageText));
          redacted = true;
        }
      }
    });
  }
  if (!policy.allowInlineImages) {
    if (format === 'text') {
      const images = replaceMarkdownImages(result, policy.missingImageText);
      result = images.value;
      redacted ||= images.redacted;
    }
    result = result.replace(/data:image\/[^\s<>"')]+/gi, () => {
      redacted = true;
      return format === 'html' ? `<span>${escapeHtml(policy.missingImageText)}</span>` : policy.missingImageText;
    });
  }
  if (policy.suppressProtectedContent || policy.deniedDocumentIds?.size) {
    if (format === 'text') {
      result = result.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (original, _label: string, href: string) => {
        if (!shouldRedact(href)) return original;
        redacted = true;
        return policy.protectedContentText;
      });
    }
    result = result.replace(
      /(?:https?:\/\/[^\s<>"'()]+)?\/(?:a|%61)(?:p|%70)(?:i|%69)(?:\/|%2f)[^\s<>"'()]*/gi,
      url => {
        const punctuation = /[.,;!?]+$/.exec(url)?.[0] ?? '';
        const candidate = punctuation ? url.slice(0, -punctuation.length) : url;
        if (!shouldRedact(candidate)) return url;
        redacted = true;
        return (format === 'html' ? escapeHtml(policy.protectedContentText) : policy.protectedContentText) + punctuation;
      },
    );
  }
  return { value: result, redacted };
}
