import { describe, expect, it } from 'vitest';
import {
  convertBlockNoteToMarkdown,
  formatBlockNoteContent,
  normalizeBlockHtmlForEmail,
} from './blocknoteUtils';

const paragraph = (text: string, props?: Record<string, unknown>) => ({
  type: 'paragraph',
  ...(props ? { props } : {}),
  content: text ? [{ type: 'text', text, styles: {} }] : [],
});

const SPACER = '<p style="margin:0 0 10px 0;font-size:10px;line-height:10px;">&nbsp;</p>';

describe('normalizeBlockHtmlForEmail', () => {
  it('renders a mid-content empty paragraph as a single small spacer', () => {
    const { html } = formatBlockNoteContent([
      paragraph('and real empty line after this one:'),
      paragraph(''),
      paragraph('is it giant space? with no elephant'),
    ]);

    expect(html).not.toContain('<p><br></p>');
    expect(html.match(/font-size:10px;line-height:10px;/g)).toHaveLength(1);
    expect(html).toContain(SPACER);
  });

  it('strips leading and trailing blank paragraphs', () => {
    const { html } = formatBlockNoteContent([
      paragraph(''),
      paragraph('only line'),
      paragraph(''),
    ]);

    expect(html).toBe('<p style="margin:0 0 10px 0;">only line</p>');
  });

  it('collapses consecutive blank paragraphs into one spacer', () => {
    const { html } = formatBlockNoteContent([
      paragraph('before'),
      paragraph(''),
      paragraph(''),
      paragraph(''),
      paragraph('after'),
    ]);

    expect(html.match(/font-size:10px;line-height:10px;/g)).toHaveLength(1);
  });

  it('gives every paragraph an explicit margin', () => {
    const { html } = formatBlockNoteContent([
      paragraph('one enter after this line'),
      paragraph('and real empty line after this one:'),
    ]);

    const openTags = html.match(/<p[^>]*>/g) ?? [];
    expect(openTags).toHaveLength(2);
    openTags.forEach((tag) => expect(tag).toContain('margin:0 0 10px 0;'));
  });

  it('keeps existing paragraph styles and lets indent margin-left win', () => {
    const { html } = formatBlockNoteContent([
      {
        ...paragraph('styled', { backgroundColor: 'yellow', textAlignment: 'center' }),
        children: [paragraph('indented')],
      },
    ]);

    expect(html).toContain('background-color:yellow');
    expect(html).toContain('text-align:center');
    expect(html).toMatch(/style="margin:0 0 10px 0;background-color:yellow/);
    // The indent declaration must come after the shorthand so it still applies.
    expect(html).toMatch(/style="margin:0 0 10px 0;margin-left: 25px"/);
  });

  it('leaves the plain-text rendering untouched', () => {
    const blocks = [paragraph('first'), paragraph(''), paragraph('second')];

    // The markdown side comes from a separate converter; assert it is byte-for-byte
    // what that converter emits so the email HTML rewrite cannot drift into it.
    expect(formatBlockNoteContent(blocks).text).toBe(convertBlockNoteToMarkdown(blocks));
  });

  it('returns empty html and text for a comment of only blank paragraphs', () => {
    expect(formatBlockNoteContent([paragraph(''), paragraph('')])).toEqual({ html: '', text: '' });
  });

  it('ignores non-string and blank input', () => {
    expect(normalizeBlockHtmlForEmail(undefined)).toBe('');
    expect(normalizeBlockHtmlForEmail('   ')).toBe('');
  });

  it('does not treat <pre> blocks as paragraphs', () => {
    const html = normalizeBlockHtmlForEmail('<pre><code class="language-js">const a = 1;</code></pre>');

    expect(html).toBe('<pre><code class="language-js">const a = 1;</code></pre>');
  });
});
