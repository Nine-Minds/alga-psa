'use client';

import React from 'react';
import { MessageSquarePlus } from 'lucide-react';

export interface StickyComposerDockProps {
  id: string;
  /** Which edge it pins to. 'top' sits under the section's own button. */
  side?: 'top' | 'bottom';
  visible: boolean;
  /** Collapsed shows the one-line bar; expanded swaps in the real composer. */
  expanded: boolean;
  /** Collapsed-state label. Only meaningful on the bottom dock. */
  placeholder?: string;
  onExpand?: () => void;
  children: React.ReactNode;
}

/**
 * Sticky housing for a comment composer. Whichever edge it pins to, an open
 * draft follows the reader down a long thread instead of scrolling away.
 * Collapsed it renders as a text field — that's the affordance, so nobody has
 * to guess it's where you type.
 */
export function StickyComposerDock({
  id,
  side = 'bottom',
  visible,
  expanded,
  placeholder,
  onExpand,
  children,
}: StickyComposerDockProps) {
  if (!visible) return null;

  return (
    <div
      id={id}
      className={`sticky z-20 pointer-events-none ${side === 'top' ? 'top-2 pb-3' : 'bottom-2 pt-3'}`}
    >
      {expanded ? (
        <div className="pointer-events-auto max-h-[70vh] overflow-y-auto rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-lg">
          {children}
        </div>
      ) : (
        <button
          id={`${id}-trigger`}
          type="button"
          onClick={onExpand}
          className="pointer-events-auto flex w-full cursor-text items-center gap-2 rounded-lg border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] px-3 py-2.5 text-left text-sm text-[rgb(var(--color-text-400))] shadow-lg transition-colors hover:border-[rgb(var(--color-primary-400))] hover:text-[rgb(var(--color-text-500))] focus:outline-none focus:border-[rgb(var(--color-primary-500))] focus:ring-2 focus:ring-[rgb(var(--color-primary-200))]"
        >
          <MessageSquarePlus className="h-4 w-4 flex-shrink-0" />
          {placeholder}
        </button>
      )}
    </div>
  );
}

export default StickyComposerDock;
