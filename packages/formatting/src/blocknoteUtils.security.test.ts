import { describe, expect, it } from 'vitest';
import {
  convertBlockNoteToHTML,
  convertBlockNoteToMarkdown,
  convertProseMirrorToHTML,
  convertProseMirrorToMarkdown,
  sanitizeHref,
  sanitizeImageSrc,
} from './blocknoteUtils';

const blockNoteLink = (href: string) => [
  {
    type: 'paragraph',
    content: [
      {
        type: 'link',
        href,
        content: [{ type: 'text', text: 'Click here' }],
      },
    ],
  },
];

const proseMirrorLink = (href: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Click here',
          marks: [{ type: 'link', attrs: { href } }],
        },
      ],
    },
  ],
});

describe('sanitizeHref', () => {
  it('allows http, https, mailto and scheme-less references', () => {
    expect(sanitizeHref('https://example.com')).toBe('https://example.com');
    expect(sanitizeHref('http://example.com')).toBe('http://example.com');
    expect(sanitizeHref('mailto:terms@example.com')).toBe('mailto:terms@example.com');
    expect(sanitizeHref('/terms')).toBe('/terms');
    expect(sanitizeHref('terms.html')).toBe('terms.html');
    expect(sanitizeHref('#section')).toBe('#section');
  });

  it('rejects dangerous and unknown schemes', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeHref('vbscript:msgbox(1)')).toBeNull();
    expect(sanitizeHref('file:///etc/passwd')).toBeNull();
    expect(sanitizeHref('chrome://settings')).toBeNull();
  });

  it('rejects protocol-relative URLs and scheme evasions', () => {
    expect(sanitizeHref('//evil.example/x')).toBeNull();
    expect(sanitizeHref('  javascript:alert(1)  ')).toBeNull();
    expect(sanitizeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(sanitizeHref('java\tscript:alert(1)')).toBeNull();
    expect(sanitizeHref('java\nscript:alert(1)')).toBeNull();
    expect(sanitizeHref('java\u0000script:alert(1)')).toBeNull();
  });

  it('allows data: images only through sanitizeImageSrc', () => {
    expect(sanitizeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(sanitizeImageSrc('javascript:alert(1)')).toBeNull();
    expect(sanitizeHref('data:image/png;base64,AAAA')).toBeNull();
  });
});

describe('link scheme hardening (T001/T002/T003)', () => {
  it('emits no anchor and preserves link text for javascript: in all four paths', () => {
    const html = convertBlockNoteToHTML(blockNoteLink('javascript:alert(1)'));
    expect(html).not.toContain('<a');
    expect(html).toContain('Click here');

    const markdown = convertBlockNoteToMarkdown(blockNoteLink('javascript:alert(1)'));
    expect(markdown).not.toContain('](');
    expect(markdown).toContain('Click here');

    const pmHtml = convertProseMirrorToHTML(proseMirrorLink('javascript:alert(1)'));
    expect(pmHtml).not.toContain('<a');
    expect(pmHtml).toContain('Click here');

    const pmMarkdown = convertProseMirrorToMarkdown(proseMirrorLink('javascript:alert(1)'));
    expect(pmMarkdown).not.toContain('](');
    expect(pmMarkdown).toContain('Click here');
  });

  it('rejects data:, vbscript:, file:, protocol-relative and evasion payloads', () => {
    for (const href of [
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example',
      '  javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
    ]) {
      expect(convertBlockNoteToHTML(blockNoteLink(href))).not.toContain('<a');
      expect(convertProseMirrorToHTML(proseMirrorLink(href))).not.toContain('<a');
    }
  });

  it('keeps safe hrefs and security attributes', () => {
    const html = convertBlockNoteToHTML(blockNoteLink('https://example.com/terms'));
    expect(html).toContain('href="https://example.com/terms"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');

    const mail = convertProseMirrorToHTML(proseMirrorLink('mailto:legal@example.com'));
    expect(mail).toContain('href="mailto:legal@example.com"');

    const relative = convertBlockNoteToHTML(blockNoteLink('/terms'));
    expect(relative).toContain('href="/terms"');

    const fragment = convertProseMirrorToHTML(proseMirrorLink('#section'));
    expect(fragment).toContain('href="#section"');
  });
});

describe('escape hardening (T004/T005/T006)', () => {
  it('escapes code block content (T004)', () => {
    const html = convertBlockNoteToHTML([
      {
        type: 'codeBlock',
        props: { language: 'html' },
        content: [{ type: 'text', text: '<script>alert(1)</script>' }],
      },
    ]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('escapes unknown-block string content and code language (T005)', () => {
    const unknown = convertBlockNoteToHTML([
      { type: 'mysteryBlock', content: '<img src=x onerror=alert(1)>' },
    ]);
    expect(unknown).toContain('&lt;img');
    expect(unknown).not.toContain('<img');

    const language = convertBlockNoteToHTML([
      {
        type: 'codeBlock',
        props: { language: 'js"><img src=x onerror=alert(1)>' },
        content: [{ type: 'text', text: 'const x = 1;' }],
      },
    ]);
    expect(language).not.toContain('<img');
    expect(language).toContain('&quot;&gt;');
  });

  it('cannot break out of style attributes with colour/alignment payloads (T006)', () => {
    const inline = convertBlockNoteToHTML([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'danger',
            styles: {
              textColor: 'red"><script>alert(1)</script>',
              backgroundColor: 'blue"><img src=x>',
            },
          },
        ],
      },
    ]);
    expect(inline).not.toContain('<script');
    expect(inline).not.toContain('<img');
    expect(inline).toContain('&quot;&gt;');

    const block = convertBlockNoteToHTML([
      {
        type: 'paragraph',
        props: {
          backgroundColor: 'red"><script>alert(1)</script>',
          textAlignment: 'left" onmouseover="alert(1)',
        },
        content: [{ type: 'text', text: 'danger' }],
      },
    ]);
    expect(block).not.toContain('<script');
    expect(block).not.toContain('onmouseover');
  });
});

describe('image scheme hardening (T007)', () => {
  it('preserves relative and data image srcs but drops javascript:', () => {
    const relative = convertBlockNoteToHTML([
      { type: 'image', props: { url: '/api/documents/view/file-123', name: 'a.png' } },
    ]);
    expect(relative).toContain('src="/api/documents/view/file-123"');

    const data = convertBlockNoteToHTML([
      { type: 'image', props: { url: 'data:image/png;base64,AAAA', name: 'a.png' } },
    ]);
    expect(data).toContain('src="data:image/png;base64,AAAA"');

    const rejected = convertBlockNoteToHTML([
      { type: 'image', props: { url: 'javascript:alert(1)', name: 'a.png' } },
    ]);
    expect(rejected).not.toContain('<img');
  });

  it('keeps existing paragraph, list, table and mention conversion intact', () => {
    const html = convertBlockNoteToHTML([
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello world', styles: { bold: true } }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'Item A' }] },
      { type: 'numberedListItem', content: [{ type: 'text', text: 'Item B' }] },
      {
        type: 'table',
        content: { rows: [{ cells: [[{ type: 'text', text: 'Cell' }]] }] },
      },
    ]);
    expect(html).toContain('<strong>Hello world</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<td>Cell</td>');
  });
});
