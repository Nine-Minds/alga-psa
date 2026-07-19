import { describe, expect, it } from 'vitest';

import {
  applyMergeFields,
  renderPostText,
  markdownToHtml,
  markdownToText,
} from '../src/lib/render';

describe('applyMergeFields', () => {
  it('substitutes contact and client fields', () => {
    const out = applyMergeFields(
      'Hi {{contact.first_name}} {{contact.last_name}} of {{client.name}} ({{contact.email}})',
      {
        contact: { full_name: 'Ada Lovelace', email: 'ada@example.com' },
        client: { client_name: 'Analytical Engines Ltd' },
      },
    );
    expect(out).toBe('Hi Ada Lovelace of Analytical Engines Ltd (ada@example.com)');
  });

  it('splits first/last name on whitespace and joins the remainder as last name', () => {
    const out = applyMergeFields('{{contact.first_name}}|{{contact.last_name}}', {
      contact: { full_name: 'Mary Jane Watson', email: null },
    });
    expect(out).toBe('Mary|Jane Watson');
  });

  it('treats a single-word name as first name only', () => {
    const out = applyMergeFields('{{contact.first_name}}|{{contact.last_name}}', {
      contact: { full_name: 'Prince', email: null },
    });
    expect(out).toBe('Prince|');
  });

  it('supports full_name and collapses extra whitespace before splitting', () => {
    const out = applyMergeFields('{{contact.full_name}} / {{contact.first_name}}', {
      contact: { full_name: '  Ada   Lovelace  ', email: null },
    });
    // full_name renders verbatim; first_name splits the trimmed value.
    expect(out).toBe('  Ada   Lovelace   / Ada');
  });

  it('renders empty string for null contact/client fields', () => {
    const out = applyMergeFields('{{contact.first_name}}|{{contact.email}}|{{client.name}}', {
      contact: { full_name: null, email: null },
      client: { client_name: null },
    });
    expect(out).toBe('||');
  });

  it('renders empty string when contact/client are omitted entirely', () => {
    expect(applyMergeFields('{{contact.first_name}} {{client.name}}', {})).toBe(' ');
  });

  it('renders empty string for unknown fields', () => {
    const out = applyMergeFields('{{contact.middle_name}} {{nonsense}}', {
      contact: { full_name: 'Ada Lovelace', email: 'ada@example.com' },
    });
    expect(out).toBe(' ');
  });

  it('resolves extra context keys as bare merge fields', () => {
    const out = applyMergeFields('Unsubscribe: {{unsubscribe_url}}', {
      extra: { unsubscribe_url: 'https://example.com/u/123' },
    });
    expect(out).toBe('Unsubscribe: https://example.com/u/123');
  });

  it('tolerates whitespace inside the braces', () => {
    const out = applyMergeFields('{{ contact.first_name }}', {
      contact: { full_name: 'Ada Lovelace', email: null },
    });
    expect(out).toBe('Ada');
  });

  it('leaves text without merge fields untouched', () => {
    expect(applyMergeFields('plain {text} {{ }}', {})).toBe('plain {text} {{ }}');
  });
});

describe('renderPostText', () => {
  const content = {
    body_markdown: 'Base body for everyone',
    channel_variants: {
      linkedin: 'LinkedIn-specific text',
      x: '',
    },
  };

  it('prefers the channel variant when one exists for the platform', () => {
    expect(renderPostText(content, 'linkedin')).toBe('LinkedIn-specific text');
  });

  it('falls back to the base body when the platform has no variant', () => {
    expect(renderPostText(content, 'mastodon')).toBe('Base body for everyone');
  });

  it('falls back to the base body when the variant is blank', () => {
    expect(renderPostText(content, 'x')).toBe('Base body for everyone');
    expect(
      renderPostText({ ...content, channel_variants: { x: '   ' } }, 'x'),
    ).toBe('Base body for everyone');
  });

  it('tolerates a missing channel_variants map', () => {
    expect(
      renderPostText({ body_markdown: 'Base', channel_variants: undefined as never }, 'linkedin'),
    ).toBe('Base');
  });
});

describe('markdownToHtml', () => {
  it('renders paragraphs split on blank lines', () => {
    expect(markdownToHtml('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>');
  });

  it('joins consecutive lines in a paragraph with <br>', () => {
    expect(markdownToHtml('one\ntwo')).toBe('<p>one<br>two</p>');
  });

  it('renders bold, italic, and links inline', () => {
    const html = markdownToHtml('A **bold** and *italic* with [a link](https://example.com).');
    expect(html).toBe(
      '<p>A <strong>bold</strong> and <em>italic</em> with <a href="https://example.com">a link</a>.</p>',
    );
  });

  it('renders dash bullets as a list', () => {
    expect(markdownToHtml('- first\n- second')).toBe('<ul><li>first</li><li>second</li></ul>');
  });

  it('closes the list when a paragraph follows', () => {
    expect(markdownToHtml('- item\nafter')).toBe('<ul><li>item</li></ul>\n<p>after</p>');
  });

  it('escapes injected HTML instead of rendering it', () => {
    const html = markdownToHtml('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes HTML inside bold and link text', () => {
    const html = markdownToHtml('**<img src=x onerror=alert(1)>** [<b>click</b>](https://x.test)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>click</b>');
    expect(html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
    expect(html).toContain('<a href="https://x.test">&lt;b&gt;click&lt;/b&gt;</a>');
  });

  it('does not create anchors for non-http(s) URLs', () => {
    const html = markdownToHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('<a ');
  });

  it('normalizes CRLF line endings', () => {
    expect(markdownToHtml('one\r\n\r\ntwo')).toBe('<p>one</p>\n<p>two</p>');
  });
});

describe('markdownToText', () => {
  it('strips bold and italic markers', () => {
    expect(markdownToText('**bold** and *italic*')).toBe('bold and italic');
  });

  it('rewrites links as text followed by the URL in parentheses', () => {
    expect(markdownToText('see [the docs](https://example.com/docs)')).toBe(
      'see the docs (https://example.com/docs)',
    );
  });

  it('normalizes bullets to dash-prefixed lines', () => {
    expect(markdownToText('* first\n- second')).toBe('- first\n- second');
  });

  it('leaves plain text untouched', () => {
    expect(markdownToText('nothing to do here')).toBe('nothing to do here');
  });
});
