'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AsyncSearchableSelect } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAsset, listAssets } from '../actions/assetActions';
import { unwrapAssetActionResult } from '../actions/assetActionErrors';

export interface ClientAssetMultiSelectProps {
  clientId: string;
  /** Selected asset ids. */
  value: string[];
  onChange: (assetIds: string[]) => void;
  id?: string;
  label?: string;
  disabled?: boolean;
}

interface AssetLabel {
  name: string;
  detail: string;
}

const PAGE_SIZE = 10;

/**
 * Picks any number of assets that belong to one client, without an existing entity to attach them to
 * (`AssociatedAssets` is bound to a ticket or project). A client-scoped search picker adds assets one at
 * a time into a removable chip list, so the parent just holds `string[]` and saves it with its own form.
 */
export function ClientAssetMultiSelect({ clientId, value, onChange, id = 'client-asset-multi-select', label, disabled }: ClientAssetMultiSelectProps) {
  const { t } = useTranslation('msp/assets');
  const [labels, setLabels] = useState<Record<string, AssetLabel>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const requested = useRef<Set<string>>(new Set());

  // Names for ids that arrive from saved data (the search results only cover what the user has looked up).
  useEffect(() => {
    const missing = value.filter((assetId) => !labels[assetId] && !requested.current.has(assetId));
    if (missing.length === 0) return;
    missing.forEach((assetId) => requested.current.add(assetId));
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await Promise.all(missing.map(async (assetId) => {
          const asset = unwrapAssetActionResult(await getAsset(assetId));
          return [assetId, { name: asset.name, detail: asset.asset_tag }] as const;
        }));
        if (!cancelled) setLabels((current) => ({ ...current, ...Object.fromEntries(resolved) }));
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : t('clientAssetMultiSelect.errors.load', { defaultValue: 'Failed to load assets' }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [value, labels, t]);

  const loadOptions = useCallback(async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
    const response = unwrapAssetActionResult(await listAssets({
      client_id: clientId,
      search: search || undefined,
      page,
      limit,
    }));
    const selected = new Set(value);
    const assets = response.assets.filter((asset) => !selected.has(asset.asset_id));
    setLabels((current) => ({
      ...current,
      ...Object.fromEntries(response.assets.map((asset) => [asset.asset_id, { name: asset.name, detail: asset.asset_tag }])),
    }));
    return {
      options: assets.map((asset) => ({ value: asset.asset_id, label: asset.name, secondaryLabel: asset.asset_tag })),
      total: Math.max(0, response.total - (response.assets.length - assets.length)),
    };
  }, [clientId, value]);

  const add = (assetId: string) => {
    if (!assetId || value.includes(assetId)) return;
    onChange([...value, assetId]);
  };

  const remove = (assetId: string) => onChange(value.filter((candidate) => candidate !== assetId));

  return (
    <div id={id} className="space-y-2">
      {label && <Label htmlFor={`${id}-search`}>{label}</Label>}
      <AsyncSearchableSelect
        id={`${id}-search`}
        // Always empty: choosing an asset moves it into the chip list below.
        value=""
        onChange={add}
        loadOptions={loadOptions}
        limit={PAGE_SIZE}
        disabled={disabled}
        placeholder={t('clientAssetMultiSelect.placeholder', { defaultValue: 'Add an asset...' })}
        searchPlaceholder={t('clientAssetMultiSelect.searchPlaceholder', { defaultValue: 'Search assets' })}
        emptyMessage={t('clientAssetMultiSelect.empty', { defaultValue: 'No matching assets for this client' })}
      />
      {loadError && <p role="alert" className="text-xs text-[rgb(var(--color-accent-600))]">{loadError}</p>}
      {value.length > 0 && (
        <ul id={`${id}-selected`} className="flex flex-wrap gap-2">
          {value.map((assetId) => {
            const asset = labels[assetId];
            return (
              <li
                key={assetId}
                className="flex items-center gap-1 rounded-md border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] py-0.5 pl-2 pr-1 text-sm"
              >
                <span>{asset ? asset.name : t('clientAssetMultiSelect.loading', { defaultValue: 'Loading...' })}</span>
                {asset?.detail && <span className="text-xs text-[rgb(var(--color-text-500))]">{asset.detail}</span>}
                <Button
                  id={`${id}-remove-${assetId}`}
                  type="button"
                  variant="icon"
                  size="icon"
                  disabled={disabled}
                  aria-label={t('clientAssetMultiSelect.remove', { defaultValue: 'Remove asset' })}
                  onClick={() => remove(assetId)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ClientAssetMultiSelect;
