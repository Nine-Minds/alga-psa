'use client';

import React from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { TicketResponseState } from 'server/src/interfaces/ticket.interfaces';
import { ResponseStateBadge, getResponseStateLabel } from './ResponseStateBadge';

interface ResponseStateSelectProps {
  value: TicketResponseState;
  onValueChange: (value: TicketResponseState) => void;
  disabled?: boolean;
  className?: string;
}

const responseStateOptions = [
  { value: 'awaiting_client', label: 'Awaiting Client' },
  { value: 'awaiting_internal', label: 'Awaiting Internal' },
  { value: 'clear', label: 'Clear' },
];

/**
 * ResponseStateSelect provides a dropdown to manually set or clear the response state.
 * For use in the ticket detail view by internal staff.
 */
export function ResponseStateSelect({
  value,
  onValueChange,
  disabled = false,
  className,
}: ResponseStateSelectProps) {
  const handleChange = (newValue: string) => {
    if (newValue === 'clear') {
      onValueChange(null);
    } else {
      onValueChange(newValue as TicketResponseState);
    }
  };

  const customStyles = {
    trigger: "w-fit !inline-flex items-center justify-between rounded px-3 py-2 text-sm font-medium bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500",
    content: "bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 overflow-auto",
    item: "text-gray-900 cursor-default select-none relative py-2 pl-3 pr-9 hover:bg-indigo-600 hover:text-white",
    itemIndicator: "absolute inset-y-0 right-0 flex items-center pr-4 text-indigo-600",
  };

  // If there's no current value, show "Set Response State" as placeholder
  const displayValue = value || '';
  const placeholder = 'Set Response State';

  return (
    <div className={className}>
      <CustomSelect
        value={displayValue}
        options={responseStateOptions}
        onValueChange={handleChange}
        customStyles={customStyles}
        placeholder={placeholder}
        className="!w-fit"
        disabled={disabled}
      />
    </div>
  );
}

/**
 * ResponseStateDisplay shows the current response state with optional edit capability.
 * Combines the badge display with an optional select for editing.
 */
interface ResponseStateDisplayProps {
  value: TicketResponseState;
  onValueChange?: (value: TicketResponseState) => void;
  editable?: boolean;
  showLabel?: boolean;
  className?: string;
}

export function ResponseStateDisplay({
  value,
  onValueChange,
  editable = true,
  showLabel = true,
  className,
}: ResponseStateDisplayProps) {
  if (!editable) {
    return (
      <div className={className}>
        {showLabel && <h5 className="font-bold mb-2">Response State</h5>}
        {value ? (
          <ResponseStateBadge responseState={value} size="md" />
        ) : (
          <span className="text-sm text-gray-500">Not set</span>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {showLabel && <h5 className="font-bold mb-2">Response State</h5>}
      <div className="flex items-center gap-2">
        {value && <ResponseStateBadge responseState={value} size="sm" showTooltip={false} />}
        {onValueChange && (
          <ResponseStateSelect
            value={value}
            onValueChange={onValueChange}
          />
        )}
      </div>
    </div>
  );
}

export default ResponseStateSelect;
