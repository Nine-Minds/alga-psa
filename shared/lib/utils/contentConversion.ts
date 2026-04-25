import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { convertMarkdownToBlocks, type BlockNoteBlock } from './markdownToBlocks';

export { convertMarkdownToBlocks };
export type { BlockNoteBlock };

export interface HtmlToBlockNoteOptions {
  /**
   * Email clients and form tools often use HTML tables for layout. BlockNote
   * preserves those as table blocks, which can render as bunched-up text in the
   * ticket detail view. Enable this for inbound email bodies to convert table
   * rows into plain paragraph blocks while keeping native parsing elsewhere.
   */
  flattenTables?: boolean;
}

// Lazy singleton — avoids re-creating jsdom + Tiptap extensions per call.
let _serverEditor: ReturnType<typeof ServerBlockNoteEditor.create> | null = null;
function getServerEditor() {
  if (!_serverEditor) {
    _serverEditor = ServerBlockNoteEditor.create();
  }
  return _serverEditor;
}

const MARKDOWN_SIGNAL_PATTERN = /^#{1,6}\s|^\*\s|^-\s|^\d+\.\s|\*\*[^*]+\*\*|\[.+\]\(.+\)|^```|^---\s*$|^>\s/m;

/**
 * Check if HTML-parsed blocks are all plain paragraphs whose text contains
 * raw markdown syntax (e.g. Outlook wrapping each markdown line in `<p>`).
 * Returns the joined text if so, null otherwise.
 */
function extractRawMarkdownFromBlocks(blocks: BlockNoteBlock[]): string | null {
  if (blocks.length < 2) return null;
  if (blocks.some(b => b.type !== 'paragraph')) return null;

  const lines: string[] = [];
  for (const block of blocks) {
    if (!Array.isArray(block.content) || block.content.length === 0) {
      lines.push('');
      continue;
    }
    // If any inline content has formatting (bold, italic, link), the HTML
    // already carried semantic markup — don't re-parse as markdown.
    const hasFormatting = block.content.some((item: any) => {
      if (item.type === 'link') return true;
      if (item.styles && Object.values(item.styles).some((v: any) => v === true || (typeof v === 'string' && v !== ''))) return true;
      return false;
    });
    if (hasFormatting) return null;

    lines.push(block.content.map((c: any) => c.text || '').join(''));
  }

  const text = lines.join('\n');
  return MARKDOWN_SIGNAL_PATTERN.test(text) ? text : null;
}

function defaultParagraphProps() {
  return {
    textAlignment: 'left',
    backgroundColor: 'default',
    textColor: 'default',
  };
}

function paragraphBlock(text: string): BlockNoteBlock {
  return {
    type: 'paragraph',
    props: defaultParagraphProps(),
    content: [{ type: 'text', text, styles: {} }],
  };
}

function extractTextFromBlockNoteContent(value: unknown): string {
  if (!value) return '';

  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value
      .map(extractTextFromBlockNoteContent)
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (typeof value !== 'object') return '';

  const record = value as Record<string, any>;
  if (typeof record.text === 'string') return record.text;
  if (record.type === 'link') return extractTextFromBlockNoteContent(record.content);
  if (record.type === 'tableCell') return extractTextFromBlockNoteContent(record.content);
  if (record.content) return extractTextFromBlockNoteContent(record.content);
  if (record.children) return extractTextFromBlockNoteContent(record.children);

  return '';
}

function isLikelyLabelInlineContent(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.styles?.bold === true) return true;
  if (item.type === 'link' && Array.isArray(item.content)) {
    return item.content.some(isLikelyLabelInlineContent);
  }
  return false;
}

function normalizeCellText(value: string): string[] {
  return value
    .replace(/\u00a0/g, ' ')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Break a collapsed one-cell email-layout table into semantic text segments.
 *
 * The inbound failure case is not a normal data table. The source email has many
 * nested presentation tables, but BlockNote's HTML parser flattens that whole
 * nest into a single table cell whose inline content alternates like:
 *
 *   bold label, plain value, bold label, plain value, ...
 *
 * Example: `Name` (bold), `Ada Lovelace`, `Business Email Address` (bold), ...
 * That shape renders as one bunched-up table cell in the ticket viewer. To
 * recover readable content, keep each text run and mark whether it came from a
 * likely field label. Bold inline content is the strongest signal because the
 * form-like emails style labels in bold/uppercase while values are plain text.
 *
 * We do not use this for multi-row/multi-column tables; those remain BlockNote
 * table blocks and are handled by `flattenTableBlock`'s shape checks.
 */
function getSingleCellContentSegments(cell: any): Array<{ text: string; isLabel: boolean }> {
  const content = Array.isArray(cell?.content) ? cell.content : [];
  return content.flatMap((item: any) => {
    const text = extractTextFromBlockNoteContent(item);
    const isLabel = isLikelyLabelInlineContent(item);
    return normalizeCellText(text).map((line) => ({ text: line, isLabel }));
  });
}

/**
 * Convert recovered label/value segments to paragraphs.
 *
 * A label followed by a non-label value becomes one line (`Label Value`). Any
 * unpaired labels/values are kept as their own paragraphs so we do not discard
 * content when an email field is blank or the parser emits an unexpected run.
 */
function singleCellSegmentsToParagraphBlocks(
  segments: Array<{ text: string; isLabel: boolean }>
): BlockNoteBlock[] {
  if (segments.length === 0) return [];

  const lines: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i];
    const next = segments[i + 1];

    if (current.isLabel && next && !next.isLabel) {
      lines.push(`${current.text} ${next.text}`.trim());
      i += 1;
      continue;
    }

    lines.push(current.text);
  }

  return lines.map(paragraphBlock);
}

