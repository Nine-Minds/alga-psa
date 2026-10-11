import { describe, expect, it } from 'vitest';
import {
  appendJoinUrlToInteractionNotes,
  appendJoinUrlToScheduleNotes,
  extractBlockNotePlainText,
  parseBlockNoteNotes,
} from '../teamsJoinLinkNotes';

const JOIN_URL = 'https://teams.microsoft.com/l/meetup-join/abc123';
const JOIN_LINE = `Join Teams Meeting: ${JOIN_URL}`;

const paragraphProps = { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' };

// What QuickAddInteraction actually emits: JSON.stringify(PartialBlock[]) for a
// two-paragraph note with a bold span in the second paragraph.
const richBlocks = [
  {
    id: 'b1',
    type: 'paragraph',
    props: paragraphProps,
    content: [{ type: 'text', text: 'Contractor referral for a 6-phone VoIP system.', styles: {} }],
    children: [],
  },
  {
    id: 'b2',
    type: 'paragraph',
    props: paragraphProps,
    content: [
      { type: 'text', text: 'Price is the ', styles: {} },
      { type: 'text', text: 'deciding factor', styles: { bold: true } },
      { type: 'text', text: '.', styles: {} },
    ],
    children: [],
  },
];
const richNotes = JSON.stringify(richBlocks);

const emptyParagraphNotes = JSON.stringify([
  { id: 'e1', type: 'paragraph', props: paragraphProps, content: [], children: [] },
]);

describe('appendJoinUrlToInteractionNotes', () => {
  it('keeps BlockNote JSON valid and appends a link paragraph', () => {
    const result = appendJoinUrlToInteractionNotes(richNotes, JOIN_URL);

    const blocks = JSON.parse(result);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(3);
    // Original blocks, styles included, are untouched.
    expect(blocks.slice(0, 2)).toEqual(richBlocks);

    const last = blocks[2];
    expect(last.type).toBe('paragraph');
    expect(last.content[0]).toEqual({ type: 'text', text: 'Join Teams Meeting: ', styles: {} });
    expect(last.content[1]).toMatchObject({ type: 'link', href: JOIN_URL });
    expect(last.content[1].content[0].text).toBe(JOIN_URL);
  });

  it('does not append twice when the join URL is already in the document', () => {
    const once = appendJoinUrlToInteractionNotes(richNotes, JOIN_URL);
    const twice = appendJoinUrlToInteractionNotes(once, JOIN_URL);
    expect(twice).toBe(once);
    expect(JSON.parse(twice)).toHaveLength(3);
  });

  it('dedupes on a URL that appears only as plain text inside a block', () => {
    const notes = JSON.stringify([
      { type: 'paragraph', props: paragraphProps, content: [{ type: 'text', text: `see ${JOIN_URL}`, styles: {} }] },
    ]);
    expect(appendJoinUrlToInteractionNotes(notes, JOIN_URL)).toBe(notes);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['whitespace', '   '],
  ])('returns the plain join line for %s notes', (_label, input) => {
    expect(appendJoinUrlToInteractionNotes(input, JOIN_URL)).toBe(JOIN_LINE);
  });

  it.each([
    ['an empty block array', '[]'],
    ['a document of blank paragraphs', emptyParagraphNotes],
  ])('treats %s as empty and yields a single link block', (_label, input) => {
    const blocks = JSON.parse(appendJoinUrlToInteractionNotes(input, JOIN_URL));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content[1]).toMatchObject({ type: 'link', href: JOIN_URL });
  });

  it('keeps the plain-text path for non-JSON notes', () => {
    expect(appendJoinUrlToInteractionNotes('Discussed pricing', JOIN_URL))
      .toBe(`Discussed pricing\n\n${JOIN_LINE}`);
    expect(appendJoinUrlToInteractionNotes(`Discussed pricing\n\n${JOIN_LINE}`, JOIN_URL))
      .toBe(`Discussed pricing\n\n${JOIN_LINE}`);
  });

  it('treats malformed JSON-looking input as plain text', () => {
    const malformed = '[{"type":"paragraph"';
    expect(appendJoinUrlToInteractionNotes(malformed, JOIN_URL)).toBe(`${malformed}\n\n${JOIN_LINE}`);
    // A JSON array that is not a block list is also plain text.
    expect(appendJoinUrlToInteractionNotes('[1,2]', JOIN_URL)).toBe(`[1,2]\n\n${JOIN_LINE}`);
  });
});

describe('appendJoinUrlToScheduleNotes', () => {
  it('flattens BlockNote JSON to text before appending the join line', () => {
    const result = appendJoinUrlToScheduleNotes(richNotes, JOIN_URL);
    expect(result.startsWith('[')).toBe(false);
    expect(result).toBe(
      `Contractor referral for a 6-phone VoIP system.\nPrice is the deciding factor.\n\n${JOIN_LINE}`,
    );
  });

  it('leaves plain-text entry notes on the existing path', () => {
    expect(appendJoinUrlToScheduleNotes('Bring the quote', JOIN_URL)).toBe(`Bring the quote\n\n${JOIN_LINE}`);
    expect(appendJoinUrlToScheduleNotes(`Bring the quote\n\n${JOIN_LINE}`, JOIN_URL)).toBe(`Bring the quote\n\n${JOIN_LINE}`);
    expect(appendJoinUrlToScheduleNotes(null, JOIN_URL)).toBe(JOIN_LINE);
  });

  it('treats an empty BlockNote document as empty', () => {
    expect(appendJoinUrlToScheduleNotes('[]', JOIN_URL)).toBe(JOIN_LINE);
    expect(appendJoinUrlToScheduleNotes(emptyParagraphNotes, JOIN_URL)).toBe(JOIN_LINE);
  });
});

describe('parseBlockNoteNotes / extractBlockNotePlainText', () => {
  it('parses block arrays and rejects anything else', () => {
    expect(parseBlockNoteNotes(richNotes)).toEqual(richBlocks);
    expect(parseBlockNoteNotes('plain')).toBeNull();
    expect(parseBlockNoteNotes('{"type":"paragraph"}')).toBeNull();
    expect(parseBlockNoteNotes('[{"notype":true}]')).toBeNull();
  });

  it('includes link text and nested children in the flattened text', () => {
    const blocks = [
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'Docs: ', styles: {} },
          { type: 'link', href: 'https://example.test', content: [{ type: 'text', text: 'example', styles: {} }] },
        ],
        children: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested', styles: {} }] }],
      },
    ];
    expect(extractBlockNotePlainText(blocks)).toBe('Docs: example\nnested');
  });
});
