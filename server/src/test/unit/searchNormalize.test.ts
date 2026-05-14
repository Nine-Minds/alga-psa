import { describe, expect, it } from 'vitest';

import { flattenBlockNote } from '../../lib/search/normalize';

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
});
