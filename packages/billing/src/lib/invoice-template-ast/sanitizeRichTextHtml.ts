/**
 * Server-safe HTML sanitizer / renderer for rich-text fields (e.g. quote scope of work).
 *
 * Handles two input formats:
 *  1. BlockNote JSON (array of blocks) — converted to HTML via blocknoteToHtml().
 *  2. Legacy Quill HTML — sanitized via an allowlist tokenizer.
 *
 * Both paths run without a DOM so they work in server-side PDF/preview generation.
 */

// ---------------------------------------------------------------------------
// BlockNote JSON → HTML
// ---------------------------------------------------------------------------

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SAFE_COLOR_BN = /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*\)|[a-z]+)$/i;

const safeColor = (value: unknown): string | null => {
  if (typeof value !== 'string' || value === 'default') return null;
  return SAFE_COLOR_BN.test(value.trim()) ? value.trim() : null;
};

const SAFE_HREF_BN = /^(https?:|mailto:|tel:)/i;

function renderBnInline(content: unknown[]): string {
  return content.map((item: any) => {
    if (!item || typeof item !== 'object') return '';
    if (item.type === 'text') {
      let text = escapeHtml(String(item.text ?? ''));
      const s = item.styles ?? {};
      if (s.bold) text = `<strong>${text}</strong>`;
      if (s.italic) text = `<em>${text}</em>`;
      if (s.underline) text = `<u>${text}</u>`;
      if (s.strikethrough) text = `<s>${text}</s>`;
      const color = safeColor(s.textColor);
      const bg = safeColor(s.backgroundColor);
      if (color || bg) {
        const style = [color ? `color:${color};` : '', bg ? `background-color:${bg};` : ''].join('');
        text = `<span style="${style}">${text}</span>`;
      }
      return text;
    }
    if (item.type === 'link') {
      const href = typeof item.href === 'string' && SAFE_HREF_BN.test(item.href) ? item.href : null;
      const inner = renderBnInline(Array.isArray(item.content) ? item.content : []);
      return href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
        : inner;
    }
    if (item.type === 'mention') {
      return escapeHtml(String(item.props?.displayName ?? item.props?.username ?? ''));
    }
    return '';
  }).join('');
}

const BN_HEADING_STYLE: Record<number, string> = {
  1: 'font-size:1.6em;font-weight:700;margin:8px 0 5px;line-height:1.2;',
  2: 'font-size:1.35em;font-weight:700;margin:8px 0 5px;line-height:1.2;',
  3: 'font-size:1.15em;font-weight:700;margin:8px 0 5px;line-height:1.2;',
  4: 'font-size:1em;font-weight:700;margin:8px 0 5px;',
  5: 'font-size:0.9em;font-weight:700;margin:8px 0 5px;',
  6: 'font-size:0.85em;font-weight:700;margin:8px 0 5px;',
};

const BN_LIST_STYLE = 'margin:6px 0;padding-left:32px;list-style-position:inside;';

const SAFE_IMG_URL = /^https?:/i;

