import { parse, postprocess, preprocess } from 'micromark';
import { parseFragment } from 'parse5';

interface Replacement { start: number; end: number; text: string }
const MARKDOWN_URL = new Set(['resourceDestinationString', 'definitionDestinationString']);
const HTML_FIELDS: Record<string, readonly string[]> = { img: ['src'], video: ['src', 'poster'], audio: ['src'], source: ['src'], a: ['href'] };
const LITERAL_HTML = new Set(['pre', 'code', 'script', 'style', 'textarea']);

/** Parse only to locate semantic URL spans, then patch those spans in the
 * original source. Formatting, captions, code, titles and HTML escaping are
 * preserved; no renderer, DOM execution, or URL fetching is involved. */
export function rewritePortableMarkup(source: string, rewriteUrl: (url: string) => string): string {
  const replacements: Replacement[] = [];
  const htmlRanges: { start: number; end: number }[] = [], literalRanges: { start: number; end: number }[] = [];
  const replace = (start: number, end: number) => {
    const original = source.slice(start, end), text = rewriteUrl(original);
    if (text !== original) replacements.push({ start, end, text });
  };
  const html = () => {
    // Keep only HTML tokens at their original offsets. This preserves HTML
    // ancestry across inline tags, without treating fenced/inline code as HTML.
    let original = '', offset = 0;
    for (const range of htmlRanges) {
      original += ' '.repeat(range.start - offset) + source.slice(range.start, range.end); offset = range.end;
    }
    original += ' '.repeat(source.length - offset);
    const root = parseFragment(original, { sourceCodeLocationInfo: true });
    const pending = [root as any]; let visited = 0;
    while (pending.length) {
      if (++visited > 1_000_000) throw new Error('Portable markup structure exceeds limits');
      const node = pending.pop();
      if (LITERAL_HTML.has(node.tagName)) {
        const location = node.sourceCodeLocation;
        if (location) literalRanges.push({ start: location.startOffset, end: location.endOffset });
        continue;
      }
      for (const name of HTML_FIELDS[node.tagName] ?? []) {
        const location = node.sourceCodeLocation?.attrs?.[name]; if (!location) continue;
        const attribute = source.slice(location.startOffset, location.endOffset);
        const match = /^([^\s=]+\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))$/.exec(attribute);
        if (!match) continue;
        const value = match[2] ?? match[3] ?? match[4], quoted = match[2] !== undefined || match[3] !== undefined;
        const offset = location.startOffset + match[1].length + (quoted ? 1 : 0);
        replace(offset, offset + value.length);
      }
      if (node.childNodes) pending.push(...node.childNodes);
    }
  };
  const events = postprocess(parse().document().write(preprocess()(source, undefined, true)));
  for (const [event, token] of events) {
    if (event !== 'enter') continue;
    const start = token.start.offset, end = token.end.offset;
    if (MARKDOWN_URL.has(token.type)) replace(start, end);
    else if (token.type === 'htmlFlow' || token.type === 'htmlText') htmlRanges.push({ start, end });
  }
  if (htmlRanges.length) html();
  replacements.sort((a, b) => a.start - b.start);
  literalRanges.sort((a, b) => a.start - b.start);
  let offset = 0, result = '', literal = 0;
  for (const replacement of replacements) {
    while (literal < literalRanges.length && literalRanges[literal].end <= replacement.start) literal++;
    if (literalRanges[literal] && literalRanges[literal].start <= replacement.start && replacement.end <= literalRanges[literal].end) continue;
    if (replacement.start < offset) throw new Error('Overlapping portable markup references');
    result += source.slice(offset, replacement.start) + replacement.text; offset = replacement.end;
  }
  return replacements.length ? result + source.slice(offset) : source;
}
