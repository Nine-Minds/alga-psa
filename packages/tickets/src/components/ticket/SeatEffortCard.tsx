'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatMinutesAsHoursAndMinutes } from '@alga-psa/core';
import type { ColumnDefinition } from '@alga-psa/types';

/** Mirrors `SeatEffortSummary` (shared/lib/humanWork/seatEffortSummary.ts), the server's payload for this viewer. */
export interface SeatEffortCardData {
  viewer: 'msp' | 'client_it';
  clientItMinutes: number;
  mspMinutes?: number;
  combinedMinutes?: number;
  ownMinutes?: number;
  ownEntries?: Array<{ entry_id: string; start_time: string; end_time: string; minutes: number; notes: string | null }>;
}

/**
 * Effort on a ticket by organization (S28 / F069). Presentation only: the server built `effort` for this viewer, so a
 * total that the viewer may not see is simply absent from it and this card has nothing to hide. Shown on a ticket of a
 * seat arrangement behind the `co-managed-seat` capability (the container decides), through the standard Card and DataTable.
 */
export function SeatEffortCard({ effort }: { effort: SeatEffortCardData }) {
  const { t } = useTranslation('features/tickets');
  const duration = (minutes: number) => formatMinutesAsHoursAndMinutes(minutes);
  const rows: Array<{ id: string; label: string; minutes: number }> = [
    { id: 'client-it', label: t('seatEffort.clientIt', { defaultValue: 'Client IT' }), minutes: effort.clientItMinutes },
    ...(effort.mspMinutes === undefined ? [] : [{ id: 'msp', label: t('seatEffort.msp', { defaultValue: 'MSP' }), minutes: effort.mspMinutes }]),
    ...(effort.combinedMinutes === undefined ? [] : [{ id: 'combined', label: t('seatEffort.combined', { defaultValue: 'Combined' }), minutes: effort.combinedMinutes }]),
  ];
  const ownEntries = effort.ownEntries ?? [];
  const columns: ColumnDefinition<NonNullable<SeatEffortCardData['ownEntries']>[number]>[] = [
    { title: t('seatEffort.columns.date', { defaultValue: 'Date' }), dataIndex: 'start_time',
      render: (value: string) => new Date(value).toLocaleString() },
    { title: t('seatEffort.columns.duration', { defaultValue: 'Duration' }), dataIndex: 'minutes',
      render: (value: number) => duration(value) },
    { title: t('seatEffort.columns.notes', { defaultValue: 'Notes' }), dataIndex: 'notes',
      render: (value: string | null) => value ?? '' },
  ];

  return (
    <Card id="seat-effort-card" className="mt-4">
      <CardHeader>
        <CardTitle>{t('seatEffort.title', { defaultValue: 'Effort' })}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-1 text-sm">
          {rows.map((row) => (
            <div key={row.id} className="flex justify-between" id={`seat-effort-${row.id}`}>
              <dt className="text-[rgb(var(--color-text-600))]">{row.label}</dt>
              <dd className="font-medium">{duration(row.minutes)}</dd>
            </div>
          ))}
        </dl>
        {effort.viewer === 'client_it' && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">
              {t('seatEffort.yours', { defaultValue: 'Your time' })}: {duration(effort.ownMinutes ?? 0)}
            </p>
            {ownEntries.length > 0 && (
              <DataTable id="seat-effort-own-entries" data={ownEntries} columns={columns} pagination={false} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
