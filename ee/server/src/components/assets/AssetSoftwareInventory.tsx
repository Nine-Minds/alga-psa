'use client';

/**
 * Asset Software Inventory Component - EE Component
 *
 * Displays the software inventory for RMM-managed workstations and servers,
 * read from the normalized asset_software table (every RMM ingestion writes it;
 * the legacy installed_software JSON is not written by all of them).
 */

import React, { useEffect, useState } from 'react';
import { Package, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isTileActionError } from '@alga-psa/ui/components/bento';
import { getAssetSoftware } from '@alga-psa/assets/actions/softwareActions';
import type { AssetSoftwareDisplayItem, AssetSoftwareListResponse } from '@alga-psa/types';
import type { Asset } from '@/interfaces/asset.interfaces';

interface AssetSoftwareInventoryProps {
  asset: Asset;
  className?: string;
}

/** Rows fetched per query; the list scrolls and reports "showing N of total". */
export const ASSET_SOFTWARE_DRAWER_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 300;

const isInventoryAsset = (asset: Asset): boolean =>
  Boolean(asset.rmm_provider && asset.rmm_device_id)
  && (asset.asset_type === 'workstation' || asset.asset_type === 'server');

async function loadSoftware(assetId: string, search: string): Promise<AssetSoftwareListResponse | null> {
  const result = await getAssetSoftware({
    asset_id: assetId,
    search: search || undefined,
    limit: ASSET_SOFTWARE_DRAWER_LIMIT,
  });
  // Permission or lookup failures hide the panel like an empty inventory.
  return isTileActionError(result) ? null : (result as AssetSoftwareListResponse);
}

/**
 * Asset Software Inventory
 */
export function AssetSoftwareInventory({ asset, className = '' }: AssetSoftwareInventoryProps) {
  const { t } = useTranslation('msp/assets');
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  // Unfiltered inventory drives visibility, the count chip and the preview.
  const [inventory, setInventory] = useState<AssetSoftwareListResponse | null>(null);
  const [matches, setMatches] = useState<AssetSoftwareListResponse | null>(null);
  const enabled = isInventoryAsset(asset);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadSoftware(asset.asset_id, '')
      .then((result) => { if (!cancelled) setInventory(result); })
      .catch((err: unknown) => console.error('Failed to load asset software:', err));
    return () => { cancelled = true; };
  }, [asset.asset_id, enabled]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (!enabled || !search) {
      setMatches(null);
      return;
    }
    let cancelled = false;
    loadSoftware(asset.asset_id, search)
      .then((result) => { if (!cancelled) setMatches(result); })
      .catch((err: unknown) => console.error('Failed to search asset software:', err));
    return () => { cancelled = true; };
  }, [asset.asset_id, enabled, search]);

  if (!enabled || !inventory || inventory.total === 0) {
    return null;
  }

  const allSoftware: AssetSoftwareDisplayItem[] = inventory.software;
  // Until the first search result lands, keep showing the last list instead of flashing "no match".
  const listed = search && matches ? matches : inventory;
  const displaySoftware = listed.software;

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header */}
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-[rgb(var(--color-primary-500))]" />
          <span className="font-medium">{t('assetSoftwareInventory.heading')}</span>
          <span className="chip-primary inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full">
            {t('assetSoftwareInventory.appsCount', { count: inventory.total })}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-gray-200">
          {/* Search */}
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder={t('assetSoftwareInventory.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Software List */}
          <div className="max-h-80 overflow-y-auto">
            {displaySoftware.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">
                {t('assetSoftwareInventory.noMatch')}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {displaySoftware.map((sw) => (
                  <div key={sw.software_id} className="p-3 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {sw.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {sw.version && (
                            <span className="text-xs text-gray-500">{t('assetSoftwareInventory.version', { version: sw.version })}</span>
                          )}
                          {sw.publisher && (
                            <span className="text-xs text-gray-400">{t('assetSoftwareInventory.by', { publisher: sw.publisher })}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Show More/Less */}
          {listed.total > displaySoftware.length && (
            <div className="p-3 border-t border-gray-100 text-center">
              <span className="text-xs text-gray-500">
                {t('assetSoftwareInventory.showingOfApplications', { shown: displaySoftware.length, total: listed.total })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Collapsed Preview */}
      {!isExpanded && (
        <div className="border-t border-gray-200 p-3">
          <div className="flex flex-wrap gap-1">
            {allSoftware.slice(0, 3).map((sw) => (
              <span
                key={`preview-${sw.software_id}`}
                className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700"
              >
                {sw.name.length > 20 ? `${sw.name.substring(0, 20)}...` : sw.name}
              </span>
            ))}
            {inventory.total > 3 && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs text-gray-500">
                {t('assetSoftwareInventory.more', { count: inventory.total - 3 })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AssetSoftwareInventory;
