/**
 * Maps rendered preview elements back to the HTML source they came from, so the
 * side-by-side editor can point at one from the other.
 *
 * Every element open tag is stamped with the character range the whole element
 * occupies in the *original* source. Stamping happens before variable
 * substitution, so the offsets keep describing what the tenant is editing.
 */

export const SOURCE_RANGE_ATTRIBUTE = 'data-alga-src';

export interface SourceRange {
  start: number;
  end: number;
}

interface SourceTag extends SourceRange {
  /** Index just past the tag name, where the marker attribute is inserted. */
  nameEnd: number;
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/y;

interface OpenTag extends SourceTag {
  name: string;
}

/** Open tags in document order, each with the range of the element it opens. */
export function collectHtmlSourceTags(html: string): SourceRange[] {
  return scanOpenTags(html).map(({ start, end }) => ({ start, end }));
}

function scanOpenTags(html: string): OpenTag[] {
  const opened: OpenTag[] = [];
  const stack: OpenTag[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const angle = html.indexOf('<', cursor);
    if (angle === -1) break;

    if (html.startsWith('<!--', angle)) {
      const close = html.indexOf('-->', angle);
      cursor = close === -1 ? html.length : close + 3;
      continue;
    }

    if (html.startsWith('<!', angle) || html.startsWith('<?', angle)) {
      const close = html.indexOf('>', angle);
      cursor = close === -1 ? html.length : close + 1;
      continue;
    }

    TAG.lastIndex = angle;
    const match = TAG.exec(html);
    if (!match) {
      cursor = angle + 1;
      continue;
    }

    const tagEnd = angle + match[0].length;
    const name = match[2].toLowerCase();
    const isClosing = match[1] === '/';
    const isSelfClosing = match[4] === '/' || VOID_ELEMENTS.has(name);

    if (isClosing) {
      const matchIndex = findLastIndex(stack, (tag) => tag.name === name);
      if (matchIndex !== -1) {
        // Anything still open above the match was never closed; it ends at its own tag.
        stack.splice(matchIndex + 1);
        const open = stack.pop();
        if (open) open.end = tagEnd;
      }
      cursor = tagEnd;
      continue;
    }

    const tag: OpenTag = { name, start: angle, nameEnd: angle + 1 + match[2].length, end: tagEnd };
    opened.push(tag);

    if (RAW_TEXT_ELEMENTS.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, tagEnd);
      if (close === -1) {
        tag.end = html.length;
        cursor = html.length;
      } else {
        const closeEnd = html.indexOf('>', close);
        tag.end = closeEnd === -1 ? html.length : closeEnd + 1;
        cursor = tag.end;
      }
      continue;
    }

    if (!isSelfClosing) stack.push(tag);
    cursor = tagEnd;
  }

  return opened;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

/** The same HTML, with every open tag carrying its source range. */
export function annotateHtmlSource(html: string): string {
  const tags = scanOpenTags(html);
  if (tags.length === 0) return html;

  let result = '';
  let cursor = 0;
  for (const tag of tags) {
    result += html.slice(cursor, tag.nameEnd);
    result += ` ${SOURCE_RANGE_ATTRIBUTE}="${tag.start}:${tag.end}"`;
    cursor = tag.nameEnd;
  }
  return result + html.slice(cursor);
}

/** Parses a `start:end` marker back into a range. */
export function parseSourceRange(value: string | null | undefined): SourceRange | null {
  if (!value) return null;
  const [start, end] = value.split(':').map(Number);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/** The narrowest range containing `offset` — the element the caret sits in. */
export function findRangeAtOffset(ranges: readonly SourceRange[], offset: number): SourceRange | null {
  let best: SourceRange | null = null;
  for (const range of ranges) {
    if (offset < range.start || offset > range.end) continue;
    if (!best || range.end - range.start < best.end - best.start) best = range;
  }
  return best;
}
