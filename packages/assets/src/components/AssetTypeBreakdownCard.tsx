'use client';

import { useEffect, useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAssetCountsByType } from '../actions/assetStatisticsActions';

interface AssetTypeBreakdownCardProps {
  /** Registry-aware label resolver shared with the asset list. */
  getTypeLabel: (slug: string) => string;
  /** Bump to refetch counts (e.g. after bulk actions or manual refresh). */
  refreshToken?: number;
  /** Slugs currently active in the type filter (rendered highlighted). */
  activeTypes?: string[];
  onSelectType?: (slug: string) => void;
}

/**
 * F313: by-type breakdown for the asset dashboard. Counts come grouped by
 * raw asset_type slug; labels resolve through the tenant registry so custom
 * types appear first-class instead of as raw slugs.
 */
export function AssetTypeBreakdownCard({
  getTypeLabel,
  refreshToken = 0,
  activeTypes = [],
  onSelectType,
}: AssetTypeBreakdownCardProps) {
  const { t } = useTranslation('msp/assets');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let mounted = true;
    getAssetCountsByType()
      .then((next) => {
        if (mounted) setCounts(next);
      })
      .catch((error) => {
        console.error('Error loading asset counts by type:', error);
        if (mounted) setCounts({});
      });
    return () => {
      mounted = false;
    };
  }, [refreshToken]);

  const items = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);

  if (counts !== null && items.length === 0) {
    return null;
  }

  return (
    <Card className="p-4" {...withDataAutomationId({ id: 'asset-type-breakdown' })}>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        {t('assetTypeBreakdown.title', { defaultValue: 'Assets by type' })}
      </p>
      {counts === null ? (
        <div className="mt-3 h-8 w-full animate-pulse rounded bg-gray-100" />
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map(([slug, count]) => {
            const isActive = activeTypes.includes(slug);
            return (
              <button
                key={slug}
                type="button"
                id={`asset-type-breakdown-${slug}`}
                onClick={onSelectType ? () => onSelectType(slug) : undefined}
                disabled={!onSelectType}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${
                  isActive
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                } ${onSelectType ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span>{getTypeLabel(slug)}</span>
                <span className="font-semibold">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
