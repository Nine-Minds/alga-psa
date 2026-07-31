import React from 'react';
import { TicketInterval } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatDuration } from './utils';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useContentCardVariant } from '@alga-psa/ui/components';

interface IntervalItemProps {
  interval: TicketInterval;
  isSelected: boolean;
  onSelect: () => void;
}

/**
 * Component for displaying an individual time tracking interval
 */
export function IntervalItem({
  interval,
  isSelected,
  onSelect
}: IntervalItemProps) {
  const { t } = useTranslation('msp/time-entry');
  // Compact typography when rendered inside a Grid-layout bento tile.
  const isBento = useContentCardVariant() === 'bento';
  // Calculate duration if not provided
  const duration = interval.duration ?? (
    interval.endTime
      ? Math.floor((new Date(interval.endTime).getTime() - new Date(interval.startTime).getTime()) / 1000)
      : Math.floor((new Date().getTime() - new Date(interval.startTime).getTime()) / 1000)
  );
  
  // Format dates for display
  const startTime = new Date(interval.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endTime = interval.endTime 
    ? new Date(interval.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : t('intervalItem.now', { defaultValue: 'Now' });
  const startDate = new Date(interval.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' });
  
  const timeRange = `${startTime} - ${endTime}`;

  return (
    <div
      className={`${
        isBento ? 'rounded-md border border-[rgb(var(--color-border-200))] p-2' : 'border rounded p-2'
      } flex items-center ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' : ''}`}
      id={`interval-item-${interval.id}`}
    >
      <Checkbox
        checked={isSelected}
        onChange={onSelect}
        className={isBento ? 'mr-2' : 'mr-3'}
        id={`interval-select-${interval.id}`}
      />

      <div className="flex-1 min-w-0">
        <div className={isBento ? 'flex items-baseline gap-2' : 'flex justify-between'}>
          <span
            className={
              isBento
                ? 'text-sm font-medium text-[rgb(var(--color-text-800))] min-w-0 truncate whitespace-nowrap'
                : 'font-medium'
            }
            title={isBento ? timeRange : undefined}
          >
            {timeRange}
          </span>
          <span
            className={
              isBento
                ? 'ml-auto flex-shrink-0 text-xs font-mono text-[rgb(var(--color-text-500))]'
                : 'text-sm font-mono'
            }
          >
            {formatDuration(duration)}
          </span>
        </div>

        <div
          className={`${
            isBento ? 'text-xs' : 'text-sm'
          } text-gray-500 dark:text-[rgb(var(--color-text-400))] flex items-center`}
        >
          <span>{startDate}</span>
          {interval.autoClosed && (
            <Badge variant="warning" size="sm" className="ml-2">
              {t('intervalItem.autoClosed', { defaultValue: 'Auto-closed' })}
            </Badge>
          )}
          {!interval.endTime && (
            <Badge variant="success" size="sm" className="ml-2">
              {t('intervalItem.active', { defaultValue: 'Active' })}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
