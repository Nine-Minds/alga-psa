import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('handleMarkdownPaste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts markdown plain text into HTML via marked', async () => {
    const { handleMarkdownPaste } = await import('@alga-psa/documents/components/markdownPaste');
    const insertContent = vi.fn();

    const handled = handleMarkdownPaste('## Hello', '', insertContent);

    expect(insertContent).toHaveBeenCalledTimes(1);
    const html = insertContent.mock.calls[0]?.[0];
    expect(html).not.toBe(`<p>## Hello</p>\n`);
    expect(html).toContain('<h2>');
    expect(handled).toBe(true);
  });
});
