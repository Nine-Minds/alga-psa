'use client';

import React, { useId, useMemo } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import * as RadixSelect from '@radix-ui/react-select';
import { useModality } from '@alga-psa/ui/components/ModalityContext';
import { ProjectStatus } from '@alga-psa/types';

// Fallback colors using the same color families as KanbanBoard cycle colors,
// but with higher saturation (-400 shades) for better visibility in the compact pill
const CYCLE_COLORS = [
  '#9CA3AF', // gray-400
  '#818CF8', // indigo-400
  '#4ADE80', // green-400
  '#FACC15', // yellow-400
];

interface TaskStatusSelectProps {
  value: string;
  statuses: ProjectStatus[];
  onValueChange: (statusId: string) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * A compact status select component for project tasks.
 * Displays the current status with its color as the background.
 */
export const TaskStatusSelect: React.FC<TaskStatusSelectProps> = ({
  value,
  statuses,
  onValueChange,
  disabled = false,
  id
}) => {
  const { modal: parentModal } = useModality();
  const generatedId = useId();
  const selectId = id || generatedId;

  // Sort and filter statuses once, same as KanbanBoard
  const visibleStatuses = useMemo(() =>
    statuses
      .filter(s => s.is_visible)
      .sort((a, b) => a.display_order - b.display_order),
    [statuses]
  );

  // Get the color for a status, using fallback cycle if no color configured
  const getStatusColor = (status: ProjectStatus): string => {
    if (status.color) return status.color;
    // Use index in visible statuses for consistent cycling with KanbanBoard
    const index = visibleStatuses.findIndex(s => s.project_status_mapping_id === status.project_status_mapping_id);
    return CYCLE_COLORS[index % CYCLE_COLORS.length];
  };

  const selectedStatus = statuses.find(s => s.project_status_mapping_id === value);

  // Get display name (prefer custom_name if set)
  const getDisplayName = (status: ProjectStatus) => {
    return status.custom_name || status.name;
  };

  // Get contrasting text color based on background
  const getTextColor = (bgColor: string): string => {
    // Remove # if present
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.5 ? 'text-gray-900' : 'text-white';
  };

  const statusColor = selectedStatus ? getStatusColor(selectedStatus) : CYCLE_COLORS[0];
  const textColorClass = getTextColor(statusColor);

  return (
    <RadixSelect.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      {...({ modal: parentModal } as any)}
    >
      <RadixSelect.Trigger
        id={selectId}
        className={`
          inline-flex items-center justify-between gap-1
          rounded-md px-2.5 py-1 h-7
          text-xs font-medium transition-colors
          cursor-pointer
          border-0
          hover:opacity-90
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
          disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50
          ${textColorClass}
        `}
        style={{ backgroundColor: statusColor }}
        aria-label="Task status"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <RadixSelect.Value>
          {selectedStatus ? getDisplayName(selectedStatus) : 'Select status'}
        </RadixSelect.Value>
        <RadixSelect.Icon>
          <ChevronDown className={`w-3 h-3 ${textColorClass}`} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          className="
            overflow-hidden bg-white rounded-md shadow-lg
            border border-gray-200 z-[10001] min-w-[140px]
          "
          position="popper"
          sideOffset={4}
          align="end"
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.stopPropagation()}
        >
          <RadixSelect.Viewport className="p-1 max-h-[200px] overflow-y-auto">
            {visibleStatuses.map((status) => (
              <RadixSelect.Item
                key={status.project_status_mapping_id}
                value={status.project_status_mapping_id}
                className="
                  relative flex items-center gap-2 px-2 py-1.5 text-sm rounded
                  cursor-pointer hover:bg-gray-100 focus:bg-gray-100
                  focus:outline-none select-none
                  data-[highlighted]:bg-gray-100
                "
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getStatusColor(status) }}
                />
                <RadixSelect.ItemText>
                  {getDisplayName(status)}
                </RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="ml-auto">
                  <Check className="w-3 h-3 text-primary-600" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
};

export default TaskStatusSelect;
