'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import {
  listOpportunityTimeline,
  type IOpportunityTimelineEntry,
} from '../../actions/opportunityTimeline';

/** Read-only courtship timeline; entries accrue from completed actions, logged interactions, and sent drafts. */
export function OpportunityTimelinePanel({ opportunityId }: { opportunityId: string }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<IOpportunityTimelineEntry[] | null>(null);

  useEffect(() => {
    let mounted = true;
    listOpportunityTimeline(opportunityId)
      .then((rows) => mounted && setEntries(rows))
      .catch(() => mounted && setEntries([]));
    return () => {
      mounted = false;
    };
  }, [opportunityId]);

  if (entries === null) return <Skeleton className="h-20 w-full" />;
  if (entries.length === 0) {
    return (
      <p className="text-[13px] text-[rgb(var(--color-text-400))]">
        {t('opportunities.timeline.empty', 'Nothing logged yet. Completed actions land here on their own.')}
      </p>
    );
  }

  return (
    <ol className="space-y-0.5">
      {entries.map((entry) => (
        <li
          key={entry.interaction_id}
          className="flex gap-3 border-b border-[rgb(var(--color-border-100,241_245_249))] py-2 text-[13px] last:border-b-0"
        >
          <span className="w-20 flex-none font-mono text-[11px] text-[rgb(var(--color-text-400))]">
            {new Date(entry.interaction_date).toLocaleDateString()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-[rgb(var(--color-text-700))]">{entry.title}</span>
            {entry.user_name ? (
              <span className="text-[rgb(var(--color-text-400))]"> · {entry.user_name}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
