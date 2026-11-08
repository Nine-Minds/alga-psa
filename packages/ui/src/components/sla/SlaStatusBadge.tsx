'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { cn } from '@alga-psa/ui';
import {
  Clock,
  AlertTriangle,
  XCircle,
  CheckCircle,
  PauseCircle
} from 'lucide-react';
import { SlaTimerStatus } from '@alga-psa/types';
import { useTranslation } from '../../lib/i18n/client';

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function formatRemainingTime(minutes: number, t: TranslateFn): string {
  const absoluteMinutes = Math.abs(minutes);
  const prefix = minutes < 0 ? '-' : '';
  if (absoluteMinutes < 60) {
    return prefix + t('sla.time.minutes', { minutes: absoluteMinutes });
  }
  if (absoluteMinutes < 1440) {
    const hours = Math.floor(absoluteMinutes / 60);
    const mins = absoluteMinutes % 60;
    return prefix + (mins > 0
      ? t('sla.time.hoursMinutes', { hours, minutes: mins })
      : t('sla.time.hours', { hours }));
  }
  const days = Math.floor(absoluteMinutes / 1440);
  const hours = Math.floor((absoluteMinutes % 1440) / 60);
  return prefix + (hours > 0
    ? t('sla.time.daysHours', { days, hours })
    : t('sla.time.days', { days }));
}

export interface SlaStatusBadgeProps {
  /**
   * Overall SLA status
   */
  status: SlaTimerStatus;
  /**
   * Minutes remaining for response SLA (negative if breached)
   */
  responseRemainingMinutes?: number;
  /**
   * Minutes remaining for resolution SLA (negative if breached)
   */
  resolutionRemainingMinutes?: number;
  /**
   * Whether the SLA is currently paused
   */
  isPaused?: boolean;
  /**
   * Which SLA type to display (response, resolution, or auto-select)
   */
  displayType?: 'response' | 'resolution' | 'auto';
  /**
   * Size variant
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Whether to show the icon
   */
  showIcon?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * Get the configuration for a given SLA status
 */
function getStatusConfig(t: TranslateFn, status: SlaTimerStatus, isPaused?: boolean) {
  if (isPaused || status === 'paused') {
    return {
      icon: PauseCircle,
      label: t('enums.slaStatus.paused'),
      variant: 'secondary' as const
    };
  }

  switch (status) {
    case 'on_track':
      return {
        icon: CheckCircle,
        label: t('enums.slaStatus.on_track'),
        variant: 'success' as const
      };
    case 'at_risk':
      return {
        icon: AlertTriangle,
        label: t('enums.slaStatus.at_risk'),
        variant: 'warning' as const
      };
    case 'response_breached':
    case 'resolution_breached':
      return {
        icon: XCircle,
        label: t('enums.slaStatus.breached'),
        variant: 'error' as const
      };
    default:
      return {
        icon: Clock,
        label: t('enums.slaStatus.unknown'),
        variant: 'secondary' as const
      };
  }
}

/**
 * Determine which SLA type to display based on remaining time
 */
function determineDisplayType(
  responseRemainingMinutes?: number,
  resolutionRemainingMinutes?: number
): 'response' | 'resolution' | null {
  // If neither is defined, return null
  if (responseRemainingMinutes === undefined && resolutionRemainingMinutes === undefined) {
    return null;
  }

  // If only one is defined, use that
  if (responseRemainingMinutes !== undefined && resolutionRemainingMinutes === undefined) {
    return 'response';
  }
  if (resolutionRemainingMinutes !== undefined && responseRemainingMinutes === undefined) {
    return 'resolution';
  }

  // If both are defined, show the one that's more urgent (lower remaining time)
  if (responseRemainingMinutes !== undefined && resolutionRemainingMinutes !== undefined) {
    return responseRemainingMinutes <= resolutionRemainingMinutes ? 'response' : 'resolution';
  }

  return null;
}

/**
 * SLA Status Badge Component
 *
 * Displays the SLA status for a ticket with visual indicators for:
 * - On Track: Green, ticket is within SLA targets
 * - At Risk: Yellow/amber, approaching SLA deadline
 * - Breached: Red, SLA has been breached
 * - Paused: Gray, SLA timer is paused
 *
 * Shows remaining time in a human-readable format (e.g., "2h 30m", "-45m" for breached)
 */
export function SlaStatusBadge({
  status,
  responseRemainingMinutes,
  resolutionRemainingMinutes,
  isPaused,
  displayType = 'auto',
  size = 'md',
  showIcon = true,
  className
}: SlaStatusBadgeProps): React.ReactElement | null {
  const { t } = useTranslation('features/tickets');
  // Determine which SLA type to display
  const selectedDisplayType =
    displayType === 'auto'
      ? determineDisplayType(responseRemainingMinutes, resolutionRemainingMinutes)
      : displayType;

  // Get remaining minutes based on display type
  const remainingMinutes =
    selectedDisplayType === 'response'
      ? responseRemainingMinutes
      : selectedDisplayType === 'resolution'
      ? resolutionRemainingMinutes
      : undefined;

  // Get status configuration
  const config = getStatusConfig(t, status, isPaused);
  const Icon = config.icon;

  // Format the remaining time
  const timeDisplay = remainingMinutes !== undefined ? formatRemainingTime(remainingMinutes, t) : null;

  // Build tooltip content
  const tooltipContent = buildTooltipContent(
    t,
    status,
    isPaused,
    responseRemainingMinutes,
    resolutionRemainingMinutes
  );

  // Size-based classes
  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-xs px-3 py-1',
    lg: 'text-sm px-4 py-1.5'
  };

