import { describe, expect, it } from 'vitest';

import { convertBlockNoteToHTML } from '@alga-psa/documents/lib/blocknoteUtils';

describe('documents blocknoteUtils re-export', () => {
  it('resolves convertBlockNoteToHTML from core shim', () => {
    const html = convertBlockNoteToHTML([
      { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] },
    ]);
    expect(html).toContain('<p');
  });
});
