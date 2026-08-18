/**
 * Markdown / HTML → BlockNote conversion for KB article imports.
 *
 * Lives in @alga-psa/jobs so the Temporal worker (and the server job runner)
 * can parse uploaded files off the request path. Both entry points are linear
 * in the input size: markdown goes through marked's tokenizer and HTML through
 * htmlparser2's streaming parser, replacing the hand-rolled backtracking
 * regexes that made a single large file pin an event loop for minutes.
 */

import { Lexer } from 'marked';
import type { Token, Tokens } from 'marked';
import { Parser as HtmlParser } from 'htmlparser2';

export type InlineStyles = Record<string, boolean | Record<string, string>>;

export interface InlineSegment {
  type: 'text';
  text: string;
  styles?: InlineStyles;
}

export interface TableRow {
  cells: InlineSegment[][];
  isHeader?: boolean;
}

export interface TableContent {
  type: 'tableContent';
  rows: TableRow[];
}

export interface BlockNoteBlock {
  type: string;
  props?: Record<string, any>;
  content?: InlineSegment[] | TableContent;
  children?: BlockNoteBlock[];
}

export interface KbImportParseOptions {
  /** Cooperative wall-clock cap. Throws KbImportParseTimeoutError when exceeded. */
  maxDurationMs?: number;
}

export class KbImportParseTimeoutError extends Error {
  constructor(maxDurationMs: number) {
    super(`Parsing exceeded the ${maxDurationMs}ms limit`);
    this.name = 'KbImportParseTimeoutError';
  }
}

const HTML_CHUNK_SIZE = 64 * 1024;

class Deadline {
  private readonly expiresAt: number | null;
  private readonly maxDurationMs: number;
  private ticks = 0;

  constructor(maxDurationMs?: number) {
    this.maxDurationMs = maxDurationMs ?? 0;
    this.expiresAt = maxDurationMs && maxDurationMs > 0 ? Date.now() + maxDurationMs : null;
  }

  check(force = false): void {
    if (this.expiresAt === null) return;
    if (!force && (++this.ticks & 0xff) !== 0) return;
    if (Date.now() > this.expiresAt) {
      throw new KbImportParseTimeoutError(this.maxDurationMs);
    }
  }
}

function pushSegment(segments: InlineSegment[], text: string, styles: InlineStyles): void {
  if (!text) return;
  const segment: InlineSegment = { type: 'text', text };
  if (Object.keys(styles).length > 0) {
    segment.styles = { ...styles };
  }
  segments.push(segment);
}

