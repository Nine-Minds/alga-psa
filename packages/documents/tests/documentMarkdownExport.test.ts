import { describe, expect, it } from 'vitest';
import { buildDocumentMarkdown } from '../src/lib/documentMarkdownExport';

describe('buildDocumentMarkdown', () => {
  it('normalizes readable text exports and reports empty content', () => {
    expect(buildDocumentMarkdown(null, 'Meeting notes\r\n\r\n\r\nNext step  ')).toBe('Meeting notes\n\nNext step\n');
    expect(buildDocumentMarkdown(null, '  ')).toBeNull();
  });
  it('converts stored BlockNote content to Markdown', () => {
    expect(buildDocumentMarkdown([{ type: 'paragraph', content: [{ type: 'text', text: 'Meeting Notes' }] }], null)).toContain('Meeting Notes');
  });
});
