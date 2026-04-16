import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { convertMarkdownToBlocks, type BlockNoteBlock } from './markdownToBlocks';

export { convertMarkdownToBlocks };
export type { BlockNoteBlock };

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

/**
 * Convert HTML to BlockNote blocks using BlockNote's own parser.
 * Handles Outlook CSS, HTML comments, `<style>` blocks, etc. natively.
 *
 * When the HTML is just raw markdown wrapped in `<p>` tags (common with
 * Outlook), the result is re-parsed through the markdown parser to produce
 * properly structured blocks (headings, lists, bold, etc.).
 */
export async function convertHtmlToBlockNote(html: string): Promise<BlockNoteBlock[]> {
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
  const blocks = await editor.tryParseHTMLToBlocks(cleanHtml);

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