function withStyle(styles: InlineStyles, key: string, value: boolean | Record<string, string>): InlineStyles {
  return { ...styles, [key]: value };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Soft line breaks inside a markdown paragraph collapse to a single space. */
function normalizeSoftBreaks(text: string): string {
  return text.replace(/[ \t]*\n[ \t]*/g, ' ');
}

function inlineFromTokens(
  tokens: Token[] | undefined,
  styles: InlineStyles,
  segments: InlineSegment[],
  deadline: Deadline,
): void {
  if (!tokens) return;

  for (const token of tokens) {
    deadline.check();

    switch (token.type) {
      case 'text':
      case 'escape': {
        const nested = (token as Tokens.Text).tokens;
        if (nested?.length) {
          inlineFromTokens(nested, styles, segments, deadline);
        } else {
          pushSegment(segments, normalizeSoftBreaks((token as Tokens.Text).text), styles);
        }
        break;
      }
      case 'strong':
        inlineFromTokens((token as Tokens.Strong).tokens, withStyle(styles, 'bold', true), segments, deadline);
        break;
      case 'em':
        inlineFromTokens((token as Tokens.Em).tokens, withStyle(styles, 'italic', true), segments, deadline);
        break;
      case 'del':
        inlineFromTokens((token as Tokens.Del).tokens, withStyle(styles, 'strike', true), segments, deadline);
        break;
      case 'codespan':
        pushSegment(segments, (token as Tokens.Codespan).text, withStyle(styles, 'code', true));
        break;
      case 'link': {
        const link = token as Tokens.Link;
        inlineFromTokens(link.tokens, withStyle(styles, 'link', { href: link.href }), segments, deadline);
        break;
      }
      case 'image':
        pushSegment(segments, (token as Tokens.Image).text, styles);
        break;
      case 'br':
        pushSegment(segments, ' ', styles);
        break;
      case 'html':
        pushSegment(segments, htmlToPlainText((token as Tokens.HTML).raw, deadline), styles);
        break;
      default: {
        const generic = token as { tokens?: Token[]; text?: string };
        if (generic.tokens?.length) {
          inlineFromTokens(generic.tokens, styles, segments, deadline);
        } else if (typeof generic.text === 'string') {
          pushSegment(segments, normalizeSoftBreaks(generic.text), styles);
        }
      }
    }
  }
}

function inlineContent(tokens: Token[] | undefined, deadline: Deadline, fallbackText = ''): InlineSegment[] {
  const segments: InlineSegment[] = [];
  inlineFromTokens(tokens, {}, segments, deadline);
  return segments.length > 0 ? segments : [{ type: 'text', text: fallbackText }];
}

/** Flattens a blockquote's nested block tokens into one inline run, joined by spaces. */
function inlineFromBlockTokens(tokens: Token[] | undefined, deadline: Deadline): InlineSegment[] {
  const segments: InlineSegment[] = [];
  for (const token of tokens ?? []) {
    deadline.check();
    const nested = (token as { tokens?: Token[] }).tokens;
    const part: InlineSegment[] = [];
    if (nested?.length) {
      inlineFromTokens(nested, {}, part, deadline);
    } else if (typeof (token as { text?: string }).text === 'string') {
      pushSegment(part, normalizeSoftBreaks((token as { text: string }).text), {});
    }
    if (part.length === 0) continue;
    if (segments.length > 0) pushSegment(segments, ' ', {});
    segments.push(...part);
  }
  return segments.length > 0 ? segments : [{ type: 'text', text: '' }];
}

function appendListTokens(list: Tokens.List, blocks: BlockNoteBlock[], deadline: Deadline): void {
  const itemType = list.ordered ? 'numberedListItem' : 'bulletListItem';

  for (const item of list.items) {
    deadline.check();
    const segments: InlineSegment[] = [];
    const nestedLists: Tokens.List[] = [];

    for (const child of item.tokens ?? []) {
      if (child.type === 'list') {
        nestedLists.push(child as Tokens.List);
        continue;
      }
      const part: InlineSegment[] = [];
      const nested = (child as { tokens?: Token[] }).tokens;
      if (nested?.length) {
        inlineFromTokens(nested, {}, part, deadline);
      } else if (typeof (child as { text?: string }).text === 'string') {
        pushSegment(part, normalizeSoftBreaks((child as { text: string }).text), {});
      }
      if (part.length === 0) continue;
      if (segments.length > 0) pushSegment(segments, ' ', {});
      segments.push(...part);
    }

    blocks.push({
      type: itemType,
      content: segments.length > 0 ? segments : [{ type: 'text', text: '' }],
    });

    // Nested lists are flattened into sibling item blocks, matching the shape
    // the KB editor already stores for imported articles.
    for (const nestedList of nestedLists) {
      appendListTokens(nestedList, blocks, deadline);
    }
  }
}

function appendTokens(tokens: Token[], blocks: BlockNoteBlock[], deadline: Deadline): void {
  for (const token of tokens) {
    deadline.check();

    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'hr':
        blocks.push({ type: 'horizontalRule' });
        break;
      case 'heading': {
        const heading = token as Tokens.Heading;
        blocks.push({
          type: 'heading',
          props: { level: heading.depth },
          content: inlineContent(heading.tokens, deadline, heading.text),
        });
        break;
      }
      case 'code': {
        const code = token as Tokens.Code;
        const language = (code.lang ?? '').trim().split(/\s+/)[0];
        blocks.push({
          type: 'codeBlock',
          props: { language: language || 'plain' },
          content: [{ type: 'text', text: code.text }],
        });
        break;
      }
      case 'blockquote': {
        const quote = token as Tokens.Blockquote;
        blocks.push({
          type: 'blockquote',
          content: inlineFromBlockTokens(quote.tokens, deadline),
        });
        break;
      }
      case 'list':
        appendListTokens(token as Tokens.List, blocks, deadline);
        break;
      case 'table': {
        const table = token as Tokens.Table;
        const rows: TableRow[] = [
          {
            isHeader: true,
            cells: table.header.map((cell) => inlineContent(cell.tokens, deadline, cell.text)),
          },
          ...table.rows.map((row) => ({
            isHeader: false,
            cells: row.map((cell) => inlineContent(cell.tokens, deadline, cell.text)),
          })),
        ];
        blocks.push({ type: 'table', content: { type: 'tableContent', rows } });
        break;
      }
      case 'html': {
        // Raw HTML embedded in markdown goes through the streaming HTML walker.
        blocks.push(...htmlToBlockList((token as Tokens.HTML).raw, deadline));
        break;
      }
      case 'paragraph':
      case 'text': {
        const block = token as Tokens.Paragraph;
        const content = inlineContent(block.tokens, deadline, block.text ?? '');
        blocks.push({ type: 'paragraph', content });
        break;
      }
      default: {
        const generic = token as { tokens?: Token[]; text?: string };
        if (generic.tokens?.length || typeof generic.text === 'string') {
          blocks.push({
            type: 'paragraph',
            content: inlineContent(generic.tokens, deadline, generic.text ?? ''),
          });
        }
      }
    }
  }
}

