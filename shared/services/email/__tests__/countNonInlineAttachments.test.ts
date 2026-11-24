import { describe, expect, it } from 'vitest';
import { countNonInlineAttachments } from '../countNonInlineAttachments';

describe('countNonInlineAttachments', () => {
  it('is undefined when the list is unknown', () => {
    expect(countNonInlineAttachments(undefined)).toBeUndefined();
    expect(countNonInlineAttachments(null)).toBeUndefined();
  });
  it('counts file attachments and skips inline ones', () => {
    expect(countNonInlineAttachments([])).toBe(0);
    expect(countNonInlineAttachments([{}, { isInline: true }, { isInline: false, contentId: 'x' }, { contentId: 'cid' }])).toBe(2);
  });
});
