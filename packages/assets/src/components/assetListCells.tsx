'use client';

import React from 'react';
import { BentoChip, BENTO_TONE_TEXT, type BentoTone } from '@alga-psa/ui/components/bento';
import type { Asset } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  AGENT_TONE,
  assetExtension,
  formatAge,
  isRmmManaged,
  osLabel,
  patchSummary,
  warrantyDaysRemaining,
  warrantyPhrase,
  warrantyToneFor,
} from '../lib/assetSignals';

/**
 * Composite table cells shared by the assets list and the client Assets tab.
 *
 * Modelled on the ticketing dashboard's "Due Date / SLA" column: each cell pairs
 * a headline signal with the qualifier that makes it actionable, so a row
 * answers "what state is this in, is it late" without opening the asset. Three
 * of these (agent staleness, patch state, warranty state) are facts the old
 * asset table never showed at all.
 */

const TONE_CHIP: Record<BentoTone, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  good: 'success', warn: 'warning', bad: 'danger', info: 'info', neutral: 'neutral',
};

function Cell({
  primary,
  secondary,
  tone = 'neutral',
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  tone?: BentoTone;
}) {
  return (
    <div className="min-w-0">
      <div className={`text-sm truncate ${tone === 'neutral' ? 'text-[rgb(var(--color-text-700))]' : BENTO_TONE_TEXT[tone]}`}>
        {primary}
      </div>
      {secondary ? (
        <div className="text-xs text-[rgb(var(--color-text-400))] truncate">{secondary}</div>
      ) : null}
    </div>
  );
}

/** Reachability over staleness. Unmanaged assets say so instead of showing dashes. */
export function AssetAgentCell({ asset, now }: { asset: Asset; now: number }) {
  const { t } = useTranslation('msp/assets');
  if (!isRmmManaged(asset)) {
    return (
      <Cell
        primary={
          <span className="text-[rgb(var(--color-text-400))]">
            {t('assetCells.agent.unmanaged', { defaultValue: 'unmanaged' })}
          </span>
        }
        secondary={t('assetCells.agent.noAgent', { defaultValue: 'no RMM agent' })}
      />
    );
  }
  const tone = AGENT_TONE[asset.agent_status ?? 'unknown'] ?? 'neutral';
  const status = asset.agent_status ?? 'unknown';
  return (
    <Cell
      tone={tone}
      primary={
        <BentoChip tone={TONE_CHIP[tone]}>
          {t(`assetCells.agentStatus.${status}`, { defaultValue: status })}
        </BentoChip>
      }
      secondary={
        asset.last_seen_at
          ? t('assetCells.agent.seen', { defaultValue: 'seen {{age}}', age: formatAge(asset.last_seen_at, now, t) })
          : t('assetCells.agent.neverSeen', { defaultValue: 'never seen' })
      }
    />
  );
}

/** Pending/failed patches over the age of the scan that found them. */
export function AssetPatchingCell({ asset, now }: { asset: Asset; now: number }) {
  const { t } = useTranslation('msp/assets');
  const patches = patchSummary(asset, t);
  if (patches.label === null) {
    return <Cell primary={<span className="text-[rgb(var(--color-text-400))]">—</span>} />;
  }
  return (
    <Cell
      tone={patches.tone}
      primary={patches.label}
      secondary={
        patches.lastScanAt
          ? t('assetCells.patching.scanned', { defaultValue: 'scanned {{age}}', age: formatAge(patches.lastScanAt, now, t) })
          : t('assetCells.patching.neverScanned', { defaultValue: 'never scanned' })
      }
    />
  );
}

/** Warranty state over record status. */
export function AssetCoverageCell({ asset, now }: { asset: Asset; now: number }) {
  const { t } = useTranslation('msp/assets');
  return (
    <Cell
      tone={warrantyToneFor(asset, now)}
      primary={
        warrantyPhrase(warrantyDaysRemaining(asset, now), t)
        ?? t('assetCells.coverage.noWarrantyDate', { defaultValue: 'no warranty date' })
      }
      secondary={t(`assetCells.status.${asset.status}`, { defaultValue: asset.status })}
    />
  );
}

/**
 * Secondary identity line for the name column: tag · type · OS.
 *
 * `typeIcon` carries the tenant's registry-configured icon for custom asset
 * types. That icon used to live in a dedicated Type column; folding the type
 * into this line must not cost custom types their visual identity.
 */
export function AssetIdentityMeta({
  asset,
  typeLabel,
  typeIcon,
}: {
  asset: Asset;
  typeLabel?: string;
  typeIcon?: React.ReactNode;
}) {
  const ext = assetExtension(asset);
  const parts = [asset.asset_tag, typeLabel ?? asset.asset_type, osLabel(ext?.os_type, ext?.os_version)]
    .filter(Boolean);
  if (!parts.length && !typeIcon) return null;
  return (
    <div className="flex items-center gap-1 text-xs text-[rgb(var(--color-text-400))] min-w-0">
      {typeIcon ? <span className="flex-shrink-0 [&_svg]:h-3 [&_svg]:w-3">{typeIcon}</span> : null}
      <span className="truncate">{parts.join(' · ')}</span>
    </div>
  );
}
