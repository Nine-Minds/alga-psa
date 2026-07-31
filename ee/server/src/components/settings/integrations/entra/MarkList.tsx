'use client';

import React from 'react';
import { Check, Minus, X } from 'lucide-react';

/**
 * A statement list where the mark carries the meaning.
 *
 * The disclosure, the chooser's prerequisites and the disconnect dialog all say
 * the same kind of thing — "this will happen", "this will never happen", "this
 * one depends" — and a bulleted list flattens all three into the same grey. A
 * green tick for what Alga does, a red cross for what it will never do, and a
 * dash for what needs a decision reads at a glance, which is the whole point of
 * putting it in front of someone before they authorize anything.
 */
export type EntraMark = 'affirm' | 'deny' | 'caution';

export interface MarkListItem {
  /** Stable key; the i18n key of the statement is the natural choice. */
  id: string;
  mark: EntraMark;
  text: React.ReactNode;
}

const MARK_ICONS: Record<EntraMark, typeof Check> = {
  affirm: Check,
  deny: X,
  caution: Minus,
};

const MARK_CLASSES: Record<EntraMark, string> = {
  affirm: 'text-success',
  deny: 'text-destructive',
  caution: 'text-muted-foreground',
};

interface MarkListProps {
  items: MarkListItem[];
  id?: string;
  className?: string;
}

export function MarkList({ items, id, className }: MarkListProps): React.JSX.Element {
  return (
    <ul className={`space-y-1.5 ${className || ''}`} id={id}>
      {items.map((item) => {
        const Icon = MARK_ICONS[item.mark];
        return (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            <Icon
              className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${MARK_CLASSES[item.mark]}`}
              aria-hidden="true"
              data-mark={item.mark}
            />
            <span className="min-w-0 text-muted-foreground">{item.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default MarkList;
