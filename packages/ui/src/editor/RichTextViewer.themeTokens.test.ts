import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const viewerStyles = readFileSync(
  path.resolve(__dirname, 'TicketDetails.module.css'),
  'utf8',
);

describe('RichTextViewer theme tokens', () => {
  it('replaces the fixed prose palette for every semantic Markdown foreground', () => {
    for (const variable of [
      '--tw-prose-body',
      '--tw-prose-headings',
      '--tw-prose-links',
      '--tw-prose-bold',
      '--tw-prose-code',
      '--tw-prose-th-borders',
      '--tw-prose-td-borders',
    ]) {
      expect(viewerStyles).toContain(variable);
    }
  });

  it('themes BlockNote tables, quotes, dividers, and code blocks', () => {
    expect(viewerStyles).toContain('[data-content-type="table"] th');
    expect(viewerStyles).toContain('--color-table-row-alt');
    expect(viewerStyles).toContain('[data-content-type="quote"] blockquote');
    expect(viewerStyles).toContain('[data-content-type="divider"] hr');
    expect(viewerStyles).toContain('[data-content-type="codeBlock"]');
    expect(viewerStyles).toContain(':global(.bn-inline-content) code');
  });
});
