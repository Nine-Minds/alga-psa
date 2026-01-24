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
import { ActivityFilters, ActivityPriority } from "@alga-psa/types";
import { DateRange } from 'react-day-picker';
import { ISO8601String } from '@alga-psa/types';
import CustomSelect from "@alga-psa/ui/components/CustomSelect";

interface WorkflowExecution {
  execution_id: string;
  workflow_name: string;
}

interface WorkflowTasksSectionFiltersDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters: Partial<ActivityFilters>;
  onApplyFilters: (filters: Partial<ActivityFilters>) => void;
  workflowExecutions: WorkflowExecution[];
}

export function WorkflowTasksSectionFiltersDialog({
  isOpen,
  onOpenChange,
  initialFilters,
  onApplyFilters,
  workflowExecutions = [],
}: WorkflowTasksSectionFiltersDialogProps) {
  // Local state for filters
  const [localFilters, setLocalFilters] = useState<Partial<ActivityFilters>>(() => {
    return { ...initialFilters };
  });

  // Sync local state when initial filters change from parent
  useEffect(() => {
    setLocalFilters({ ...initialFilters });
  }, [initialFilters]);

  const toggleArrayFilter = <K extends keyof ActivityFilters>(
    key: K,
    value: string,
  ) => {
    // Ensure we only toggle array types like 'priority' here
    if (key === 'priority') {
      setLocalFilters((prev) => {
        const currentValues = (prev[key] as string[] | undefined) || [];
        const newValues = [...currentValues];
        const index = newValues.indexOf(value);

        if (index >= 0) {
          newValues.splice(index, 1);
        } else {
          newValues.push(value);
        }
        return { ...prev, [key]: newValues };
      });
    }
  };

  const isPrioritySelected = (value: ActivityPriority): boolean => {
    const currentValues = localFilters.priority || [];
    return currentValues.includes(value);
  };

  const handleSingleFilterChange = <K extends keyof Omit<ActivityFilters, 'priority'>>(
    key: K,
    value: string | null | undefined | boolean
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
      dueDateStart: effectiveStartDate?.toISOString() as ISO8601String | undefined,
      dueDateEnd: endDate?.toISOString() as ISO8601String | undefined,
    }));
  };

  const handleApply = () => {
    // Construct the final filters object
    const filtersToApply: Partial<ActivityFilters> = {
      ...localFilters,
    };

    if (filtersToApply.priority?.length === 0) delete filtersToApply.priority;
    if (!filtersToApply.executionId || filtersToApply.executionId === 'all') delete filtersToApply.executionId;

    onApplyFilters(filtersToApply);
    onOpenChange(false);
  };

  const handleClear = () => {
    const clearedFilters: Partial<ActivityFilters> = {
      priority: [],
      isClosed: undefined,
      dueDateStart: undefined,
      dueDateEnd: undefined,
      executionId: 'all',
      search: undefined,
      includeHidden: undefined,
    };
    setLocalFilters(clearedFilters);
  };

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>Filter Workflow Tasks</DialogTitle>
          <DialogDescription>
            Select criteria to filter workflow task activities.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">
          {/* Search Filter */}
          <div className="space-y-1">
            <Label htmlFor="workflow-task-search" className="text-base font-semibold">Search</Label>
            <Input
              id="workflow-task-search"
              value={localFilters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSingleFilterChange('search', e.target.value)}
              placeholder="Search title, description"
            />
          </div>

          {/* Workflow Execution Filter */}
          <div className="space-y-1">
            <Label htmlFor="workflow-execution-select" className="text-base font-semibold">Workflow Execution</Label>
            <CustomSelect
              id="workflow-execution-select"
              value={localFilters.executionId || 'all'}
              onValueChange={(value) => handleSingleFilterChange('executionId', value === 'all' ? undefined : value)}
              options={[
                { value: 'all', label: 'All Executions' },
                ...workflowExecutions.map(execution => ({
                  value: execution.execution_id,
                  label: execution.workflow_name || execution.execution_id
                }))
              ]}
              placeholder="Select Workflow Execution..."
            />
          </div>

          {/* Priority Filters */}
          <div>
            <Label className="text-base font-semibold">Priority</Label>
            <div className="flex items-center space-x-4 pt-1">
              {[
                { value: ActivityPriority.LOW, label: 'Low' },
                { value: ActivityPriority.MEDIUM, label: 'Medium' },
                { value: ActivityPriority.HIGH, label: 'High' }
              ].map((option) => (
                <Checkbox
                  key={option.value}
                  id={`priority-${option.value}`}
                  label={option.label}
                  checked={isPrioritySelected(option.value)}
                  onChange={() => toggleArrayFilter('priority', option.value)}
                />
              ))}
            </div>
          </div>

          {/* Due Date Range */}
          <div className="space-y-1">
            <Label htmlFor="workflow-task-due-date-range" className="text-base font-semibold">Due Date Range</Label>
            <StringDateRangePicker
              id="workflow-task-due-date-range"
              value={{
                from: localFilters.dueDateStart ? localFilters.dueDateStart.split('T')[0] : '',
                to: localFilters.dueDateEnd ? localFilters.dueDateEnd.split('T')[0] : '',
              }}
              onChange={handleDateChange}
            />
          </div>

          {/* Show Closed Tasks Filter */}
          <div className="pt-2">
            <Checkbox
              id="show-closed-workflow-tasks"
              label="Show Closed Tasks"
              checked={localFilters.isClosed}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalFilters(prev => ({ ...prev, isClosed: e.target.checked }))}
            />
          </div>

          {/* Include Hidden Tasks Filter */}
          <div className="pt-2">
            <Checkbox
              id="include-hidden-workflow-tasks"
              label="Include Hidden Tasks"
              checked={localFilters.includeHidden}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalFilters(prev => ({ ...prev, includeHidden: e.target.checked }))}
            />
          </div>
        </div>
        <DialogFooter>
          <div className="flex justify-between w-full">
            <Button id="workflow-task-filter-clear" variant="outline" onClick={handleClear}>Clear Filters</Button>
            <div>
              <Button id="workflow-task-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button id="workflow-task-filter-apply" onClick={handleApply}>Apply Filters</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