export function markdownToBlocks(markdown: string, options: KbImportParseOptions = {}): BlockNoteBlock[] {
  const deadline = new Deadline(options.maxDurationMs);
  const tokens = Lexer.lex(markdown.replace(/\r\n?/g, '\n'), { gfm: true });
  const blocks: BlockNoteBlock[] = [];
  appendTokens(tokens as Token[], blocks, deadline);
  return blocks;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const SKIPPED_TAGS = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'svg']);
const PARAGRAPH_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'dd', 'dt']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

interface HtmlTableState {
  rows: TableRow[];
  cells: InlineSegment[][];
  rowIsHeader: boolean;
}

class HtmlBlockWalker {
  readonly blocks: BlockNoteBlock[] = [];

  private segments: InlineSegment[] = [];
  private blockType = 'paragraph';
  private blockProps: Record<string, any> | undefined;
  private styles: InlineStyles = {};
  private readonly styleStack: InlineStyles[] = [];
  private readonly listStack: Array<'bulletListItem' | 'numberedListItem'> = [];
  private readonly tableStack: HtmlTableState[] = [];
  private cell: InlineSegment[] | null = null;
  private skipDepth = 0;
  private preDepth = 0;
  private preText = '';
  private preLanguage = 'plain';

  constructor(private readonly deadline: Deadline) {}