  const iconSizes = {
    sm: 10,
    md: 12,
    lg: 14
  };

  const badgeContent = (
    <Badge
      variant={config.variant}
      className={cn(
        'gap-1.5 font-medium',
        sizeClasses[size],
        className
      )}
    >
      {showIcon && <Icon size={iconSizes[size]} />}
      <span>{timeDisplay || config.label}</span>
    </Badge>
  );

  return (
    <Tooltip content={tooltipContent}>
      {badgeContent}
    </Tooltip>
  );
}

/**
 * Build tooltip content with detailed SLA information
 */
function buildTooltipContent(
  t: TranslateFn,
  status: SlaTimerStatus,
  isPaused?: boolean,
  responseRemainingMinutes?: number,
  resolutionRemainingMinutes?: number
): string {
  const lines: string[] = [];

  // Status line
  if (isPaused || status === 'paused') {
    lines.push(t('sla.tooltip.paused'));
  } else {
    const statusLabels: Record<SlaTimerStatus, string> = {
      on_track: t('enums.slaStatus.on_track'),
      at_risk: t('enums.slaStatus.at_risk'),
      response_breached: t('enums.slaStatus.response_breached'),
      resolution_breached: t('enums.slaStatus.resolution_breached'),
      paused: t('enums.slaStatus.paused')
    };
    lines.push(t('sla.tooltip.status', { status: statusLabels[status] || t('enums.slaStatus.unknown') }));
  }

  // Response SLA line
  if (responseRemainingMinutes !== undefined) {
    const time = formatRemainingTime(responseRemainingMinutes, t);
    if (responseRemainingMinutes < 0) {
      lines.push(t('sla.tooltip.responseBreached', { time: time.replace('-', '') }));
    } else {
      lines.push(t('sla.tooltip.responseRemaining', { time }));
    }
  }

  // Resolution SLA line
  if (resolutionRemainingMinutes !== undefined) {
    const time = formatRemainingTime(resolutionRemainingMinutes, t);
    if (resolutionRemainingMinutes < 0) {
      lines.push(t('sla.tooltip.resolutionBreached', { time: time.replace('-', '') }));
    } else {
      lines.push(t('sla.tooltip.resolutionRemaining', { time }));
    }
  }

  return lines.join('\n');
}

/**
 * Compact SLA indicator for use in list views
 */
export function SlaIndicator({
  status,
  remainingMinutes,
  isPaused,
  className
}: {
  status: SlaTimerStatus;
  remainingMinutes?: number;
  isPaused?: boolean;
  className?: string;
}): React.ReactElement {
  const { t } = useTranslation('features/tickets');
  const config = getStatusConfig(t, status, isPaused);
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        isPaused || status === 'paused' ? 'text-[rgb(var(--badge-secondary-text))]' :
        status === 'on_track' ? 'text-[rgb(var(--badge-success-text))]' :
        status === 'at_risk' ? 'text-[rgb(var(--badge-warning-text))]' :
        'text-[rgb(var(--badge-error-text))]',
        className
      )}
    >
      <Icon size={12} />
      {remainingMinutes !== undefined && (
        <span>{formatRemainingTime(remainingMinutes, t)}</span>
      )}
    </span>
  );
}

export default SlaStatusBadge;
