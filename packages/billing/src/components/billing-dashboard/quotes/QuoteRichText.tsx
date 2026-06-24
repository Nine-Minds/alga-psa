'use client';

import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { sanitizeRichTextHtml } from '../../../lib/invoice-template-ast/sanitizeRichTextHtml';

interface QuoteRichTextProps {
  content?: string | null;
  className?: string;
  emptyText?: string;
}

// Must match every element sanitizeRichTextHtml can emit so the on-screen
// preview stays in sync with the PDF output.
const DOMPURIFY_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ol', 'ul', 'li',
  'a', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'hr',
  'figure', 'figcaption', 'img',
  'table', 'tr', 'td',
  'pre', 'code',
  'div', 'input',
];

const DOMPURIFY_ATTR = [
  'href', 'target', 'rel',
  'style', 'class', 'data-list',
  'src', 'alt', 'width', 'height',
  'colspan', 'rowspan',
  'type', 'checked', 'disabled',
];

const QuoteRichText: React.FC<QuoteRichTextProps> = ({ content, className, emptyText = '—' }) => {
  const sanitized = useMemo(() => {
    const value = (content ?? '').trim();
    if (!value) return '';
    // Convert BlockNote JSON → HTML or sanitize legacy Quill HTML (no DOM needed).
    const html = sanitizeRichTextHtml(value);
    if (!html) return '';
    if (typeof window === 'undefined') return html;
    // Second pass: belt-and-suspenders client-side defense.
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: DOMPURIFY_TAGS, ALLOWED_ATTR: DOMPURIFY_ATTR }).trim();
  }, [content]);

  if (!sanitized) {
    return <p className={className}>{emptyText}</p>;
  }

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
};

export default QuoteRichText;
