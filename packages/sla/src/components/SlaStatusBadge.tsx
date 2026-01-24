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
import { SlaTimerStatus } from '../types';
import { formatRemainingTime } from '../services/businessHoursCalculator';

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
function getStatusConfig(status: SlaTimerStatus, isPaused?: boolean) {
  if (isPaused || status === 'paused') {
    return {
      icon: PauseCircle,
      label: 'Paused',
      colorClass: 'bg-gray-100 text-gray-700 border-gray-200',
      variant: 'secondary' as const
    };
  }

  switch (status) {
    case 'on_track':
      return {
        icon: CheckCircle,
        label: 'On Track',
        colorClass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        variant: 'success' as const
      };
    case 'at_risk':
      return {
        icon: AlertTriangle,
        label: 'At Risk',
        colorClass: 'bg-amber-100 text-amber-700 border-amber-200',
        variant: 'warning' as const
      };
    case 'response_breached':
    case 'resolution_breached':
      return {
        icon: XCircle,
        label: 'Breached',
        colorClass: 'bg-red-100 text-red-700 border-red-200',
        variant: 'destructive' as const
      };
    default:
      return {
        icon: Clock,
        label: 'Unknown',
        colorClass: 'bg-gray-100 text-gray-700 border-gray-200',
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
  const config = getStatusConfig(status, isPaused);
  const Icon = config.icon;

  // Format the remaining time
  const timeDisplay = remainingMinutes !== undefined ? formatRemainingTime(remainingMinutes) : null;

  // Build tooltip content
  const tooltipContent = buildTooltipContent(
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
      className={cn(
        'gap-1.5 font-medium',
        config.colorClass,
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
  status: SlaTimerStatus,
  isPaused?: boolean,
  responseRemainingMinutes?: number,
  resolutionRemainingMinutes?: number
): string {
  const lines: string[] = [];

  // Status line
  if (isPaused || status === 'paused') {
    lines.push('SLA Timer: Paused');
  } else {
    const statusLabels: Record<SlaTimerStatus, string> = {
      on_track: 'On Track',
      at_risk: 'At Risk',
      response_breached: 'Response SLA Breached',
      resolution_breached: 'Resolution SLA Breached',
      paused: 'Paused'
    };
    lines.push(`SLA Status: ${statusLabels[status] || 'Unknown'}`);
  }

  // Response SLA line
  if (responseRemainingMinutes !== undefined) {
    const time = formatRemainingTime(responseRemainingMinutes);
    if (responseRemainingMinutes < 0) {
      lines.push(`Response: Breached by ${time.replace('-', '')}`);
    } else {
      lines.push(`Response: ${time} remaining`);
    }
  }

  // Resolution SLA line
  if (resolutionRemainingMinutes !== undefined) {
    const time = formatRemainingTime(resolutionRemainingMinutes);
    if (resolutionRemainingMinutes < 0) {
      lines.push(`Resolution: Breached by ${time.replace('-', '')}`);
    } else {
      lines.push(`Resolution: ${time} remaining`);
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
  const config = getStatusConfig(status, isPaused);
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        isPaused || status === 'paused' ? 'text-gray-500' :
        status === 'on_track' ? 'text-emerald-600' :
        status === 'at_risk' ? 'text-amber-600' :
        'text-red-600',
        className
      )}
    >
      <Icon size={12} />
      {remainingMinutes !== undefined && (
        <span>{formatRemainingTime(remainingMinutes)}</span>
      )}
    </span>
  );
}

export default SlaStatusBadge;