  onOpenTag(name: string, attribs: Record<string, string>): void {
    this.deadline.check();

    if (this.skipDepth > 0 || SKIPPED_TAGS.has(name)) {
      this.skipDepth++;
      return;
    }

    if (this.preDepth > 0) {
      if (name === 'pre') this.preDepth++;
      if (name === 'code' && attribs.class) {
        this.preLanguage = languageFromClass(attribs.class) ?? this.preLanguage;
      }
      return;
    }

    switch (name) {
      case 'br':
        this.pushText(' ');
        return;
      case 'hr':
        this.flushBlock();
        this.blocks.push({ type: 'horizontalRule' });
        return;
      case 'pre':
        this.flushBlock();
        this.preDepth = 1;
        this.preText = '';
        this.preLanguage = languageFromClass(attribs.class) ?? 'plain';
        return;
      case 'ul':
      case 'ol':
        this.flushBlock();
        this.listStack.push(name === 'ol' ? 'numberedListItem' : 'bulletListItem');
        return;
      case 'li':
        this.flushBlock();
        this.blockType = this.listStack[this.listStack.length - 1] ?? 'bulletListItem';
        return;
      case 'blockquote':
        this.flushBlock();
        this.blockType = 'blockquote';
        return;
      case 'table':
        this.flushBlock();
        this.tableStack.push({ rows: [], cells: [], rowIsHeader: false });
        return;
      case 'tr':
        if (this.tableStack.length) {
          const table = this.tableStack[this.tableStack.length - 1];
          table.cells = [];
          table.rowIsHeader = false;
        }
        return;
      case 'th':
      case 'td':
        if (this.tableStack.length) {
          this.cell = [];
          if (name === 'th') this.tableStack[this.tableStack.length - 1].rowIsHeader = true;
        }
        return;
      case 'strong':
      case 'b':
        this.pushStyle('bold', true);
        return;
      case 'em':
      case 'i':
        this.pushStyle('italic', true);
        return;
      case 'del':
      case 's':
      case 'strike':
        this.pushStyle('strike', true);
        return;
      case 'code':
        this.pushStyle('code', true);
        return;
      case 'a':
        this.pushStyle('link', { href: attribs.href ?? '' });
        return;
      default:
        break;
    }

    if (HEADING_TAGS.has(name)) {
      this.flushBlock();
      this.blockType = 'heading';
      this.blockProps = { level: Number(name.slice(1)) };
      return;
    }

    if (PARAGRAPH_TAGS.has(name)) {
      this.flushBlock();
      this.blockType = 'paragraph';
    }
  }

  onText(text: string): void {
    this.deadline.check();
    if (this.skipDepth > 0) return;

    if (this.preDepth > 0) {
      this.preText += text;
      return;
    }

    this.pushText(text.replace(/\s+/g, ' '));
  }

  onCloseTag(name: string): void {
    this.deadline.check();

    if (this.skipDepth > 0) {
      this.skipDepth--;
      return;
    }

    if (this.preDepth > 0) {
      if (name === 'pre') {
        this.preDepth--;
        if (this.preDepth === 0) {
          this.blocks.push({
            type: 'codeBlock',
            props: { language: this.preLanguage },
            content: [{ type: 'text', text: this.preText.replace(/^\n+|\s+$/g, '') }],
          });
          this.preText = '';
        }
      }
      return;
    }

    switch (name) {
      case 'ul':
      case 'ol':
        this.flushBlock();
        this.listStack.pop();
        return;
      case 'li':
      case 'blockquote':
        this.flushBlock();
        return;
      case 'th':
      case 'td':
        if (this.tableStack.length && this.cell) {
          const cell = trimSegments(this.cell);
          this.tableStack[this.tableStack.length - 1].cells.push(
            cell.length > 0 ? cell : [{ type: 'text', text: '' }],
          );
          this.cell = null;
        }
        return;
      case 'tr':
        if (this.tableStack.length) {
          const table = this.tableStack[this.tableStack.length - 1];
          if (table.cells.length > 0) {
            table.rows.push({ isHeader: table.rowIsHeader, cells: table.cells });
          }
          table.cells = [];
          table.rowIsHeader = false;
        }
        return;
      case 'table': {
        const table = this.tableStack.pop();
        if (table && table.rows.length > 0) {
          this.blocks.push({ type: 'table', content: { type: 'tableContent', rows: table.rows } });
        }
        return;
      }
      case 'strong':
      case 'b':
      case 'em':
      case 'i':
      case 'del':
      case 's':
      case 'strike':
      case 'code':
      case 'a':
        this.popStyle();
        return;
      default:
        break;
    }

    if (HEADING_TAGS.has(name) || PARAGRAPH_TAGS.has(name)) {
      this.flushBlock();
    }
  }

