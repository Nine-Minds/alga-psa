import React from 'react';
import { TicketInterval } from 'server/src/types/interval-tracking';
import { formatDuration } from './utils';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';

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
    : 'Now';
  const startDate = new Date(interval.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' });
  
  return (
    <div 
      className={`border rounded p-2 flex items-center ${isSelected ? 'bg-blue-50 border-blue-300' : ''}`}
      id={`interval-item-${interval.id}`}
    >
      <Checkbox
        checked={isSelected}
        onChange={onSelect}
        className="mr-3"
        id={`interval-select-${interval.id}`}
      />
      
      <div className="flex-1">
        <div className="flex justify-between">
          <span className="font-medium">
            {startTime} - {endTime}
          </span>
          <span className="text-sm font-mono">
            {formatDuration(duration)}
          </span>
        </div>
        
        <div className="text-sm text-gray-500 flex items-center">
          <span>{startDate}</span>
          {interval.autoClosed && (
            <span className="ml-2 text-amber-600 text-xs bg-amber-50 px-1.5 py-0.5 rounded">
              Auto-closed
            </span>
          )}
          {!interval.endTime && (
            <span className="ml-2 text-green-600 text-xs bg-green-50 px-1.5 py-0.5 rounded">
              Active
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
