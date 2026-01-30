'use client';

import React from 'react';
import { cn } from '../../lib/utils';
import { Clock, ArrowRightFromLine, ArrowLeftToLine } from 'lucide-react';
import { TicketResponseState } from '@alga-psa/types';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';

export interface ResponseStateLabels {
  awaitingClient: string;
  awaitingInternal: string;
  awaitingClientTooltip: string;
  awaitingInternalTooltip: string;
}

interface ResponseStateBadgeProps {
  responseState: TicketResponseState;
  variant?: 'badge' | 'text';
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  /** Use client-friendly wording for client portal */
  isClientPortal?: boolean;
  /** Override labels with i18n translated strings */
  labels?: ResponseStateLabels;
  className?: string;
}

/**
 * Get the display text for a response state.
 * @param state - The response state
 * @param isClientPortal - Whether to use client-friendly wording
 * @param labels - Optional i18n translated labels
 * @returns Display text
 */
export function getResponseStateLabel(
  state: TicketResponseState,
  isClientPortal: boolean = false,
  labels?: ResponseStateLabels
): string {
  if (!state) return '';

  // Use provided labels if available
  if (labels) {
    switch (state) {
      case 'awaiting_client':
        return labels.awaitingClient;
      case 'awaiting_internal':
        return labels.awaitingInternal;
      default:
        return '';
    }
  }

  if (isClientPortal) {
    switch (state) {
      case 'awaiting_client':
        return 'Awaiting Your Response';
      case 'awaiting_internal':
        return 'Awaiting Support Response';
      default:
        return '';
    }
  }

  switch (state) {
    case 'awaiting_client':
      return 'Awaiting Client';
    case 'awaiting_internal':
      return 'Awaiting Internal';
    default:
      return '';
  }
}

/**
 * Get the tooltip text for a response state.
 */
function getResponseStateTooltip(
  state: TicketResponseState,
  isClientPortal: boolean = false,
  labels?: ResponseStateLabels
): string {
  if (!state) return '';

  // Use provided labels if available
  if (labels) {
    switch (state) {
      case 'awaiting_client':
        return labels.awaitingClientTooltip;
      case 'awaiting_internal':
        return labels.awaitingInternalTooltip;
      default:
        return '';
    }
  }

  if (isClientPortal) {
    switch (state) {
      case 'awaiting_client':
        return 'Support is waiting for your response';
      case 'awaiting_internal':
        return 'Your response has been received. Support will respond soon.';
      default:
        return '';
    }
  }

  switch (state) {
    case 'awaiting_client':
      return 'Waiting for client to respond';
    case 'awaiting_internal':
      return 'Client has responded, waiting for internal action';
    default:
      return '';
  }
}

/**
 * Get the icon for a response state.
 */
function ResponseStateIcon({ state, className }: { state: TicketResponseState; className?: string }) {
  if (!state) return null;

  const iconClass = cn('w-3 h-3', className);

  switch (state) {
    case 'awaiting_client':
      return <ArrowRightFromLine className={iconClass} />;
    case 'awaiting_internal':
      return <ArrowLeftToLine className={iconClass} />;
    default:
      return <Clock className={iconClass} />;
  }
}

/**
 * ResponseStateBadge displays the current response state of a ticket.
 * Shows who needs to respond next (client or internal support).
 */
export function ResponseStateBadge({
  responseState,
  variant = 'badge',
  size = 'sm',
  showTooltip = true,
  isClientPortal = false,
  labels,
  className,
}: ResponseStateBadgeProps) {
  // Don't render anything if no response state
  if (!responseState) {
    return null;
  }

  const label = getResponseStateLabel(responseState, isClientPortal, labels);
  const tooltip = getResponseStateTooltip(responseState, isClientPortal, labels);

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-xs',
    md: 'px-2 py-1 text-sm',
    lg: 'px-2.5 py-1.5 text-base',
  };

  // Use CSS variables to prevent client portal branding from overriding badge colors
  const colorClasses = {
    awaiting_client: 'bg-[rgb(var(--badge-warning-bg))] text-[rgb(var(--badge-warning-text))] border-[rgb(var(--badge-warning-border))]',
    awaiting_internal: 'bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))] border-[rgb(var(--badge-info-border))]',
  };

  const badgeContent = (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium transition-colors',
        sizeClasses[size],
        colorClasses[responseState],
        className
      )}
    >
      <ResponseStateIcon state={responseState} />
      {variant === 'badge' && <span>{label}</span>}
    </div>
  );

  if (showTooltip) {
    return (
      <Tooltip content={<p>{tooltip}</p>}>
        {badgeContent}
      </Tooltip>
    );
  }

  return badgeContent;
}

export default ResponseStateBadge;
