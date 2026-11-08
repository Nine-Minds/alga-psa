'use client';

import React, { useMemo } from 'react';
import useSWR from 'swr';
import { PackageOpen } from 'lucide-react';
import { BentoChip } from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getOpenCustodyBadges } from '../../actions/assetCustodyActions';
import type { OpenCustodyBadge } from '../../lib/custody/service';
import { custodyOutcome } from './custodyClient';

/** Open-custody badges for a page of assets, keyed by asset id. Silent (empty) on any refusal. */
export function useCustodyBadges(assetIds: readonly string[]): Map<string, OpenCustodyBadge> {
  const key = useMemo(() => Array.from(new Set(assetIds)).sort(), [assetIds]);
  const { data } = useSWR(key.length > 0 ? ['custody', 'badges', ...key] : null, async () => {
    const outcome = custodyOutcome<OpenCustodyBadge[]>(await getOpenCustodyBadges(key));
    return outcome.ok ? outcome.data : [];
  });
  return useMemo(() => new Map((data ?? []).map((b) => [b.asset_id, b])), [data]);
}

/** "In office - Main Office / Shelf B3" or "With vendor". */
export function CustodyBadge({ badge, id }: { badge: OpenCustodyBadge | undefined; id?: string }) {
  const { t } = useTranslation('msp/assets');
  if (!badge) return null;
  const withVendor = badge.state === 'with_vendor';
  const label = withVendor
    ? t('custody.badge.withVendor', { defaultValue: 'With vendor' })
    : badge.location_label
      ? t('custody.badge.inOfficeAt', { defaultValue: 'In office - {{location}}', location: badge.location_label })
      : t('custody.badge.inOffice', { defaultValue: 'In office' });
  return (
    <span id={id} className="inline-flex max-w-full">
      <BentoChip tone={withVendor ? 'warning' : 'info'} className="min-w-0 max-w-full overflow-hidden">
        <span className="flex min-w-0 max-w-[200px] items-center gap-1" title={label}>
          <PackageOpen className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      </BentoChip>
    </span>
  );
}
