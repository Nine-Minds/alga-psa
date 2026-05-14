import { describe, expect, it } from 'vitest';

import { flattenBlockNote, flattenMarkdown } from '../../lib/search/normalize';

describe('search normalization utilities', () => {
  it('T013 extracts visible text from a realistic BlockNote document payload', () => {
    const documentBlocks = [
      {
        id: 'heading-1',
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'ACME onboarding notes', styles: { bold: true } }],
        children: [
          {
            id: 'nested-1',
            type: 'bulletListItem',
            content: [{ type: 'text', text: 'Confirmed Exchange migration window', styles: {} }],
            children: [],
          },
        ],
      },
      {
        id: 'paragraph-1',
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Added Sciton Tribrid Laser', styles: {} },
          { type: 'text', text: ' Serial SN-123', styles: { italic: true } },
        ],
        children: [],
      },
    ];

    expect(flattenBlockNote(documentBlocks)).toBe(
      'ACME onboarding notes Confirmed Exchange migration window Added Sciton Tribrid Laser Serial SN-123',
    );
  });

  it('T014 drops embedded image data URI payloads from BlockNote text', () => {
    const output = flattenBlockNote([
      {
        id: 'image-block',
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Before image', styles: {} },
          {
            type: 'text',
            text: ' data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA ',
            styles: {},
          },
          { type: 'text', text: 'after image', styles: {} },
        ],
        children: [],
      },
    ]);

    expect(output).toBe('Before image after image');
    expect(output).not.toContain('data:image');
    expect(output).not.toContain('iVBORw0KGgo');
  });

  it('T015 handles deeply nested BlockNote lists and inline marks without throwing', () => {
    const deeplyNestedList = [
      {
        id: 'level-1',
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'Level one', styles: { bold: true } }],
        children: [
          {
            id: 'level-2',
            type: 'bulletListItem',
            content: [{ type: 'text', text: 'Level two', styles: { italic: true } }],
            children: [
              {
                id: 'level-3',
                type: 'numberedListItem',
                content: [{ type: 'text', text: 'Level three', styles: { underline: true } }],
                children: [
                  {
                    id: 'level-4',
                    type: 'checkListItem',
                    content: [{ type: 'text', text: 'Level four', styles: { code: true } }],
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(() => flattenBlockNote(deeplyNestedList)).not.toThrow();
    expect(flattenBlockNote(deeplyNestedList)).toBe('Level one Level two Level three Level four');
  });

  it('T016 strips markdown syntax while preserving readable text', () => {
    const markdown = [
      '# Incident Summary',
      '',
      '- **Exchange** mailbox _migration_ finished',
      '- See [runbook](https://example.com/runbook)',
      '',
      '```ts',
      'const ticket = "TIC-1023";',
      '```',
      '',
      '> Follow-up required',
    ].join('\n');

    expect(flattenMarkdown(markdown)).toBe(
      'Incident Summary Exchange mailbox migration finished See runbook const ticket = "TIC-1023"; Follow-up required',
    );
  });
});
