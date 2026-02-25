import { convertProseMirrorToHTML, convertBlockContentToHTML } from './blocknoteUtils';

describe('convertProseMirrorToHTML', () => {
  it('renders a simple paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    };
    expect(convertProseMirrorToHTML(doc)).toBe('<p>Hello world</p>');
  });

  it('renders an empty paragraph as <br>', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(convertProseMirrorToHTML(doc)).toBe('<p><br></p>');
  });

  it('renders headings at correct levels', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Section' }] },
      ],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h3>Section</h3>');
  });

  it('renders bold, italic, underline, strike, and code marks', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'underline', marks: [{ type: 'underline' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'strike', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'code', marks: [{ type: 'code' }] },
        ],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>underline</u>');
    expect(html).toContain('<s>strike</s>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders combined marks on a single text node', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'styled',
          marks: [{ type: 'bold' }, { type: 'italic' }],
        }],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('<em>');
    expect(html).toContain('<strong>');
    expect(html).toContain('styled');
  });

  it('renders link marks with href', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Click here',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        }],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('>Click here</a>');
  });

  it('renders bullet lists', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'bullet_list',
        content: [
          { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item A' }] }] },
          { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item B' }] }] },
        ],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li><p>Item A</p></li>');
    expect(html).toContain('<li><p>Item B</p></li>');
    expect(html).toContain('</ul>');
  });

  it('renders ordered lists with start attribute', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'ordered_list',
        attrs: { order: 3 },
        content: [
          { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step' }] }] },
        ],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<li><p>Step</p></li>');
  });

  it('renders code blocks', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'code_block',
        content: [{ type: 'text', text: 'const x = 1;' }],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('<pre><code>const x = 1;</code></pre>');
  });

  it('renders blockquotes', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted text' }] }],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<p>Quoted text</p>');
    expect(html).toContain('</blockquote>');
  });

  it('renders mention nodes with styled badge', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mention',
          attrs: { userId: 'user-1', username: 'alice', displayName: 'Alice Smith' },
        }],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('@alice');
    expect(html).toContain('data-user-id="user-1"');
    expect(html).toContain('background-color:#dbeafe');
  });

  it('renders mention without username using displayName', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mention',
          attrs: { userId: 'user-2', displayName: 'Bob Jones' },
        }],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('@Bob Jones');
  });

  it('preserves emoji unicode characters in text', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello 😊 world 🎉' }],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('😊');
    expect(html).toContain('🎉');
  });

  it('escapes HTML entities in text content', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '<script>alert("xss")</script>' }],
      }],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles JSON string input', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From string' }] }],
    });
    expect(convertProseMirrorToHTML(doc)).toContain('From string');
  });

  it('returns error for null input', () => {
    expect(convertProseMirrorToHTML(null)).toContain('[No content]');
  });

  it('returns error for non-doc object', () => {
    expect(convertProseMirrorToHTML({ type: 'paragraph' })).toContain('[Invalid ProseMirror document]');
  });

  it('renders horizontal rules', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'horizontal_rule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    };
    const html = convertProseMirrorToHTML(doc);
    expect(html).toContain('<hr>');
  });
});

describe('convertBlockContentToHTML', () => {
  it('auto-detects ProseMirror format', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'PM content' }] }],
    };
    const html = convertBlockContentToHTML(doc);
    expect(html).toContain('PM content');
    expect(html).not.toContain('[Invalid');
  });

  it('auto-detects BlockNote format', () => {
    const blocks = [{
      type: 'paragraph',
      props: { textAlignment: 'left' },
      content: [{ type: 'text', text: 'BN content', styles: {} }],
    }];
    const html = convertBlockContentToHTML(blocks);
    expect(html).toContain('BN content');
  });

  it('auto-detects ProseMirror from JSON string', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stringified PM' }] }],
    });
    const html = convertBlockContentToHTML(json);
    expect(html).toContain('Stringified PM');
    expect(html).not.toContain('[Invalid');
  });

  it('auto-detects BlockNote from JSON string', () => {
    const json = JSON.stringify([{
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text: 'Stringified BN', styles: {} }],
    }]);
    const html = convertBlockContentToHTML(json);
    expect(html).toContain('Stringified BN');
  });

  it('returns error for null input', () => {
    expect(convertBlockContentToHTML(null)).toContain('[No content]');
  });
});