function renderBnTable(block: any): string {
  const content = block.content;
  if (!content || content.type !== 'tableContent' || !Array.isArray(content.rows)) return '';
  const bp = block.props ?? {};
  const tableColor = safeColor(bp.textColor);
  const tableBg = safeColor(bp.backgroundColor);
  const tableExtraStyle = (tableColor ? `color:${tableColor};` : '') + (tableBg ? `background-color:${tableBg};` : '');
  const rows = (content.rows as any[]).map((row: any) => {
    if (!Array.isArray(row.cells)) return '';
    const cells = (row.cells as any[]).map((cell: any) => {
      const cp = cell.props ?? {};
      const cellInline = renderBnInline(Array.isArray(cell.content) ? cell.content : []);
      const colspan = Number(cp.colspan) > 1 ? ` colspan="${Number(cp.colspan)}"` : '';
      const rowspan = Number(cp.rowspan) > 1 ? ` rowspan="${Number(cp.rowspan)}"` : '';
      const alignStyle = cp.textAlignment && cp.textAlignment !== 'left' ? `text-align:${cp.textAlignment};` : '';
      const cellColor = safeColor(cp.textColor);
      const cellColorStyle = cellColor ? `color:${cellColor};` : '';
      const bg = safeColor(cp.backgroundColor);
      const bgStyle = bg ? `background-color:${bg};` : '';
      return `<td${colspan}${rowspan} style="padding:5px 8px;border:1px solid #ccc;${alignStyle}${cellColorStyle}${bgStyle}">${cellInline}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;width:100%;margin:8px 0;${tableExtraStyle}">${rows}</table>`;
}

function buildBnBlockStyle(baseStyle: string, align: string | null): string {
  const parts = [baseStyle, align ? `text-align:${align};` : ''].filter(Boolean).join('');
  return parts ? ` style="${parts}"` : '';
}

function renderBnBlocks(blocks: any[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const type: string = block.type ?? 'paragraph';
    const props = block.props ?? {};
    const align = typeof props.textAlignment === 'string' && props.textAlignment !== 'left'
      ? props.textAlignment
      : null;

    if (type === 'bulletListItem' || type === 'numberedListItem') {
      const tag = type === 'numberedListItem' ? 'ol' : 'ul';
      const listStyle = type === 'numberedListItem'
        ? `${BN_LIST_STYLE}list-style-type:decimal;`
        : `${BN_LIST_STYLE}list-style-type:disc;`;
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === type) {
        const itemAlign = blocks[i].props?.textAlignment;
        const liAlign = typeof itemAlign === 'string' && itemAlign !== 'left' ? ` style="text-align:${itemAlign};"` : '';
        const itemInline = renderBnInline(Array.isArray(blocks[i].content) ? blocks[i].content : []);
        items.push(`<li${liAlign}>${itemInline}</li>`);
        i++;
      }
      parts.push(`<${tag} style="${listStyle}">${items.join('')}</${tag}>`);
      continue;
    }

    if (type === 'checkListItem') {
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === 'checkListItem') {
        const itemAlign = blocks[i].props?.textAlignment;
        // display:flex ignores text-align — use justify-content instead.
        const justifyMap: Record<string, string> = { center: 'center', right: 'flex-end', justify: 'space-between' };
        const justifyStyle = typeof itemAlign === 'string' && itemAlign !== 'left' && justifyMap[itemAlign]
          ? `justify-content:${justifyMap[itemAlign]};`
          : '';
        const itemInline = renderBnInline(Array.isArray(blocks[i].content) ? blocks[i].content : []);
        const checked = blocks[i].props?.checked ? ' checked' : '';
        items.push(`<li style="list-style:none;display:flex;align-items:baseline;gap:6px;${justifyStyle}"><input type="checkbox"${checked} disabled />${itemInline}</li>`);
        i++;
      }
      parts.push(`<ul style="${BN_LIST_STYLE}list-style:none;">${items.join('')}</ul>`);
      continue;
    }

    const inline = renderBnInline(Array.isArray(block.content) ? block.content : []);

    if (type === 'heading') {
      const level = Math.min(Math.max(Number(props.level) || 1, 1), 6);
      const style = buildBnBlockStyle(BN_HEADING_STYLE[level] ?? BN_HEADING_STYLE[1], align);
      const isToggleable = props.isToggleable === true;
      const headingContent = isToggleable ? `<span style="margin-right:6px;font-size:10px;font-weight:normal;vertical-align:middle;line-height:1;">&#9658;</span>${inline}` : inline;
      parts.push(`<h${level}${style}>${headingContent}</h${level}>`);
      if (isToggleable && Array.isArray(block.children) && block.children.length > 0) {
        parts.push(`<div style="padding-left:32px;">${renderBnBlocks(block.children)}</div>`);
      }
    } else if (type === 'codeBlock') {
      const code = Array.isArray(block.content)
        ? block.content.map((c: any) => escapeHtml(String(c.text ?? ''))).join('')
        : '';
      parts.push(`<pre style="background:#f4f4f4;padding:8px;border-radius:4px;font-family:monospace;"><code>${code}</code></pre>`);
    } else if (type === 'quote') {
      const style = buildBnBlockStyle('border-left:3px solid #ccc;margin:8px 0;padding:6px 12px;color:#555;font-style:italic;', align);
      parts.push(`<blockquote${style}>${inline}</blockquote>`);
    } else if (type === 'divider') {
      parts.push('<hr style="border:none;border-top:1px solid #ccc;margin:8px 0;" />');
    } else if (type === 'image') {
      const url = typeof props.url === 'string' && SAFE_IMG_URL.test(props.url) ? props.url : null;
      if (url) {
        const alt = escapeHtml(typeof props.name === 'string' ? props.name : '');
        const caption = typeof props.caption === 'string' && props.caption ? escapeHtml(props.caption) : '';
        const pw = Number(props.previewWidth);
        const widthStyle = Number.isFinite(pw) && pw > 0 ? `width:${pw}px;` : '';
        // Use display:block + margin to align the image — more reliable in PDF
        // renderers than text-align on the figure wrapper.
        const imgMargin = align === 'center' ? 'margin:0 auto;'
          : align === 'right' ? 'margin:0 0 0 auto;'
          : 'margin:0;';
        const imgStyle = `display:block;${widthStyle}max-width:100%;height:auto;${imgMargin}`;
        parts.push(
          `<figure style="margin:8px 0;">` +
          `<img src="${escapeHtml(url)}" alt="${alt}" style="${imgStyle}" />` +
          (caption ? `<figcaption style="font-size:13px;color:#666;margin-top:3px;">${caption}</figcaption>` : '') +
          `</figure>`,
        );
      }
    } else if (type === 'toggleListItem') {
      const children = Array.isArray(block.children) && block.children.length > 0
        ? `<div style="padding-left:32px;">${renderBnBlocks(block.children)}</div>`
        : '';
      const toggleAlign = align ? `text-align:${align};` : '';
      parts.push(
        `<div style="margin:6px 0;padding-left:32px;${toggleAlign}"><span style="margin-right:6px;font-size:10px;font-weight:normal;vertical-align:middle;line-height:1;">&#9658;</span>${inline}</div>` +
        children,
      );
    } else if (type === 'table') {
      parts.push(renderBnTable(block));
    } else {
      const style = buildBnBlockStyle('margin:0 0 6px;', align);
      parts.push(`<p${style}>${inline || '<br />'}</p>`);
    }
    i++;
  }
  return parts.join('');
}

function blocknoteToHtml(input: string): string | null {
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (typeof parsed[0]?.type !== 'string') return null;
    return renderBnBlocks(parsed);
  } catch {
    return null;
  }
}

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ol',
  'ul',
  'li',
  'a',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

// Block-level tags that may carry Quill alignment / indentation / color and
// (for headings) a base font size, applied as controlled inline styles.
const STYLED_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const HEADING_BASE_STYLE: Record<string, string> = {
  h1: 'font-size:1.6em;font-weight:700;margin:8px 0 5px;',
  h2: 'font-size:1.35em;font-weight:700;margin:8px 0 5px;',
  h3: 'font-size:1.15em;font-weight:700;margin:8px 0 5px;',
  h4: 'font-size:1em;font-weight:700;margin:8px 0 5px;',
  h5: 'font-size:0.9em;font-weight:700;margin:8px 0 5px;',
  h6: 'font-size:0.85em;font-weight:700;margin:8px 0 5px;',
};

const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);

