'use client';

/**
 * RMM Status Indicator Component
 *
 * Displays the agent status and RMM provider for assets that are
 * managed by an RMM integration like NinjaOne.
 */

import React from 'react';
import { Wifi, WifiOff, Cloud, Monitor } from 'lucide-react';
import type { Asset } from '@alga-psa/types';

interface RmmStatusIndicatorProps {
  asset: Asset;
  showProvider?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Get display name for RMM provider
 */
function getProviderDisplayName(provider?: string): string {
  switch (provider) {
    case 'ninjaone':
      return 'NinjaOne';
    case 'datto':
      return 'Datto';
    case 'connectwise_automate':
      return 'CW Automate';
    default:
      return provider || 'Unknown';
  }
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
  // Don't render if not RMM managed
  if (!asset.rmm_provider || !asset.rmm_device_id) {
    return null;
  }

  const isOnline = asset.agent_status === 'online';
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

  const dotSizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  };

  if (isUnknown) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} text-gray-400 ${className}`}
        title="Agent status unknown"
      >
        <Cloud className={iconSizes[size]} />
        {showProvider && <span>{getProviderDisplayName(asset.rmm_provider)}</span>}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} ${
        isOnline ? 'text-emerald-600' : 'text-gray-500'
      } ${className}`}
      title={`${isOnline ? 'Online' : 'Offline'}${
        asset.last_seen_at ? ` - Last seen: ${formatRelativeTime(asset.last_seen_at)}` : ''
      }`}
    >
      {isOnline ? (
        <Wifi className={iconSizes[size]} />
      ) : (
        <WifiOff className={iconSizes[size]} />
      )}
      {showProvider ? (
        <span>{getProviderDisplayName(asset.rmm_provider)}</span>
      ) : (
        <span>{isOnline ? 'Online' : 'Offline'}</span>
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
  // Don't render if not RMM managed
  if (!asset.rmm_provider || !asset.rmm_device_id) {
    return null;
  }

  const isOnline = asset.agent_status === 'online';
  const isUnknown = asset.agent_status === 'unknown' || !asset.agent_status;

  if (isUnknown) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
        Unknown
      </span>
    );
  }

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
          isOnline
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
            : 'bg-gray-100 text-gray-600 ring-1 ring-gray-400/20'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
          }`}
        />
        {isOnline ? 'Online' : 'Offline'}
      </span>
      {showLastSeen && asset.last_seen_at && (
        <span className="text-[10px] text-gray-400 mt-0.5 text-center">
          {formatRelativeTime(asset.last_seen_at)}
        </span>
      )}
    </div>
  );
}

/**
 * RMM Provider Logo/Icon
 */
export function RmmProviderIcon({
  provider,
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
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

export default RmmStatusIndicator;
