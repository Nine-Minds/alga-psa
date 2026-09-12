import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuoteTermsContent, hasQuoteTermsContent } from './QuoteTermsContent';

const richParagraph = (href: string) => [
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Read our ', styles: {} },
      {
        type: 'link',
        href,
        content: [{ type: 'text', text: 'terms', styles: {} }],
      },
    ],
  },
];

describe('QuoteTermsContent', () => {
  it('renders structured terms as HTML with a live link', () => {
    const { container } = render(
      <QuoteTermsContent block={richParagraph('https://example.com/terms')} text={null} />,
    );

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/terms');
    expect(container.textContent).toContain('terms');
  });

  it('neutralizes a javascript: link while keeping its text', () => {
    const { container } = render(
      <QuoteTermsContent block={richParagraph('javascript:alert(1)')} text={null} />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('terms');
  });

  it('falls back to plain text with pre-line and the empty fallback', () => {
    const plain = render(<QuoteTermsContent text={'Line one\nLine two'} />);
    expect(plain.container.querySelector('p')?.className).toContain('whitespace-pre-wrap');
    expect(plain.container.textContent).toContain('Line one');

    const empty = render(<QuoteTermsContent text={null} emptyFallback="—" />);
    expect(empty.container.textContent).toBe('—');
  });

  it('exposes the section-visibility helper', () => {
    expect(hasQuoteTermsContent(null, 'text')).toBe(true);
    expect(hasQuoteTermsContent(richParagraph('https://example.com'), null)).toBe(true);
    expect(hasQuoteTermsContent([], null)).toBe(false);
    expect(hasQuoteTermsContent(null, '   ')).toBe(false);
  });
});
