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

  it('strips styling markup that survives the markdown flattening', () => {
    const raw = JSON.stringify([
      {
        id: '1',
        type: 'heading',
        props: { level: 1, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: 'Outage', styles: {} }],
        children: [],
      },
      {
        id: '2',
        type: 'paragraph',
        props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
        content: [
          { type: 'text', text: 'Highlighted', styles: { backgroundColor: 'purple' } },
          { type: 'text', text: ' and ', styles: {} },
          { type: 'text', text: 'bold', styles: { bold: true } },
        ],
        children: [],
      },
    ]);

    expect(workItemDescriptionText(raw)).toBe('Outage Highlighted and bold');
  });

  it('collapses multi-block documents onto a single line', () => {
    const raw = JSON.stringify([
      {
        id: '1',
        type: 'paragraph',
        props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: 'First block', styles: {} }],
        children: [],
      },
      {
        id: '2',
        type: 'paragraph',
        props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: 'Second block', styles: {} }],
        children: [],
      },
    ]);

    expect(workItemDescriptionText(raw)).toBe('First block Second block');
  });

  it('returns an empty string for null and undefined', () => {
    expect(workItemDescriptionText(null)).toBe('');
    expect(workItemDescriptionText(undefined)).toBe('');
  });
});
