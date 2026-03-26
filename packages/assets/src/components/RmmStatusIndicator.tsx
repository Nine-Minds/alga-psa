'use client';

/**
 * RMM Status Indicator Component
 *
 * Displays the agent status and RMM provider for assets that are
 * managed by an RMM integration like NinjaOne.
 */

import React from 'react';
import { Wifi, WifiOff, Cloud, Monitor, AlertTriangle } from 'lucide-react';
import type { Asset } from '@alga-psa/types';
import { getRmmProviderDisplayName } from '../lib/rmmProviderDisplay';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface RmmStatusIndicatorProps {
  asset: Asset;
  showProvider?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * RMM Status Indicator - Shows online/offline status for RMM-managed assets
 */
export function RmmStatusIndicator({
  asset,
  showProvider = false,
  size = 'sm',
  className = '',
}: RmmStatusIndicatorProps) {
  const { t } = useTranslation('msp/assets');
  // Don't render if not RMM managed
  if (!asset.rmm_provider || !asset.rmm_device_id) {
    return null;
  }

  const isOnline = asset.agent_status === 'online';
  const isOverdue = asset.agent_status === 'overdue';
  const isUnknown = asset.agent_status === 'unknown' || !asset.agent_status;

  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  if (isUnknown) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} text-gray-400 ${className}`}
        title={t('rmmStatusIndicator.titles.unknown', { defaultValue: 'Agent status unknown' })}
      >
        <Cloud className={iconSizes[size]} />
        {showProvider && <span>{getRmmProviderDisplayName(asset.rmm_provider)}</span>}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} ${
        isOnline ? 'text-emerald-600' : isOverdue ? 'text-amber-600' : 'text-gray-500'
      } ${className}`}
      title={t('rmmStatusIndicator.titles.status', {
        defaultValue: '{{status}}{{suffix}}',
        status: isOnline
          ? t('rmmStatusIndicator.statuses.online', { defaultValue: 'Online' })
          : isOverdue
            ? t('rmmStatusIndicator.statuses.overdue', { defaultValue: 'Overdue' })
            : t('rmmStatusIndicator.statuses.offline', { defaultValue: 'Offline' }),
        suffix: asset.last_seen_at
          ? t('rmmStatusIndicator.titles.lastSeen', {
            defaultValue: ' - Last seen: {{value}}',
            value: formatRelativeTime(asset.last_seen_at, t)
          })
          : ''
      })}
    >
      {isOnline ? <Wifi className={iconSizes[size]} /> : null}
      {isOverdue ? <AlertTriangle className={iconSizes[size]} /> : null}
      {!isOnline && !isOverdue ? <WifiOff className={iconSizes[size]} /> : null}
      {showProvider ? (
        <span>{getRmmProviderDisplayName(asset.rmm_provider)}</span>
      ) : (
        <span>
          {isOnline
            ? t('rmmStatusIndicator.statuses.online', { defaultValue: 'Online' })
            : isOverdue
              ? t('rmmStatusIndicator.statuses.overdue', { defaultValue: 'Overdue' })
              : t('rmmStatusIndicator.statuses.offline', { defaultValue: 'Offline' })}
        </span>
      )}
    </span>
  );
}

/**
 * RMM Badge - A more prominent badge-style indicator
 */
export function RmmBadge({
  asset,
  showLastSeen = false,
  className = '',
}: {
  asset: Asset;
  showLastSeen?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('msp/assets');
  // Don't render if not RMM managed
  if (!asset.rmm_provider || !asset.rmm_device_id) {
    return null;
  }

  const isOnline = asset.agent_status === 'online';
  const isOverdue = asset.agent_status === 'overdue';
  const isUnknown = asset.agent_status === 'unknown' || !asset.agent_status;

  if (isUnknown) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-600 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
        {t('rmmStatusIndicator.statuses.unknown', { defaultValue: 'Unknown' })}
      </span>
    );
  }

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
          isOnline
            ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20'
            : isOverdue
              ? 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20'
              : 'bg-gray-500/10 text-gray-600 ring-1 ring-gray-500/20'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isOnline ? 'bg-emerald-500 animate-pulse' : isOverdue ? 'bg-amber-500' : 'bg-gray-400'
          }`}
        />
        {isOnline
          ? t('rmmStatusIndicator.statuses.online', { defaultValue: 'Online' })
          : isOverdue
            ? t('rmmStatusIndicator.statuses.overdue', { defaultValue: 'Overdue' })
            : t('rmmStatusIndicator.statuses.offline', { defaultValue: 'Offline' })}
      </span>
      {showLastSeen && asset.last_seen_at && (
        <span className="text-[10px] text-gray-400 mt-0.5 text-center">
          {formatRelativeTime(asset.last_seen_at, t)}
        </span>
      )}
    </div>
  );
}

/**
 * RMM Provider Logo/Icon
 */
export function RmmProviderIcon({
  className = 'h-4 w-4',
}: {
  provider?: string;
  className?: string;
}) {
  // In a full implementation, you could use actual provider logos
  // For now, we use a generic icon
  return <Monitor className={`${className} text-gray-500`} />;
}

/**
 * Format relative time from ISO string
 */
function formatRelativeTime(
  isoString: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return t('rmmStatusIndicator.relative.justNow', { defaultValue: 'Just now' });
  } else if (diffMinutes < 60) {
    return t('rmmStatusIndicator.relative.minutesAgo', {
      defaultValue: '{{count}}m ago',
      count: diffMinutes
    });
  } else if (diffHours < 24) {
    return t('rmmStatusIndicator.relative.hoursAgo', {
      defaultValue: '{{count}}h ago',
      count: diffHours
    });
  } else if (diffDays < 7) {
    return t('rmmStatusIndicator.relative.daysAgo', {
      defaultValue: '{{count}}d ago',
      count: diffDays
    });
  } else {
    return date.toLocaleDateString();
  }
}

export default RmmStatusIndicator;
