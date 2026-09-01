import { describe, expect, it } from 'vitest';
import type { PartialBlock } from '@blocknote/core';
import {
  extractTaskDescriptionText,
  isTaskRichTextEmpty,
  parseTaskRichTextContent,
  serializeTaskDescriptions,
  serializeTaskRichTextContent,
} from './taskRichText';

/** A paragraph carrying a single run of plain text. */
function paragraph(text: string): PartialBlock {
  return {
    type: 'paragraph',
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [{ type: 'text', text, styles: {} }],
  } as PartialBlock;
}

const EMPTY_PARAGRAPH = paragraph('');

describe('parseTaskRichTextContent', () => {
  it('returns a single empty paragraph for absent or blank descriptions', () => {
    for (const input of [null, undefined, '', '   ', '\n\t ']) {
      const blocks = parseTaskRichTextContent(input);
      expect(blocks, `input: ${JSON.stringify(input)}`).toHaveLength(1);
      expect((blocks[0] as any).type).toBe('paragraph');
      expect(isTaskRichTextEmpty(blocks)).toBe(true);
    }
  });

  it('hands back a fresh default block each time so callers cannot alias it', () => {
    const first = parseTaskRichTextContent(null);
    const second = parseTaskRichTextContent(null);

    (first[0] as any).content[0].text = 'mutated';

    expect((second[0] as any).content[0].text).toBe('');
  });

  it('parses a stored BlockNote document back into blocks', () => {
    const doc = [paragraph('First line'), paragraph('Second line')];
    const blocks = parseTaskRichTextContent(JSON.stringify(doc));

    expect(blocks).toHaveLength(2);
    expect((blocks[1] as any).content[0].text).toBe('Second line');
  });

  it('treats plain text that merely starts with a bracket as plain text', () => {
    // "[URGENT] Fix the login bug" is a description, not a serialized document.
    const blocks = parseTaskRichTextContent('[URGENT] Fix the login bug');

    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).type).toBe('paragraph');
    expect((blocks[0] as any).content[0].text).toBe('[URGENT] Fix the login bug');
  });

  it('falls back to plain text when the document is malformed', () => {
    const blocks = parseTaskRichTextContent('[{"type":"paragraph"');

    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).content[0].text).toBe('[{"type":"paragraph"');
  });

  it('falls back to plain text for an empty array', () => {
    const blocks = parseTaskRichTextContent('[]');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).type).toBe('paragraph');
  });

  it('round-trips a document through serialize and parse without drift', () => {
    const doc = [paragraph('Check the router'), paragraph('Then the switch')];
    const once = parseTaskRichTextContent(serializeTaskRichTextContent(doc));
    const twice = parseTaskRichTextContent(serializeTaskRichTextContent(once));

    expect(twice).toEqual(once);
  });
});

describe('isTaskRichTextEmpty', () => {
  it('treats a missing or empty document as empty', () => {
    expect(isTaskRichTextEmpty([])).toBe(true);
    expect(isTaskRichTextEmpty(undefined as any)).toBe(true);
  });

  it('treats blank and whitespace-only text as empty', () => {
    expect(isTaskRichTextEmpty([EMPTY_PARAGRAPH])).toBe(true);
    expect(isTaskRichTextEmpty([paragraph('   ')])).toBe(true);
    expect(isTaskRichTextEmpty([paragraph(''), paragraph('  ')])).toBe(true);
  });

  it('treats any real text as non-empty', () => {
    expect(isTaskRichTextEmpty([paragraph('x')])).toBe(false);
    expect(isTaskRichTextEmpty([EMPTY_PARAGRAPH, paragraph('later line')])).toBe(false);
  });

  it('treats media and structural blocks as content even with no inline text', () => {
    // These blocks carry no `content` array. Reporting them empty would let the
    // save path null out a description whose only content is an image or a table.
    const mediaBlocks = ['image', 'table', 'video', 'audio', 'file', 'codeBlock'];

    for (const type of mediaBlocks) {
      expect(isTaskRichTextEmpty([{ type } as any]), `block type: ${type}`).toBe(false);
    }
  });

  it('treats inline mentions and links as content', () => {
    const withMention: PartialBlock = {
      type: 'paragraph',
      content: [{ type: 'mention', props: { displayName: 'Jane Doe' } }],
    } as any;
    const withLink: PartialBlock = {
      type: 'paragraph',
      content: [{ type: 'link', content: [{ type: 'text', text: 'runbook', styles: {} }] }],
    } as any;

    expect(isTaskRichTextEmpty([withMention])).toBe(false);
    expect(isTaskRichTextEmpty([withLink])).toBe(false);
  });

  it('recognises every text-container block type as emptiable', () => {
    const textContainers = [
      'paragraph',
      'heading',
      'bulletListItem',
      'numberedListItem',
      'checkListItem',
      'quote',
    ];

    for (const type of textContainers) {
      const block = { type, content: [{ type: 'text', text: '', styles: {} }] } as any;
      expect(isTaskRichTextEmpty([block]), `block type: ${type}`).toBe(true);
    }
  });
});

