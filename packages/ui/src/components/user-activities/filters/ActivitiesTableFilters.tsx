'use client';

import React, { useState, useImperativeHandle, forwardRef } from 'react';
import {
  ActivityFilters as ActivityFiltersType,
  ActivityPriority,
  ActivityType
} from "@alga-psa/types";
import { Button } from "@alga-psa/ui/components/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alga-psa/ui/components/Dialog";
import { Label } from "@alga-psa/ui/components/Label";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { StringDateRangePicker } from "@alga-psa/ui/components/DateRangePicker";

interface ActivitiesTableFiltersProps {
  filters: ActivityFiltersType;
  onChange: (filters: ActivityFiltersType) => void;
}

export interface ActivitiesTableFiltersRef {
  openDialog: () => void;
}

export const ActivitiesTableFilters = forwardRef<ActivitiesTableFiltersRef, ActivitiesTableFiltersProps>(
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
        <DialogContent className="sm:max-w-[450px]">
          {/* Removed onInteractOutside and onEscapeKeyDown */}
          <DialogHeader>
            <DialogTitle>Filter Activities</DialogTitle>
            <DialogDescription>
              Select criteria to filter your activities
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            {/* Activity Types Filter */}
            <div>
              <Label htmlFor="activity-types" className="text-lg font-semibold">Activity Types</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: ActivityType.SCHEDULE, label: 'Schedule' },
                  { value: ActivityType.PROJECT_TASK, label: 'Project Tasks' },
                  { value: ActivityType.TICKET, label: 'Tickets' },
                  { value: ActivityType.TIME_ENTRY, label: 'Time Entries' },
                  { value: ActivityType.WORKFLOW_TASK, label: 'Workflow Tasks' },
                  { value: ActivityType.NOTIFICATION, label: 'Notifications' }
                ].map(option => (
                    <Checkbox
                      key={option.value}
                      id={`activity-type-${option.value}`}
                      label={option.label}
                      checked={isSelected(option.value, localFilters.types)}
                      onChange={() => toggleArrayFilter('types', option.value, localFilters.types)}
                    />
                ))}
              </div>
            </div>

            {/* Priority Filter */}
            <div className="mt-4">
              <Label htmlFor="priority" className="text-lg font-semibold">Priority</Label>
              <div className="flex space-x-4">
                {[
                  { value: ActivityPriority.LOW, label: 'Low' },
                  { value: ActivityPriority.MEDIUM, label: 'Medium' },
                  { value: ActivityPriority.HIGH, label: 'High' }
                ].map(option => (
                    <Checkbox
                      key={option.value}
                      id={`priority-${option.value}`}
                      label={option.label}
                      checked={isSelected(option.value, localFilters.priority)}
                      onChange={() => toggleArrayFilter('priority', option.value, localFilters.priority)}
                    />
                ))}
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="mt-4">
              <Label className="text-lg font-semibold">Due Date Range</Label>
              <StringDateRangePicker
                id="activities-due-date-range"
                value={{
                  from: localFilters.dueDateStart ? new Date(localFilters.dueDateStart).toISOString().split('T')[0] : '',
                  to: localFilters.dueDateEnd ? new Date(localFilters.dueDateEnd).toISOString().split('T')[0] : ''
                }}
                onChange={(range) => {
                  // If date is empty string, set to undefined
                  const startDate = range.from ? new Date(range.from) : undefined;
                  const endDate = range.to ? new Date(range.to) : undefined;
                  
                  // If we have an end date but no start date, set start date to today
                  const effectiveStartDate = !startDate && endDate ? new Date() : startDate;
                  
                  // Set the time to the beginning of the day for start date and end of the day for end date
                  if (effectiveStartDate) {
                    effectiveStartDate.setHours(0, 0, 0, 0);
                  }
                  
                  if (endDate) {
                    endDate.setHours(23, 59, 59, 999);
                  }
                  
                  handleFilterChange('dueDateStart', effectiveStartDate ? effectiveStartDate.toISOString() as any : undefined);
                  handleFilterChange('dueDateEnd', endDate ? endDate.toISOString() as any : undefined);
                }}
              />
            </div>

            {/* Show Closed Activities */}
            <Checkbox
              id="show-closed"
              label="Show closed activities"
              checked={localFilters.isClosed}
              onChange={(e) => {
                  // Correctly access checked status for Shadcn Checkbox
                  const isChecked = typeof e === 'boolean' ? e : (e.target as HTMLInputElement).checked;
                  handleFilterChange('isClosed', isChecked);
                }
              }
            />
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

ActivitiesTableFilters.displayName = 'ActivitiesTableFilters';