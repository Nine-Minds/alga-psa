import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WhySentence } from '@alga-psa/types';

/**
 * Renders a composed why-sentence. The composer guarantees at most one
 * emphasized clause per sentence; emphasis renders as the sentence's single
 * bold span so the fact that matters most reads at a glance.
 */
export function WhySentenceText({ why, className }: { why: WhySentence; className?: string }) {
  const { t } = useTranslation('msp/opportunities');

  return (
    <span className={className}>
      {why.segments.map((segment, i) =>
        segment.emphasis ? (
          <strong key={i} className="font-semibold text-[rgb(var(--color-text-900))]">
            {t(segment.message.key, segment.message.params)}
          </strong>
        ) : (
          <React.Fragment key={i}>{t(segment.message.key, segment.message.params)}</React.Fragment>
        )
      )}
    </span>
  );
}