describe('extractTaskDescriptionText', () => {
  it('returns an empty string for absent or blank descriptions', () => {
    for (const input of [null, undefined, '', '   ']) {
      expect(extractTaskDescriptionText(input)).toBe('');
    }
  });

  it('returns plain-text descriptions unchanged', () => {
    expect(extractTaskDescriptionText('Printer jammed again')).toBe('Printer jammed again');
    expect(extractTaskDescriptionText('[URGENT] call back')).toBe('[URGENT] call back');
  });

  it('flattens a stored document to one line per block', () => {
    const doc = [paragraph('Check the router'), paragraph('Then the switch')];
    expect(extractTaskDescriptionText(JSON.stringify(doc))).toBe('Check the router\nThen the switch');
  });

  it('renders mentions using the display name', () => {
    const doc = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ask ', styles: {} },
          { type: 'mention', props: { displayName: 'Jane Doe' } },
        ],
      },
    ];

    expect(extractTaskDescriptionText(JSON.stringify(doc))).toBe('Ask @Jane Doe');
  });

  it('renders link text rather than dropping it', () => {
    const doc = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See the ', styles: {} },
          { type: 'link', content: [{ type: 'text', text: 'runbook', styles: {} }] },
        ],
      },
    ];

    expect(extractTaskDescriptionText(JSON.stringify(doc))).toBe('See the runbook');
  });

  it('returns the raw string when a bracketed description is not valid JSON', () => {
    const malformed = '[{"type":"paragraph"';
    expect(extractTaskDescriptionText(malformed)).toBe(malformed);
  });

  it('is stable across repeated calls on the same description', () => {
    // The list view calls this several times per task in one render pass.
    const doc = JSON.stringify([paragraph('Stable output')]);
    expect(extractTaskDescriptionText(doc)).toBe(extractTaskDescriptionText(doc));
  });
});

describe('serializeTaskDescriptions', () => {
  it('nulls both columns when the document is empty', () => {
    expect(serializeTaskDescriptions([EMPTY_PARAGRAPH])).toEqual({
      description: null,
      description_rich_text: null,
    });
  });

  it('writes markdown and the source document when there is content', () => {
    const result = serializeTaskDescriptions([paragraph('Replace the NIC')]);

    expect(result.description).toContain('Replace the NIC');
    expect(result.description_rich_text).toBe(
      serializeTaskRichTextContent([paragraph('Replace the NIC')]),
    );
  });

  it('preserves a document whose only content is an image', () => {
    // Losing this would silently discard the attachment on save.
    const result = serializeTaskDescriptions([
      { type: 'image', props: { url: 'https://example.test/rack.png' } } as any,
    ]);

    expect(result.description_rich_text).not.toBeNull();
    expect(result.description_rich_text).toContain('image');
  });

  it('survives a full edit round-trip without losing the body', () => {
    const original = [paragraph('Original body')];
    const stored = serializeTaskDescriptions(original);
    const reloaded = parseTaskRichTextContent(stored.description_rich_text);

    expect(extractTaskDescriptionText(stored.description_rich_text)).toBe('Original body');
    expect(isTaskRichTextEmpty(reloaded)).toBe(false);
  });
});
