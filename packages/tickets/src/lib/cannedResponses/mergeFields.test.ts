import { describe, expect, it } from 'vitest';
import type { CannedResponseMergeContext } from '@alga-psa/types';
import {
  emptyMergeContext,
  hasMergeTokens,
  resolveMergeFieldsInBlocks,
  resolveMergeFieldsInNote,
  resolveMergeFieldsInText,
  splitFullName,
} from './mergeFields';

const context: CannedResponseMergeContext = {
  contact: { first_name: 'Ada', last_name: 'Lovelace', name: 'Ada Lovelace' },
  ticket: { number: 'TIC-1042', title: 'Printer offline' },
  agent: { name: 'Grace Hopper' },
  client: { name: 'Acme Corp' },
};

describe('resolveMergeFieldsInText', () => {
  it('resolves every required field', () => {
    const text = '{{contact.first_name}} {{contact.last_name}} / {{contact.name}} / {{ticket.number}} / {{ticket.title}} / {{agent.name}} / {{client.name}}';
    expect(resolveMergeFieldsInText(text, context)).toBe('Ada Lovelace / Ada Lovelace / TIC-1042 / Printer offline / Grace Hopper / Acme Corp');
  });

  it('allows inner whitespace and is case-insensitive', () => {
    expect(resolveMergeFieldsInText('Hi {{ Contact.First_Name }}', context)).toBe('Hi Ada');
  });

  it('resolves recognised tokens with no value to an empty string', () => {
    expect(resolveMergeFieldsInText('Hi {{contact.first_name}}!', emptyMergeContext())).toBe('Hi !');
  });

  it('leaves unrecognised tokens as written', () => {
    expect(resolveMergeFieldsInText('{{contact.nickname}} and {{nope}} and {{ticket.number}}', context))
      .toBe('{{contact.nickname}} and {{nope}} and TIC-1042');
  });

  it('does not re-expand values and tolerates replacement-pattern characters', () => {
    const tricky: CannedResponseMergeContext = { ...context, ticket: { number: '$&{{agent.name}}', title: '$1' } };
    expect(resolveMergeFieldsInText('{{ticket.number}} {{ticket.title}}', tricky)).toBe('$&{{agent.name}} $1');
  });

  it('is idempotent once resolved', () => {
    const once = resolveMergeFieldsInText('{{client.name}}', context);
    expect(resolveMergeFieldsInText(once, context)).toBe(once);
  });
});

describe('hasMergeTokens', () => {
  it('detects tokens repeatedly (no sticky regex state)', () => {
    expect(hasMergeTokens('a {{x}} b')).toBe(true);
    expect(hasMergeTokens('a {{x}} b')).toBe(true);
    expect(hasMergeTokens('no tokens {here}')).toBe(false);
  });
});

describe('resolveMergeFieldsInBlocks', () => {
  const doc = [
    {
      type: 'paragraph',
      props: { textColor: '{{ticket.number}}' },
      content: [
        { type: 'text', text: 'Hello {{contact.first_name}},', styles: { bold: true } },
        { type: 'link', href: 'https://x/{{ticket.number}}', content: [{ type: 'text', text: '{{ticket.title}}', styles: {} }] },
      ],
      children: [{ type: 'paragraph', content: [{ type: 'text', text: '-- {{agent.name}}', styles: {} }], children: [] }],
    },
  ];

  it('resolves text in content, links and children but not props or hrefs', () => {
    const resolved = resolveMergeFieldsInBlocks(doc, context) as any;
    expect(resolved[0].content[0].text).toBe('Hello Ada,');
    expect(resolved[0].content[0].styles).toEqual({ bold: true });
    expect(resolved[0].content[1].content[0].text).toBe('Printer offline');
    expect(resolved[0].content[1].href).toBe('https://x/{{ticket.number}}');
    expect(resolved[0].children[0].content[0].text).toBe('-- Grace Hopper');
    expect(resolved[0].props.textColor).toBe('{{ticket.number}}');
  });

  it('does not mutate its input and returns the same reference when nothing changes', () => {
    const before = JSON.stringify(doc);
    resolveMergeFieldsInBlocks(doc, context);
    expect(JSON.stringify(doc)).toBe(before);
    const plain = [{ type: 'paragraph', content: [{ type: 'text', text: 'plain', styles: {} }], children: [] }];
    expect(resolveMergeFieldsInBlocks(plain, context)).toBe(plain);
  });

  it('resolves table cell text', () => {
    const table = [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: '{{client.name}}', styles: {} }]] }] } }];
    expect((resolveMergeFieldsInBlocks(table, context) as any)[0].content.rows[0].cells[0][0].text).toBe('Acme Corp');
  });
});

describe('resolveMergeFieldsInNote', () => {
  it('resolves a serialized BlockNote note', () => {
    const note = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Re {{ticket.number}}', styles: {} }] }]);
    expect(JSON.parse(resolveMergeFieldsInNote(note, context))[0].content[0].text).toBe('Re TIC-1042');
  });

  it('returns the identical string when there is nothing to resolve', () => {
    const note = '[{"type":"paragraph","content":[{"type":"text","text":"{{nope}}","styles":{}}]}]';
    expect(resolveMergeFieldsInNote(note, context)).toBe(note);
  });

  it('treats a non-JSON note as plain text', () => {
    expect(resolveMergeFieldsInNote('Hello {{contact.name}}', context)).toBe('Hello Ada Lovelace');
  });
});

describe('splitFullName', () => {
  it.each([
    ['Ada Lovelace', 'Ada', 'Lovelace'],
    ['Mary Ann Smith', 'Mary', 'Smith'],
    ['Cher', 'Cher', null],
    ['  ', null, null],
  ])('%s', (full, first, last) => {
    expect(splitFullName(full)).toEqual({ first_name: first, last_name: last });
  });
  it('handles null', () => expect(splitFullName(null)).toEqual({ first_name: null, last_name: null }));
});
