'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@alga-psa/ui/components/Dialog";
import { Button } from "@alga-psa/ui/components/Button";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { Label } from "@alga-psa/ui/components/Label";
import { Input } from "@alga-psa/ui/components/Input";
import { StringDateRangePicker } from "@alga-psa/ui/components/DateRangePicker";
import { ActivityFilters, ActivityType } from "server/src/interfaces/activity.interfaces";
import { ISO8601String } from '@alga-psa/types';
import CustomSelect from "@alga-psa/ui/components/CustomSelect";

interface ScheduleSectionFiltersDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters: Partial<ActivityFilters>;
  onApplyFilters: (filters: Partial<ActivityFilters>) => void;
}

export function ScheduleSectionFiltersDialog({
  isOpen,
  onOpenChange,
  initialFilters,
  onApplyFilters,
}: ScheduleSectionFiltersDialogProps) {
  // Local state for filters
  const [localFilters, setLocalFilters] = useState<Partial<ActivityFilters>>(() => {
    return { ...initialFilters };
  });

  // Separate state for the work item type dropdown
  const [selectedWorkItemType, setSelectedWorkItemType] = useState<string>(initialFilters.workItemType || 'all');

  // Sync local state when initial filters change from parent
  useEffect(() => {
    setLocalFilters({ ...initialFilters });
    setSelectedWorkItemType(initialFilters.workItemType || 'all');
  }, [initialFilters]);

  const handleSingleFilterChange = <K extends keyof ActivityFilters>(
    key: K,
    value: string | boolean | null | undefined
  ) => {
    setLocalFilters((prev) => ({
      ...prev,
      [key]: value === null ? undefined : value
    }));
  };

  const handleDateChange = (range: { from: string; to: string }) => {
    const startDate = range.from ? new Date(range.from + 'T00:00:00Z') : undefined;
    const endDate = range.to ? new Date(range.to + 'T23:59:59Z') : undefined;

    const effectiveStartDate = !startDate && endDate ? new Date(endDate) : startDate;
    if (effectiveStartDate && !startDate && endDate) {
      effectiveStartDate.setUTCHours(0, 0, 0, 0);
    }

    setLocalFilters((prev) => ({
      ...prev,
      dateRangeStart: effectiveStartDate?.toISOString() as ISO8601String | undefined,
      dateRangeEnd: endDate?.toISOString() as ISO8601String | undefined,
    }));
  };

  const handleApply = () => {
    // Construct the final filters object
    const filtersToApply: Partial<ActivityFilters> = {
      ...localFilters,
      workItemType: selectedWorkItemType !== 'all' ? selectedWorkItemType : undefined,
    };

    // Clean up undefined values
    if (!filtersToApply.workItemType) delete filtersToApply.workItemType;
    if (!filtersToApply.search) delete filtersToApply.search;

    onApplyFilters(filtersToApply);
    onOpenChange(false);
  };

  const handleClear = () => {
    const clearedFilters: Partial<ActivityFilters> = {
      isClosed: undefined,
      dateRangeStart: undefined,
      dateRangeEnd: undefined,
      isRecurring: undefined,
      workItemType: undefined,
      search: undefined,
    };
    setLocalFilters(clearedFilters);
    setSelectedWorkItemType('all');
  };

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>Filter Schedule Entries</DialogTitle>
          <DialogDescription>
            Select criteria to filter schedule activities.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">
          {/* Search Filter */}
          <div className="space-y-1">
            <Label htmlFor="schedule-search" className="text-base font-semibold">Search</Label>
            <Input
              id="schedule-search"
              value={localFilters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSingleFilterChange('search', e.target.value)}
              placeholder="Search title, description"
            />
          </div>

          {/* Date Range */}
          <div className="space-y-1">
            <Label htmlFor="schedule-date-range" className="text-base font-semibold">Date Range</Label>
            <StringDateRangePicker
              id="schedule-date-range"
              value={{
                from: localFilters.dateRangeStart ? localFilters.dateRangeStart.split('T')[0] : '',
                to: localFilters.dateRangeEnd ? localFilters.dateRangeEnd.split('T')[0] : '',
              }}
              onChange={handleDateChange}
            />
          </div>

          {/* Work Item Type Filter */}
          <div className="space-y-1">
            <Label htmlFor="work-item-type-select" className="text-base font-semibold">Related Work Item Type</Label>
            <CustomSelect
              id="work-item-type-select"
              value={selectedWorkItemType}
              onValueChange={(value) => setSelectedWorkItemType(value)}
              options={[
                { value: 'all', label: 'All Types' },
                { value: ActivityType.TICKET, label: 'Ticket' },
                { value: ActivityType.PROJECT_TASK, label: 'Project Task' },
                { value: ActivityType.WORKFLOW_TASK, label: 'Workflow Task' },
              ]}
              placeholder="Select Work Item Type..."
            />
          </div>

          {/* Show Closed and Recurring Filters in 2 columns */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-0 pt-2">
            <div>
              <Checkbox
                id="show-closed-schedule"
                label="Show Closed Entries"
                checked={localFilters.isClosed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLocalFilters(prev => ({ ...prev, isClosed: e.target.checked }))
                }
              />
            </div>
            <div>
              <Checkbox
                id="show-recurring-only"
                label="Show Recurring Only"
                checked={localFilters.isRecurring === true}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLocalFilters(prev => ({ ...prev, isRecurring: e.target.checked ? true : undefined }))
                }
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <div className="flex justify-between w-full">
            <Button id="schedule-filter-clear" variant="outline" onClick={handleClear}>Clear Filters</Button>
            <div>
              <Button id="schedule-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button id="schedule-filter-apply" onClick={handleApply}>Apply Filters</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