// Conservative CSS color allowlist: hex, rgb()/rgba(), or a bare keyword.
// Rejects anything that could smuggle url()/expression()/etc.
const SAFE_COLOR =
  /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*\)|rgba\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*,\s*(?:0|1|0?\.\d+)\s*\)|[a-z]+)$/i;

const extractAlign = (attrText: string): string | null => {
  const cls = attrText.match(/ql-align-(left|center|right|justify)/i)?.[1]?.toLowerCase();
  if (cls && ALIGN_VALUES.has(cls)) {
    return cls;
  }
  const inline = attrText.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1]?.toLowerCase();
  return inline && ALIGN_VALUES.has(inline) ? inline : null;
};

const extractIndentLevel = (attrText: string): number => {
  const level = Number.parseInt(attrText.match(/ql-indent-(\d+)/i)?.[1] ?? '0', 10);
  return Number.isFinite(level) && level > 0 ? level : 0;
};

const buildInlineStyle = (attrText: string): string => {
  // Pull the raw value out of the style="..." attribute (double or single quotes).
  const styleVal =
    attrText.match(/\bstyle\s*=\s*"([^"]*)"/i)?.[1] ??
    attrText.match(/\bstyle\s*=\s*'([^']*)'/i)?.[1] ??
    '';
  if (!styleVal) return '';

  const parts: string[] = [];
  for (const decl of styleVal.split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (!val) continue;
    if ((prop === 'color' || prop === 'background-color') && SAFE_COLOR.test(val)) {
      parts.push(`${prop}:${val};`);
    }
  }
  return parts.join('');
};

