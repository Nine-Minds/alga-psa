'use client';

import React from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import {
  Filter,
  X,
  MessageCircle,
  Mail,
  Clock,
  Edit,
  ArrowRight,
  Paperclip,
  Layers
} from 'lucide-react';
import {
  TicketActivityType,
  ActivityTypeCounts,
  TicketActivityFilters
} from 'server/src/interfaces/ticketActivity.interfaces';

interface TimelineFiltersProps {
  filters: TicketActivityFilters;
  onFiltersChange: (filters: TicketActivityFilters) => void;
  activityCounts?: ActivityTypeCounts;
  className?: string;
}

interface FilterGroup {
  label: string;
  icon: React.ReactNode;
  types: TicketActivityType[];
}

const FILTER_GROUPS: FilterGroup[] = [
  {
    label: 'Comments',
    icon: <MessageCircle className="w-4 h-4" />,
    types: ['comment_added', 'comment_edited', 'comment_deleted']
  },
  {
    label: 'Emails',
    icon: <Mail className="w-4 h-4" />,
    types: ['email_sent', 'email_received']
  },
  {
    label: 'Status',
    icon: <ArrowRight className="w-4 h-4" />,
    types: ['status_change', 'ticket_created', 'ticket_closed', 'ticket_reopened']
  },
  {
    label: 'Assignments',
    icon: <ArrowRight className="w-4 h-4" />,
    types: ['assignment_change', 'escalation']
  },
  {
    label: 'Field Changes',
    icon: <Edit className="w-4 h-4" />,
    types: ['field_change', 'custom_field_change', 'priority_change', 'category_change']
  },
  {
    label: 'Time',
    icon: <Clock className="w-4 h-4" />,
    types: ['time_entry_added', 'time_entry_updated']
  },
  {
    label: 'Documents',
    icon: <Paperclip className="w-4 h-4" />,
    types: ['document_attached', 'document_removed']
  },
  {
    label: 'Bundles',
    icon: <Layers className="w-4 h-4" />,
    types: ['bundle_created', 'bundle_child_added', 'bundle_child_removed', 'merge', 'split']
  }
];

/**
 * Get count for a filter group
 */
function getGroupCount(types: TicketActivityType[], counts?: ActivityTypeCounts): number {
  if (!counts) return 0;
  return types.reduce((sum, type) => sum + (counts[type] || 0), 0);
}

/**
 * Timeline filter controls
 */
export function TimelineFilters({
  filters,
  onFiltersChange,
  activityCounts,
  className = ''
}: TimelineFiltersProps) {
  const activeTypes = filters.activity_types || [];
  const hasActiveFilters = activeTypes.length > 0 || filters.include_internal === false;

  const toggleFilterGroup = (types: TicketActivityType[]) => {
    const currentTypes = new Set(activeTypes);
    const groupTypes = new Set(types);

    // Check if all group types are currently selected
    const allSelected = types.every(t => currentTypes.has(t));

    let newTypes: TicketActivityType[];
    if (allSelected) {
      // Remove all group types
      newTypes = activeTypes.filter(t => !groupTypes.has(t));
    } else {
      // Add all group types
      newTypes = [...new Set([...activeTypes, ...types])];
    }

    onFiltersChange({
      ...filters,
      activity_types: newTypes.length > 0 ? newTypes : undefined
    });
  };

  const isGroupActive = (types: TicketActivityType[]): boolean => {
    if (activeTypes.length === 0) return false;
    return types.some(t => activeTypes.includes(t));
  };

  const toggleInternalVisibility = () => {
    onFiltersChange({
      ...filters,
      include_internal: filters.include_internal === false ? true : false
    });
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Filter header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Filter className="w-4 h-4" />
          <span>Filter activities</span>
        </div>
        {hasActiveFilters && (
          <Button
            id="clear-timeline-filters"
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-xs"
          >
            <X className="w-3 h-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Filter groups */}
      <div className="flex flex-wrap gap-2">
        {FILTER_GROUPS.map((group) => {
          const count = getGroupCount(group.types, activityCounts);
          const isActive = isGroupActive(group.types);

          return (
            <Button
              key={group.label}
              id={`filter-${group.label.toLowerCase().replace(' ', '-')}`}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleFilterGroup(group.types)}
              className="gap-1.5"
            >
              {group.icon}
              {group.label}
              {count > 0 && (
                <Badge
                  variant={isActive ? 'secondary' : 'outline'}
                  className="ml-1 text-xs py-0 px-1.5 min-w-[20px]"
                >
                  {count}
                </Badge>
              )}
            </Button>
          );
        })}
      </div>

      {/* Additional options */}
      <div className="flex items-center gap-4 pt-2 border-t border-gray-200">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={filters.include_internal !== false}
            onChange={toggleInternalVisibility}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-gray-600">Show internal notes</span>
        </label>
      </div>
    </div>
  );
}

/**
 * Compact filter bar (horizontal pills)
 */
export function TimelineFilterBar({
  filters,
  onFiltersChange,
  className = ''
}: Omit<TimelineFiltersProps, 'activityCounts'>) {
  const activeTypes = filters.activity_types || [];

  const quickFilters = [
    { label: 'All', types: [] as TicketActivityType[] },
    { label: 'Comments', types: ['comment_added', 'comment_edited'] as TicketActivityType[] },
    { label: 'Status', types: ['status_change', 'ticket_closed', 'ticket_reopened'] as TicketActivityType[] },
    { label: 'Changes', types: ['field_change', 'custom_field_change', 'assignment_change'] as TicketActivityType[] }
  ];

  const selectQuickFilter = (types: TicketActivityType[]) => {
    onFiltersChange({
      ...filters,
      activity_types: types.length > 0 ? types : undefined
    });
  };

  const isActive = (types: TicketActivityType[]): boolean => {
    if (types.length === 0) return activeTypes.length === 0;
    return types.every(t => activeTypes.includes(t)) && activeTypes.length === types.length;
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {quickFilters.map((filter) => (
        <Button
          key={filter.label}
          id={`quick-filter-${filter.label.toLowerCase()}`}
          variant={isActive(filter.types) ? 'default' : 'ghost'}
          size="sm"
          onClick={() => selectQuickFilter(filter.types)}
          className="text-xs"
        >
          {filter.label}
        </Button>
      ))}
    </div>
  );
}

export default TimelineFilters;
