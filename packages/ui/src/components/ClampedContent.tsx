'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface ClampedContentProps {
  id?: string;
  /** Collapsed max height in px. Content shorter than this renders untouched. */
  maxHeight?: number;
  showMoreLabel: string;
  showLessLabel: string;
  /** Render children unclamped (e.g. while an inline composer inside needs position: sticky). */
  disabled?: boolean;
  children: React.ReactNode;
}

// Hysteresis: don't clamp content that barely exceeds the limit — a
// "Show more" hiding 30px of text is worse than the extra 30px.
const CLAMP_SLACK_PX = 60;

/**
 * Height-clamps tall content (long emails, pasted logs) behind a fade and a
 * "Show more" toggle. Content within the limit renders with no wrapper UI.
 */
export function ClampedContent({
  id,
  maxHeight = 400,
  showMoreLabel,
  showLessLabel,
  disabled = false,
  children,
}: ClampedContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isClampable, setIsClampable] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (disabled) return;
    const el = contentRef.current;
    if (!el) return;
    const check = () => setIsClampable(el.scrollHeight > maxHeight + CLAMP_SLACK_PX);
    check();
    // Guarded for jsdom (tests) and older embedded webviews.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxHeight]);

  const clamped = !disabled && isClampable && !expanded;

  if (disabled) {
    return <div id={id}>{children}</div>;
  }

  return (
    <div id={id}>
      <div
        ref={contentRef}
        className="relative"
        style={clamped ? { maxHeight, overflow: 'hidden' } : undefined}
      >
        {children}
        {clamped && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[rgb(var(--color-card))] to-transparent"
          />
        )}
      </div>
      {isClampable && (
        <button
          id={id ? `${id}-toggle` : undefined}
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 text-xs font-semibold text-[rgb(var(--color-primary-600))] hover:text-[rgb(var(--color-primary-700))]"
        >
          {clamped ? showMoreLabel : showLessLabel}
        </button>
      )}
    </div>
  );
}

export default ClampedContent;