/**
 * Decide whether a parsed table is an email layout artifact and, if so, flatten
 * it into readable paragraphs.
 *
 * Target only the narrow problematic shape:
 * 1. BlockNote parsed the table as exactly one row.
 * 2. That row has exactly one cell.
 * 3. The cell contains more than one text segment, with at least one segment
 *    styled like a label (currently bold inline content).
 *
 * This protects normal data tables. A real table such as a 3x2 status grid has
 * multiple rows/cells and is returned unchanged as a BlockNote `table` block.
 * The one-cell + label/value pattern, however, is almost always a presentation
 * table from email/form tooling that BlockNote collapsed during HTML parsing.
 */
function flattenTableBlock(block: BlockNoteBlock): BlockNoteBlock[] {
  const rows = (block.content as any)?.rows;
  if (!Array.isArray(rows)) return [block];

  if (rows.length !== 1) return [block];

  const cells = Array.isArray(rows[0]?.cells) ? rows[0].cells : [];
  if (cells.length !== 1) return [block];

  const segments = getSingleCellContentSegments(cells[0]);
  const hasLabelValueRuns = segments.some((segment) => segment.isLabel) && segments.length > 1;
  if (!hasLabelValueRuns) return [block];

  return singleCellSegmentsToParagraphBlocks(segments);
}

function flattenTableBlocks(blocks: BlockNoteBlock[]): BlockNoteBlock[] {
  return blocks.flatMap((block) => {
    if (block.type === 'table') {
      return flattenTableBlock(block);
    }

    if (Array.isArray(block.children) && block.children.length > 0) {
      return [{ ...block, children: flattenTableBlocks(block.children) }];
    }

    return [block];
  });
}

/**
 * Convert HTML to BlockNote blocks using BlockNote's own parser.
 * Handles Outlook CSS, HTML comments, `<style>` blocks, etc. natively.
 *
 * When the HTML is just raw markdown wrapped in `<p>` tags (common with
 * Outlook), the result is re-parsed through the markdown parser to produce
 * properly structured blocks (headings, lists, bold, etc.).
 */
export async function convertHtmlToBlockNote(
  html: string,
  options: HtmlToBlockNoteOptions = {},
): Promise<BlockNoteBlock[]> {
  if (!html) return [];

  // Strip non-content markup that ServerBlockNoteEditor may pass through as
  // text: HTML/conditional comments (Outlook CSS), <style>, <script>, <head>,
  // and Outlook/Word-specific conditional constructs & XML blocks.
  const cleanHtml = html
    // Outlook downlevel-hidden conditional comments: <!--[if ...]>...<![endif]-->
    .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '')
    // Standard HTML comments (including CSS-hiding <!-- ... --> inside <style>)
    .replace(/<!--[\s\S]*?-->/g, '')
    // Outlook conditional processing instructions without -- prefix:
    // <![if ...]>...<![endif]> (not wrapped in HTML comments)
    .replace(/<!\[if[^\]]*\]>[\s\S]*?<!\[endif\]>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    // Outlook/Word <xml> blocks (e.g. <xml><o:OfficeDocumentSettings>...)
    .replace(/<xml[^>]*>[\s\S]*?<\/xml>/gi, '')
    // Office-namespace elements that may appear in <body> (e.g. <o:p>, <w:Sdt>)
    .replace(/<\/?\w+:[^>]*>/g, '');

  const editor = getServerEditor();
  let blocks = await editor.tryParseHTMLToBlocks(cleanHtml) as BlockNoteBlock[];

  if (options.flattenTables) {
    blocks = flattenTableBlocks(blocks);
  }

  // Detect raw-markdown-in-paragraphs (Outlook wrapping markdown lines in <p>)
  const rawMarkdown = extractRawMarkdownFromBlocks(blocks as BlockNoteBlock[]);
  if (rawMarkdown) {
    const mdBlocks = await editor.tryParseMarkdownToBlocks(rawMarkdown);
    if (mdBlocks.length > 0) return mdBlocks as BlockNoteBlock[];
  }

  return blocks as BlockNoteBlock[];
}

/**
 * Convert markdown to BlockNote blocks using BlockNote's own parser.
 */
export async function convertMarkdownToBlockNote(markdown: string): Promise<BlockNoteBlock[]> {
  if (!markdown) return [];
  const editor = getServerEditor();
  const blocks = await editor.tryParseMarkdownToBlocks(markdown);
  return blocks as BlockNoteBlock[];
}
