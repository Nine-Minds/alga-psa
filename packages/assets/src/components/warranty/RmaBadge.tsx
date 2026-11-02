'use client';

import React, { useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { recordPath, type RmaStatus } from '@alga-psa/types';
import { BentoChip } from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getOpenRmaBadges } from '../../actions/assetWarrantyActions';
import type { AssetRmaBadge } from '../../lib/warranty/warrantyReads';
import { humanizeRmaStatus } from './warrantyDisplay';

/** Open-RMA badges for a page of assets, keyed by asset id. Silent (empty) on any refusal or failure. */
export function useRmaBadges(assetIds: readonly string[]): Map<string, AssetRmaBadge> {
  const key = useMemo(() => Array.from(new Set(assetIds)).sort(), [assetIds]);
  const { data } = useSWR(key.length > 0 ? ['rma', 'badges', ...key] : null, async () => {
    try {
      const result = await getOpenRmaBadges(key);
      return Array.isArray(result) ? result : [];
    } catch {
      return [] as AssetRmaBadge[];
    }
  });
  return useMemo(() => new Map((data ?? []).map((b) => [b.asset_id, b])), [data]);
}

/** "RMA RMA-00007 · Sent to vendor". */
export function RmaBadge({ badge, id }: { badge: AssetRmaBadge | undefined; id?: string }) {
  const { t } = useTranslation('msp/assets');
  if (!badge) return null;
  const status = t(`enums.rmaStatus.${badge.status as RmaStatus}`, { defaultValue: humanizeRmaStatus(badge.status) });
  const label = t('warranty.badge.label', {
    defaultValue: 'RMA {{number}} · {{status}}',
    number: badge.rma_number,
    status,
  });
  return (
    <span id={id} className="inline-flex max-w-full">
      <Link href={recordPath('rma', badge.rma_id)} onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full">
        <BentoChip tone="warning">
          <span className="inline-flex max-w-[240px] items-center gap-1 truncate">
            <RotateCcw className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{label}</span>
          </span>
        </BentoChip>
      </Link>
    </span>
  );
}
