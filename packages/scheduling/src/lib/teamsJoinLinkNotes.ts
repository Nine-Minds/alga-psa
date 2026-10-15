/**
 * Appending the Teams join link to notes that may be either plain text or
 * BlockNote JSON.
 *
 * Interaction notes are authored in QuickAddInteraction's BlockNote editor and
 * stored as `JSON.stringify(PartialBlock[])`; other writers (REST, tests, older
 * records) store plain text. Schedule entry notes are edited in a plain
 * textarea (EntryPopup) and must stay plain text. Appending a plaintext line to
 * serialised blocks yields unparseable JSON, which the readers
 * (InteractionDetails / QuickAddInteraction edit mode) then render verbatim.
 */

const JOIN_LABEL = 'Join Teams Meeting: ';

type InlineNode = {
  type?: string;
  text?: string;
  href?: string;
  content?: unknown;
  styles?: Record<string, unknown>;
};

type NoteBlock = {
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: NoteBlock[];
};

function plainJoinLine(joinUrl: string): string {
  return `${JOIN_LABEL}${joinUrl}`;
}

/**
 * Parses serialised BlockNote content. Returns null for plain text, empty
 * input, or anything that only looks like JSON (the same fallback the UI
 * readers apply: malformed `[`/`{`-prefixed strings are treated as text).
 */
export function parseBlockNoteNotes(notes: string | null | undefined): NoteBlock[] | null {
  const raw = notes?.trim() ?? '';
  if (!raw.startsWith('[')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    if (!parsed.every((block) => block && typeof block === 'object' && typeof (block as NoteBlock).type === 'string')) {
      return null;
    }
    return parsed as NoteBlock[];
  } catch {
    return null;
  }
}

function collectInlineText(content: unknown, into: string[]): void {
  if (typeof content === 'string') {
    into.push(content);
    return;
  }
  if (!Array.isArray(content)) {
    return;
  }
  for (const node of content as InlineNode[]) {
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (typeof node.text === 'string') {
      into.push(node.text);
    }
    if (node.content !== undefined) {
      collectInlineText(node.content, into);
    }
  }
}

function blockText(block: NoteBlock): string {
  const parts: string[] = [];
  collectInlineText(block.content, parts);
  return parts.join('');
}

function inlineHrefs(content: unknown, into: string[]): void {
  if (!Array.isArray(content)) {
    return;
  }
  for (const node of content as InlineNode[]) {
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (typeof node.href === 'string') {
      into.push(node.href);
    }
    inlineHrefs(node.content, into);
  }
}

/** Plain-text rendering of blocks: one line per block, nested children indented by nothing. */
export function extractBlockNotePlainText(blocks: NoteBlock[]): string {
  const lines: string[] = [];
  const walk = (list: NoteBlock[]) => {
    for (const block of list) {
      lines.push(blockText(block));
      if (Array.isArray(block.children) && block.children.length > 0) {
        walk(block.children);
      }
    }
  };
  walk(blocks);
  return lines.join('\n').trim();
}

function blocksAreEmpty(blocks: NoteBlock[]): boolean {
  return extractBlockNotePlainText(blocks) === '';
}

function blocksContainUrl(blocks: NoteBlock[], joinUrl: string): boolean {
  const hrefs: string[] = [];
  const walk = (list: NoteBlock[]) => {
    for (const block of list) {
      inlineHrefs(block.content, hrefs);
      if (Array.isArray(block.children)) {
        walk(block.children);
      }
    }
  };
  walk(blocks);
  return hrefs.includes(joinUrl) || extractBlockNotePlainText(blocks).includes(joinUrl);
}

function joinLinkBlock(joinUrl: string): NoteBlock {
  return {
    type: 'paragraph',
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [
      { type: 'text', text: JOIN_LABEL, styles: {} },
      { type: 'link', href: joinUrl, content: [{ type: 'text', text: joinUrl, styles: {} }] },
    ],
  };
}

function appendJoinUrlToPlainText(notes: string, joinUrl: string): string {
  const baseNotes = notes.trim();
  if (!baseNotes) {
    return plainJoinLine(joinUrl);
  }
  if (baseNotes.includes(joinUrl)) {
    return baseNotes;
  }
  return `${baseNotes}\n\n${plainJoinLine(joinUrl)}`;
}

/**
 * For interaction notes. BlockNote input gets a link paragraph appended and is
 * re-serialised (so the rich text keeps rendering); plain text gets the join
 * line appended as before. An empty document (`[]` or only blank blocks) is
 * treated as empty, so the result is just the join link.
 */
export function appendJoinUrlToInteractionNotes(notes: string | null | undefined, joinUrl: string): string {
  const raw = notes?.trim() ?? '';
  const blocks = parseBlockNoteNotes(raw);
  if (!blocks) {
    return appendJoinUrlToPlainText(raw, joinUrl);
  }
  if (blocksAreEmpty(blocks)) {
    return JSON.stringify([joinLinkBlock(joinUrl)]);
  }
  if (blocksContainUrl(blocks, joinUrl)) {
    return raw;
  }
  return JSON.stringify([...blocks, joinLinkBlock(joinUrl)]);
}

/**
 * For schedule entry notes, which are always plain text. BlockNote input is
 * flattened to its text first so the calendar textarea never shows JSON.
 */
export function appendJoinUrlToScheduleNotes(notes: string | null | undefined, joinUrl: string): string {
  const blocks = parseBlockNoteNotes(notes);
  const plain = blocks ? extractBlockNotePlainText(blocks) : (notes ?? '');
  return appendJoinUrlToPlainText(plain, joinUrl);
}
