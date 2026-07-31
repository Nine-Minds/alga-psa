import { describe, expect, it } from 'vitest';
import { workItemDescriptionText } from '../src/lib/workItemDescription';

describe('workItemDescriptionText', () => {
  it('flattens serialized BlockNote paragraphs to plain text', () => {
    const raw = JSON.stringify([
      {
        id: '1',
        type: 'paragraph',
        props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: 'Printer jams on duplex jobs', styles: {} }],
        children: [],
      },
    ]);

    expect(workItemDescriptionText(raw)).toBe('Printer jams on duplex jobs');
  });

  it('returns an empty string for an empty paragraph document', () => {
    const raw = JSON.stringify([
      {
        id: '1',
        type: 'paragraph',
        props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
        content: [],
        children: [],
      },
    ]);

    expect(workItemDescriptionText(raw)).toBe('');
  });

  it('passes legacy plain-string descriptions through unchanged', () => {
    expect(workItemDescriptionText('Legacy plain text description')).toBe('Legacy plain text description');
  });

  it('returns an empty string for null and undefined', () => {
    expect(workItemDescriptionText(null)).toBe('');
    expect(workItemDescriptionText(undefined)).toBe('');
  });
});
