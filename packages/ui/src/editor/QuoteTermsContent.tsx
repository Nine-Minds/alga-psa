'use client';

import React from 'react';
import { convertBlockContentToHTML } from '@alga-psa/formatting/blocknoteUtils';
import { cn } from '../lib/utils';

/**
 * True when a quote carries authored structured terms. Mirrors the renderer's
 * own shape check so callers can decide whether to show the section at all.
 */
export function hasQuoteTermsContent(block: unknown, text?: string | null): boolean {
  if (Array.isArray(block)) return block.length > 0;
  if (block && typeof block === 'object' && (block as { type?: string }).type === 'doc') return true;
  return typeof text === 'string' && text.trim().length > 0;
}

function isStructuredBlockContent(block: unknown): boolean {
  if (Array.isArray(block)) return block.length > 0;
  return Boolean(block && typeof block === 'object' && (block as { type?: string }).type === 'doc');
}

export interface QuoteTermsContentProps {
  id?: string;
  /** Authored BlockNote block array (preferred). */
  block?: unknown;
  /** Legacy plain-text projection rendered when no structured content exists. */
  text?: string | null;
  className?: string;
  /** Classes for the plain-text / empty fallback paragraph. */
  textClassName?: string;
  /** Classes for the converted-HTML container. */
  richClassName?: string;
  /** Rendered in the fallback paragraph when neither block nor text is present. */
  emptyFallback?: React.ReactNode;
}

/**
 * Single display surface for quote Terms & Conditions.
 *
 * Both the MSP quote detail and the client portal render through this
 * component, so a rich value produces identical HTML on both. Conversion goes
 * through the shared, hardened `convertBlockContentToHTML`; plain-text quotes
 * keep their existing `whitespace-pre-wrap` presentation.
 */
export function QuoteTermsContent({
  id,
  block,
  text,
  className,
  textClassName,
  richClassName,
  emptyFallback = null,
}: QuoteTermsContentProps) {
  if (isStructuredBlockContent(block)) {
    const html = convertBlockContentToHTML(block);
    if (html && html.trim().length > 0) {
      return (
        <div
          id={id}
          className={cn('prose prose-sm max-w-none break-words', richClassName, className)}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
  }

  const plain = typeof text === 'string' ? text : '';
  if (plain.length > 0) {
    return (
      <p id={id} className={cn('whitespace-pre-wrap', textClassName, className)}>
        {plain}
      </p>
    );
  }

  if (emptyFallback !== null && emptyFallback !== undefined && emptyFallback !== '') {
    return (
      <p id={id} className={cn('whitespace-pre-wrap', textClassName, className)}>
        {emptyFallback}
      </p>
    );
  }

  return null;
}

export default QuoteTermsContent;
