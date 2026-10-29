'use client';

import { useEffect, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { COMANAGED_HISTORY_LIMIT } from '@/lib/co-managed/relationshipHistory';
import {
  getCoManagedRelationshipHistory,
  type CoManagedHistoryEntry,
} from '@/lib/actions/coManagedWorkspaceActions';

/** An event type with no label yet reads as words ("some_new_event" -> "Some new event"). */
const humanize = (type: string): string => {
  const words = type.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Relationship events, newest first (the action caps them at 50). Each row
 * shows what happened, which revision, when, and who: "You" for the viewing
 * workspace, otherwise the counterpart's name. No identifiers are rendered. */
export default function CoManagedRelationshipHistory({ idPrefix, clientId, relationshipId }: {
  idPrefix: string;
  clientId?: string;
  relationshipId?: string | null;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const [entries, setEntries] = useState<CoManagedHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setEntries(null);
    setFailed(false);
    getCoManagedRelationshipHistory({ clientId, relationshipId: relationshipId ?? undefined })
      .then((result) => { if (live) setEntries(result.entries); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [clientId, relationshipId]);

  const columns: ColumnDefinition<CoManagedHistoryEntry>[] = [
    {
      title: t('coManaged.history.event', { defaultValue: 'Event' }),
      dataIndex: 'eventType',
      render: (value: string) => t(`coManaged.history.events.${value}`, { defaultValue: humanize(value) }),
    },
    { title: t('coManaged.history.revision', { defaultValue: 'Revision' }), dataIndex: 'revision' },
    {
      title: t('coManaged.history.when', { defaultValue: 'When' }),
      dataIndex: 'occurredAt',
      render: (value: string) => formatDate(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }),
    },
    {
      title: t('coManaged.history.by', { defaultValue: 'By' }),
      dataIndex: 'partyName',
      render: (_value: string | null, row) => row.party === 'you'
        ? t('coManaged.history.you', { defaultValue: 'You' })
        : row.partyName ?? t('coManaged.history.provider', { defaultValue: 'Provider' }),
    },
  ];

  return (
    <Card id={`${idPrefix}-history`}>
      <CardHeader><CardTitle>{t('coManaged.history.title', { defaultValue: 'Relationship history' })}</CardTitle></CardHeader>
      <CardContent>
        {failed ? (
          <p role="alert" className="text-sm text-[rgb(var(--color-text-600))]">
            {t('coManaged.history.error', { defaultValue: 'Relationship history could not be loaded.' })}
          </p>
        ) : entries && entries.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('coManaged.history.empty', { defaultValue: 'No relationship events yet.' })}
          </p>
        ) : (
          // LEVERAGE: friction datatable-pagination-false — pagination={false} only hides the pager; rows still slice to pageSize (default 10). Other pagination={false} call sites with >10 rows are latently truncated; engine should skip the pagination row model when disabled.
          <DataTable
            id={`${idPrefix}-history-table`}
            data={entries ?? []}
            columns={columns}
            pagination={false}
            pageSize={COMANAGED_HISTORY_LIMIT}
          />
        )}
      </CardContent>
    </Card>
  );
}
