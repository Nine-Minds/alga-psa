// Asset notes are stored as a BlockNote (rich-text) document — the same format
// the web editor writes. Mobile can't host the full editor, so it renders a
// flattened plain-text view and *appends* new notes as paragraph blocks. We
// never replace the document: a PUT overwrites the whole thing, and blindly
// replacing would clobber headings, lists, and images authored on the web.

type TextRun = { type?: string; text?: string; styles?: unknown };
type Block = {
  type?: string;
  props?: unknown;
  content?: TextRun[] | string | null;
  children?: Block[];
};

/** One paragraph block matching the web editor's DEFAULT_BLOCK shape. */
export function paragraphBlock(text: string): Block {
  return {
    type: "paragraph",
    props: { textAlignment: "left", backgroundColor: "default", textColor: "default" },
    content: [{ type: "text", text, styles: {} }],
  } as Block;
}

function blockText(block: Block): string {
  if (!block || typeof block !== "object") return "";
  const { content } = block;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((run) => (run && typeof run.text === "string" ? run.text : ""))
    .join("");
}

/**
 * Flatten a BlockNote document to plain text, one line per block (children
 * indented under their parent). Non-text blocks (images, tables) collapse to
 * empty lines, which are dropped. Returns "" for empty/absent notes.
 */
export function blockDataToText(blockData: unknown): string {
  if (!Array.isArray(blockData)) return "";
  const lines: string[] = [];
  const walk = (blocks: Block[], depth: number) => {
    for (const block of blocks) {
      const text = blockText(block).trim();
      if (text) lines.push(`${"  ".repeat(depth)}${text}`);
      if (Array.isArray(block?.children) && block.children.length > 0) {
        walk(block.children, depth + 1);
      }
    }
  };
  walk(blockData as Block[], 0);
  return lines.join("\n");
}

/**
 * Append a note as a new paragraph block, preserving any existing content.
 * Absent/non-array documents start fresh as a single-paragraph document.
 */
export function appendNoteBlock(blockData: unknown, note: string): Block[] {
  const existing = Array.isArray(blockData) ? (blockData as Block[]) : [];
  return [...existing, paragraphBlock(note)];
}