  finish(): BlockNoteBlock[] {
    if (this.preDepth > 0 && this.preText) {
      this.blocks.push({
        type: 'codeBlock',
        props: { language: this.preLanguage },
        content: [{ type: 'text', text: this.preText.replace(/^\n+|\s+$/g, '') }],
      });
      this.preText = '';
      this.preDepth = 0;
    }
    while (this.tableStack.length) {
      const table = this.tableStack.pop()!;
      if (table.rows.length > 0) {
        this.blocks.push({ type: 'table', content: { type: 'tableContent', rows: table.rows } });
      }
    }
    this.flushBlock();
    return this.blocks;
  }

  private pushText(text: string): void {
    if (!text) return;
    const target = this.cell ?? this.segments;
    if (text.trim() === '' && target.length === 0) return;
    pushSegment(target, text, this.styles);
  }

  private pushStyle(key: string, value: boolean | Record<string, string>): void {
    this.styleStack.push(this.styles);
    this.styles = withStyle(this.styles, key, value);
  }

  private popStyle(): void {
    this.styles = this.styleStack.pop() ?? {};
  }

  private flushBlock(): void {
    const segments = trimSegments(this.segments);
    this.segments = [];
    const blockType = this.blockType;
    const blockProps = this.blockProps;
    this.blockType = 'paragraph';
    this.blockProps = undefined;

    if (segments.length === 0) return;
    if (this.cell) {
      this.cell.push(...segments);
      return;
    }

    const block: BlockNoteBlock = { type: blockType, content: segments };
    if (blockProps) block.props = blockProps;
    this.blocks.push(block);
  }
}

function languageFromClass(className: string | undefined): string | null {
  if (!className) return null;
  const match = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(className);
  return match ? match[1] : null;
}

function trimSegments(segments: InlineSegment[]): InlineSegment[] {
  const trimmed = segments.slice();
  while (trimmed.length > 0) {
    const first = trimmed[0];
    const text = first.text.replace(/^\s+/, '');
    if (text) {
      trimmed[0] = { ...first, text };
      break;
    }
    trimmed.shift();
  }
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    const text = last.text.replace(/\s+$/, '');
    if (text) {
      trimmed[trimmed.length - 1] = { ...last, text };
      break;
    }
    trimmed.pop();
  }
  return trimmed;
}

function htmlToBlockList(html: string, deadline: Deadline): BlockNoteBlock[] {
  const walker = new HtmlBlockWalker(deadline);
  const parser = new HtmlParser(
    {
      onopentag: (name, attribs) => walker.onOpenTag(name, attribs),
      ontext: (text) => walker.onText(text),
      onclosetag: (name) => walker.onCloseTag(name),
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true },
  );

  // Fed in chunks so the cooperative deadline can fire inside one giant line.
  for (let offset = 0; offset < html.length; offset += HTML_CHUNK_SIZE) {
    deadline.check(true);
    parser.write(html.slice(offset, offset + HTML_CHUNK_SIZE));
  }
  parser.end();

  return walker.finish();
}

function htmlToPlainText(html: string, deadline: Deadline): string {
  let text = '';
  let skipDepth = 0;
  const parser = new HtmlParser(
    {
      onopentag: (name) => {
        deadline.check();
        if (skipDepth > 0 || SKIPPED_TAGS.has(name)) skipDepth++;
      },
      ontext: (chunk) => {
        deadline.check();
        if (skipDepth === 0) text += chunk;
      },
      onclosetag: () => {
        if (skipDepth > 0) skipDepth--;
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  return text.replace(/\s+/g, ' ').trim();
}

export function htmlToBlocks(html: string, options: KbImportParseOptions = {}): BlockNoteBlock[] {
  return htmlToBlockList(html, new Deadline(options.maxDurationMs));
}

export function fileContentToBlocks(
  filename: string,
  content: string,
  options: KbImportParseOptions = {},
): BlockNoteBlock[] {
  return /\.(html|htm)$/i.test(filename)
    ? htmlToBlocks(content, options)
    : markdownToBlocks(content, options);
}

export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.(md|markdown|html|htm)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
