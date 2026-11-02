'use client';

import { useMemo } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface AssetTypeBreakdownCardProps {
  /** Registry-aware label resolver shared with the asset list. */
  getTypeLabel: (slug: string) => string;
  /** Counts returned with the current asset list, or null while loading. */
  counts: Record<string, number> | null;
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
  counts,
  activeTypes = [],
  onSelectType,
}: AssetTypeBreakdownCardProps) {
  const { t } = useTranslation('msp/assets');

  const items = useMemo(() => {
    const merged = new Map(Object.entries(counts ?? {}));
    // A selected type can legitimately drop out of the GROUP BY once other
    // filters exclude all of its assets. Keep it visible at 0 so the active chip
    // the user just clicked never disappears from under them.
    for (const slug of activeTypes) {
      if (!merged.has(slug)) merged.set(slug, 0);
    }
    return Array.from(merged.entries()).sort((a, b) => b[1] - a[1]);
  }, [counts, activeTypes]);

  if (counts !== null && items.length === 0) {
    return null;
  }

  return (
    <Card className="p-4" {...withDataAutomationId({ id: 'asset-type-breakdown' })}>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        {t('assetTypeBreakdown.title', { defaultValue: 'Assets by type' })}
      </p>
      {counts === null ? (
        <div className="mt-3 h-8 w-full animate-pulse rounded skeleton-fill" />
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