const buildBlockStyle = (tagName: string, attrText: string): string => {
  let style = HEADING_BASE_STYLE[tagName] ?? '';
  const align = extractAlign(attrText);
  if (align) {
    style += `text-align:${align};`;
  }
  const indent = extractIndentLevel(attrText);
  if (indent > 0) {
    style += `padding-left:${indent * 24}px;`;
  }
  style += buildInlineStyle(attrText);
  return style;
};

const VOID_TAGS = new Set(['br']);

// Tags whose entire content must be discarded, not just the tag itself.
const DROP_CONTENT_TAGS = new Set(['script', 'style']);

const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

const escapeText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const extractHref = (attrText: string): string | null => {
  const match = attrText.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!match) {
    return null;
  }
  const raw = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  if (!raw || !SAFE_HREF.test(raw)) {
    return null;
  }
  return raw.replace(/"/g, '&quot;');
};

// Inline styles applied to list elements so markers render in the PDF/preview,
// which has no Quill stylesheet. Inline styles also win over any base CSS reset
// (e.g. `list-style: none`) without needing `!important`.
const OL_MARKERS = ['decimal', 'lower-alpha', 'lower-roman'] as const;
const UL_MARKERS = ['disc', 'circle', 'square'] as const;
const ALLOWED_LIST_STYLE_TYPES = new Set<string>([...OL_MARKERS, ...UL_MARKERS, 'none']);

const listStyleType = (kind: 'ol' | 'ul', level: number): string => {
  const markers = kind === 'ol' ? OL_MARKERS : UL_MARKERS;
  return markers[level % markers.length];
};

const extractListStyleType = (attrText: string): string | null => {
  const value = attrText.match(/list-style-type\s*:\s*([a-z-]+)/i)?.[1]?.toLowerCase();
  return value && ALLOWED_LIST_STYLE_TYPES.has(value) ? value : null;
};

const listElementStyle = (kind: 'ol' | 'ul', type: string): string =>
  `margin:4px 0;padding-left:24px;list-style-position:outside;list-style-type:${type};`;

type QuillListItem = { kind: 'ol' | 'ul'; level: number; content: string };

/**
 * Convert a flat run of Quill list items (each carrying its own `data-list`
 * kind and `ql-indent-N` level) into properly nested `<ol>`/`<ul>` markup so
 * indentation and per-level markers render natively outside Quill.
 */
const buildNestedList = (items: QuillListItem[]): string => {
  let html = '';
  const stack: Array<'ol' | 'ul'> = [];
  let prevLevel = -1;

  for (const { kind, level, content } of items) {
    if (level > prevLevel) {
      for (let l = prevLevel + 1; l <= level; l += 1) {
        html += `<${kind} style="${listElementStyle(kind, listStyleType(kind, l))}">`;
        stack.push(kind);
      }
    } else {
      html += '</li>';
      while (stack.length - 1 > level) {
        const closing = stack.pop() as 'ol' | 'ul';
        html += `</${closing}></li>`;
      }
      if (stack.length > 0 && stack[stack.length - 1] !== kind) {
        const closing = stack.pop() as 'ol' | 'ul';
        html += `</${closing}><${kind} style="${listElementStyle(kind, listStyleType(kind, level))}">`;
        stack.push(kind);
      }
    }
    html += `<li>${content}`;
    prevLevel = level;
  }

  html += '</li>';
  while (stack.length > 0) {
    const closing = stack.pop() as 'ol' | 'ul';
    html += `</${closing}>`;
    if (stack.length > 0) {
      html += '</li>';
    }
  }

  return html;
};

