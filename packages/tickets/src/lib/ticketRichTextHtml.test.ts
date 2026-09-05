import { describe, expect, it } from 'vitest';
import { extractTicketRichTextHtml } from './ticketRichTextHtml';

describe('extractTicketRichTextHtml', () => {
  it('keeps inline formatting when extracting HTML', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Restart ', styles: {} },
          { type: 'text', text: 'now', styles: { bold: true } },
          { type: 'text', text: ' then ', styles: {} },
          { type: 'text', text: 'wait', styles: { italic: true } },
        ],
      },
    ];

    expect(extractTicketRichTextHtml(JSON.stringify(blocks))).toBe(
      '<p>Restart <strong>now</strong> then <em>wait</em></p>'
    );
  });

  it('keeps headings, lists and nesting when extracting HTML', () => {
    const blocks = [
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Steps', styles: {} }] },
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'Parent', styles: {} }],
        children: [
          { type: 'bulletListItem', content: [{ type: 'text', text: 'Child', styles: {} }] },
        ],
      },
      { type: 'numberedListItem', content: [{ type: 'text', text: 'First', styles: {} }] },
    ];

    const html = extractTicketRichTextHtml(JSON.stringify(blocks));

    expect(html).toContain('<h2>Steps</h2>');
    expect(html).toContain('<ul><li>Parent<ul><li>Child</li></ul></li></ul>');
    expect(html).toContain('<ol><li>First</li></ol>');
  });

  it('keeps link hrefs and mention badges when extracting HTML', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: 'https://example.com/tickets/1',
            content: [{ type: 'text', text: 'the ticket', styles: {} }],
          },
          { type: 'text', text: ' for ', styles: {} },
          { type: 'mention', props: { userId: 'u1', username: 'glinda', displayName: 'Glinda' } },
        ],
      },
    ];

    const html = extractTicketRichTextHtml(JSON.stringify(blocks));

    expect(html).toContain('<a href="https://example.com/tickets/1"');
    expect(html).toContain('>the ticket</a>');
    expect(html).toContain('@glinda');
  });

  it('extracts HTML from ProseMirror documents written by the mobile editor', () => {
    const document = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Mobile rich text', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet item' }] }],
            },
          ],
        },
      ],
    };

    const html = extractTicketRichTextHtml(JSON.stringify(document));

    expect(html).toContain('<p><strong>Mobile rich text</strong></p>');
    expect(html).toContain('<ul><li><p>Bullet item</p></li></ul>');
  });

  it('wraps legacy plain-text notes in a paragraph and escapes markup', () => {
    expect(extractTicketRichTextHtml('Legacy description')).toBe('<p>Legacy description</p>');
    expect(extractTicketRichTextHtml('a < b & c')).toBe('<p>a &lt; b &amp; c</p>');
  });

  it('drops the blank paragraphs BlockNote leaves at the edges', () => {
    const blocks = [
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: '', styles: {} }] },
    ];

    expect(extractTicketRichTextHtml(JSON.stringify(blocks))).toBe('<p>Body</p>');
  });

  it('returns an empty string of HTML for missing or blank content', () => {
    expect(extractTicketRichTextHtml(null)).toBe('');
    expect(extractTicketRichTextHtml(undefined)).toBe('');
    expect(extractTicketRichTextHtml('')).toBe('');
    expect(extractTicketRichTextHtml('   ')).toBe('');
    expect(extractTicketRichTextHtml([])).toBe('');
  });
});
