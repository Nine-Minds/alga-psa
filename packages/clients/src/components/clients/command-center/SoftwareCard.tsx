'use client';

import React, { useCallback } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { BentoRow, BentoRowList, BentoStat, BentoTileEmpty, useTileData } from '@alga-psa/ui/components/bento';
import type { ClientSoftwareSummaryResponse } from '@alga-psa/types';
import { CardShell } from './PulseCards';
import type { GetClientSoftwareSummary } from './ClientSoftwareView';

type TFn = (key: string, options?: Record<string, unknown>) => string;

const TOP_TITLES = 5;

/** Command Center tile: top titles by asset count + total titles, linking to the Software focus view. */
export default function SoftwareCard({ id, clientId, getSummary, onOpen, className, t }: {
  id: string;
  clientId: string;
  getSummary: GetClientSoftwareSummary;
  onOpen: (() => void) | null;
  className?: string;
  t: TFn;
}) {
  const fallback = useCallback(
    () => t('clientCommandCenter.software.loadError', { defaultValue: 'Could not load software inventory.' }),
    [t],
  );
  const { data, error } = useTileData<ClientSoftwareSummaryResponse>(
    () => getSummary({ clientId, page: 1, sortBy: 'assets', sortDir: 'desc' }) as Promise<ClientSoftwareSummaryResponse>,
    [clientId, getSummary],
    fallback,
  );
  const top = data?.rows.slice(0, TOP_TITLES) ?? [];

  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.software', { defaultValue: 'Software' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open' }), onClick: onOpen } : null}
      className={className}
      footerLinks={[
        onOpen
          ? {
            id: 'software',
            label: t('clientCommandCenter.software.viewAll', { defaultValue: 'All software' }),
            icon: <ArrowUpRight className="w-3 h-3" aria-hidden="true" />,
            onClick: onOpen,
          }
          : null,
      ]}
    >
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !data ? null : data.total === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('clientSoftware.empty', { defaultValue: 'No software inventory yet — inventory is collected per device' })}
        </BentoTileEmpty>
      ) : (
        <>
          <div className="flex gap-6 mb-3">
            <BentoStat value={data.total} label={t('clientCommandCenter.software.titles', { defaultValue: 'titles' })} />
          </div>
          <BentoRowList>
            {top.map((row) => (
              <BentoRow
                key={row.software_id}
                id={`${id}-row-${row.software_id}`}
                meta={t('clientCommandCenter.software.assetsMeta', {
                  defaultValue_one: '1 asset',
                  defaultValue_other: '{{count}} assets',
                  count: row.asset_count,
                })}
              >
                <span className="truncate">{row.title}</span>
              </BentoRow>
            ))}
          </BentoRowList>
        </>
      )}
    </CardShell>
  );
}
