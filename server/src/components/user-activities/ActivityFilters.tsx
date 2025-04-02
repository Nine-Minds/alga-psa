import React, { useState, useImperativeHandle, forwardRef } from 'react';
import {
  ActivityFilters as ActivityFiltersType,
  ActivityPriority,
  ActivityType
} from '../../interfaces/activity.interfaces';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Label } from '../ui/Label';
import { Checkbox } from '../ui/Checkbox';
import { DateRangePicker } from '../ui/DateRangePicker';

interface ActivityFiltersProps {
  filters: ActivityFiltersType;
  onChange: (filters: ActivityFiltersType) => void;
}

export interface ActivityFiltersRef {
  openDialog: () => void;
}

export const ActivityFilters = forwardRef<ActivityFiltersRef, ActivityFiltersProps>(
  ({ filters, onChange }, ref) => {
    const [open, setOpen] = useState(false);
    const [localFilters, setLocalFilters] = useState<ActivityFiltersType>(filters);

    // Expose openDialog function via ref
    useImperativeHandle(ref, () => ({
      openDialog: () => {
        setLocalFilters(filters); // Ensure local state is synced with parent on open
        setOpen(true);
      }
    }));

    // Reset filters to initial state
    const handleReset = () => {
      const resetFilters: ActivityFiltersType = {
        types: [],
        status: [],
        priority: [],
        assignedTo: [],
        isClosed: false
      };
      setLocalFilters(resetFilters);
      // Optionally apply immediately or wait for Apply button
      // onChange(resetFilters); 
    };

    // Apply filters and close dialog
    const handleApply = () => {
      onChange(localFilters);
      setOpen(false);
    };

    // Update local filters state
    const handleFilterChange = <K extends keyof ActivityFiltersType>(
      key: K,
      value: ActivityFiltersType[K]
    ) => {
      setLocalFilters(prev => ({
        ...prev,
        [key]: value
      }));
    };

    // Toggle a value in an array filter
    const toggleArrayFilter = <T extends string>(
      key: keyof ActivityFiltersType,
      value: T,
      currentValues: T[] = []
    ) => {
      const newValues = [...currentValues];
      const index = newValues.indexOf(value);

      if (index >= 0) {
        newValues.splice(index, 1);
      } else {
        newValues.push(value);
      }

      handleFilterChange(key, newValues as any);
    };

    // Check if a value is selected in an array filter
    const isSelected = <T extends string>(
      value: T,
      currentValues: T[] = []
    ): boolean => {
      return currentValues.includes(value);
    };

    return (
      // Pass isOpen and onClose to Dialog for controlled state
      <Dialog isOpen={open} onClose={() => setOpen(false)}>
        {/* Trigger button is now removed from here and placed in the parent */}
        {/* DialogContent is always rendered, Dialog controls visibility */}
        <DialogContent className="sm:max-w-[425px]">
          {/* Removed onInteractOutside and onEscapeKeyDown */}
          <DialogHeader>
            <DialogTitle>Filter Activities</DialogTitle>
            <DialogDescription>
              Select criteria to filter your activities
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Activity Types Filter */}
            <div className="space-y-2">
              <Label htmlFor="activity-types">Activity Types</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: ActivityType.SCHEDULE, label: 'Schedule' },
                  { value: ActivityType.PROJECT_TASK, label: 'Project Tasks' },
                  { value: ActivityType.TICKET, label: 'Tickets' },
                  { value: ActivityType.TIME_ENTRY, label: 'Time Entries' },
                  { value: ActivityType.WORKFLOW_TASK, label: 'Workflow Tasks' }
                ].map(option => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`activity-type-${option.value}`}
                      checked={isSelected(option.value, localFilters.types)}
                      onChange={() => toggleArrayFilter('types', option.value, localFilters.types)}
                    />
                    <Label htmlFor={`activity-type-${option.value}`}>{option.label}</Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Priority Filter */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <div className="flex space-x-4">
                {[
                  { value: ActivityPriority.LOW, label: 'Low' },
                  { value: ActivityPriority.MEDIUM, label: 'Medium' },
                  { value: ActivityPriority.HIGH, label: 'High' }
                ].map(option => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`priority-${option.value}`}
                      checked={isSelected(option.value, localFilters.priority)}
                      onChange={() => toggleArrayFilter('priority', option.value, localFilters.priority)}
                    />
                    <Label htmlFor={`priority-${option.value}`}>{option.label}</Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="space-y-2">
              <Label>Due Date Range</Label>
              <DateRangePicker
                value={{
                  from: localFilters.dueDateStart ? new Date(localFilters.dueDateStart).toISOString().split('T')[0] : '',
                  to: localFilters.dueDateEnd ? new Date(localFilters.dueDateEnd).toISOString().split('T')[0] : ''
                }}
                onChange={(range) => {
                  handleFilterChange('dueDateStart', range.from ? new Date(range.from).toISOString() as any : undefined);
                  handleFilterChange('dueDateEnd', range.to ? new Date(range.to).toISOString() as any : undefined);
                }}
              />
            </div>

            {/* Show Closed Activities */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-closed"
                checked={localFilters.isClosed}
                onChange={(e) => {
                    // Correctly access checked status for Shadcn Checkbox
                    const isChecked = typeof e === 'boolean' ? e : (e.target as HTMLInputElement).checked;
                    handleFilterChange('isClosed', isChecked);
                  }
                }
              />
              <Label htmlFor="show-closed">Show closed activities</Label>
            </div>
          </div>

          <DialogFooter>
            <div className="flex justify-between w-full">
              <Button
                id="reset-filters-button"
                type="button"
                variant="outline"
                onClick={handleReset}
              >
                Reset
              </Button>
              <Button
                id="apply-filters-button"
                type="button" 
                onClick={handleApply}
              >
                Apply Filters
              </Button>
            </div>
          </DialogFooter>
          </DialogContent>
      </Dialog>
    );
  }
);

ActivityFilters.displayName = 'ActivityFilters'; // Add display name for DevTools