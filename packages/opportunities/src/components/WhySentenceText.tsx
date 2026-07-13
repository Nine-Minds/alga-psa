import React from 'react';
import type { WhySentence } from '@alga-psa/types';

/**
 * Renders a composed why-sentence. The composer guarantees at most one
 * emphasized clause per sentence; emphasis renders as the sentence's single
 * bold span so the fact that matters most reads at a glance.
 */
export function WhySentenceText({ why, className }: { why: WhySentence; className?: string }) {
  return (
    <span className={className}>
      {why.segments.map((segment, i) =>
        segment.emphasis ? (
          <strong key={i} className="font-semibold text-[rgb(var(--color-text-900))]">
            {segment.text}
          </strong>
        ) : (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        )
      )}
    </span>
  );
}