/**
 * Quill 2 emits *every* list inside an `<ol>` and distinguishes bullet vs.
 * ordered items via a `data-list` attribute on each `<li>`, with nesting
 * expressed as a `ql-indent-N` class (rendered through its own stylesheet +
 * `ql-ui` marker spans). Outside Quill those markers and indents are lost. This
 * normalizes that markup into semantic, nested `<ul>`/`<ol>` lists so native
 * list markers and indentation render everywhere.
 */
const normalizeQuillLists = (html: string): string => {
  // Drop Quill's UI marker spans (they only exist for the editor caret UI).
  let out = html.replace(/<span\b[^>]*class="[^"]*ql-ui[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');

  out = out.replace(/<(ol|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_full, _tag, inner: string) => {
    const liPattern = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
    const items: QuillListItem[] = [];
    let liMatch: RegExpExecArray | null;
    while ((liMatch = liPattern.exec(inner)) !== null) {
      const attrs = liMatch[1] ?? '';
      const content = liMatch[2] ?? '';
      const dataList = attrs.match(/data-list\s*=\s*"([^"]*)"/i)?.[1]?.toLowerCase();
      const indent = Number.parseInt(attrs.match(/ql-indent-(\d+)/i)?.[1] ?? '0', 10);
      items.push({
        kind: dataList === 'bullet' ? 'ul' : 'ol',
        level: Number.isFinite(indent) && indent > 0 ? indent : 0,
        content,
      });
    }

    return items.length === 0 ? '' : buildNestedList(items);
  });

  return out;
};

export const sanitizeRichTextHtml = (input: unknown): string => {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }

  const bn = blocknoteToHtml(input);
  if (bn !== null) return bn;

  const normalized = normalizeQuillLists(input);

  let result = '';
  let dropDepth = 0; // >0 while inside a script/style block to discard.
  const tagPattern = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(normalized)) !== null) {
    const [full] = match;

    // Emit preceding text (escaped) unless inside a dropped block.
    if (dropDepth === 0) {
      result += escapeText(normalized.slice(lastIndex, match.index));
    }
    lastIndex = match.index + full.length;

    // HTML comment — drop entirely.
    if (full.startsWith('<!--')) {
      continue;
    }

    const tagName = (match[1] ?? '').toLowerCase();
    const isClosing = full.startsWith('</');
    const attrText = match[2] ?? '';

    if (DROP_CONTENT_TAGS.has(tagName)) {
      if (isClosing) {
        dropDepth = Math.max(0, dropDepth - 1);
      } else if (!full.endsWith('/>')) {
        dropDepth += 1;
      }
      continue;
    }

    if (dropDepth > 0) {
      continue;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      // Disallowed tag: drop the tag but keep surrounding text.
      continue;
    }

    if (isClosing) {
      if (!VOID_TAGS.has(tagName)) {
        result += `</${tagName}>`;
      }
      continue;
    }

    if (tagName === 'a') {
      const href = extractHref(attrText);
      result += href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer">`
        : '<a>';
      continue;
    }

    if (VOID_TAGS.has(tagName)) {
      result += `<${tagName} />`;
      continue;
    }

    if (tagName === 'ol') {
      const type = extractListStyleType(attrText) ?? 'decimal';
      result += `<ol style="${listElementStyle('ol', type)}">`;
      continue;
    }

    if (tagName === 'ul') {
      const type = extractListStyleType(attrText) ?? 'disc';
      result += `<ul style="${listElementStyle('ul', type)}">`;
      continue;
    }

    if (tagName === 'span') {
      const style = buildInlineStyle(attrText);
      result += style ? `<span style="${style}">` : '<span>';
      continue;
    }

    if (STYLED_BLOCK_TAGS.has(tagName)) {
      const style = buildBlockStyle(tagName, attrText);
      result += style ? `<${tagName} style="${style}">` : `<${tagName}>`;
      continue;
    }

    result += `<${tagName}>`;
  }

  if (dropDepth === 0) {
    result += escapeText(normalized.slice(lastIndex));
  }

  return result;
};
