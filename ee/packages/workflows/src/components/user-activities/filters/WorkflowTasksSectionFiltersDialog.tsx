'use client';


import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/user-activities');
  // Local state for filters
  const [localFilters, setLocalFilters] = useState<Partial<ActivityFilters>>(() => {
    return { ...initialFilters };
  });

  // Sync local state when initial filters change from parent
  useEffect(() => {
    const { priority, ...rest } = initialFilters;
    setLocalFilters(rest);
    setSelectedPriority(priority?.[0] || 'all');
  }, [initialFilters]);

  const [selectedPriority, setSelectedPriority] = useState<string>(initialFilters.priority?.[0] || 'all');

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
      priority: selectedPriority && selectedPriority !== 'all' ? [selectedPriority as ActivityPriority] : undefined,
    };

    if (!filtersToApply.priority) delete filtersToApply.priority;
    if (!filtersToApply.executionId || filtersToApply.executionId === 'all') delete filtersToApply.executionId;

    onApplyFilters(filtersToApply);
    onOpenChange(false);
  };

  const handleClear = () => {
    const clearedFilters: Partial<ActivityFilters> = {
      isClosed: undefined,
      dueDateStart: undefined,
      dueDateEnd: undefined,
      executionId: 'all',
      search: undefined,
      includeHidden: undefined,
    };
    setLocalFilters(clearedFilters);
    setSelectedPriority('all');
  };

  const footer = (
    <div className="flex justify-between w-full">
      <Button id="workflow-task-filter-clear" variant="outline" onClick={handleClear}>{t('sections.workflowTasks.filterDialog.actions.reset', { defaultValue: 'Reset' })}</Button>
      <div>
        <Button id="workflow-task-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>{t('sections.workflowTasks.filterDialog.actions.cancel', { defaultValue: 'Cancel' })}</Button>
        <Button id="workflow-task-filter-apply" onClick={handleApply}>{t('sections.workflowTasks.filterDialog.actions.apply', { defaultValue: 'Apply Filters' })}</Button>
      </div>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)} footer={footer}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>{t('sections.workflowTasks.filterDialog.title', { defaultValue: 'Filter Workflow Tasks' })}</DialogTitle>
          <DialogDescription>
            {t('sections.workflowTasks.filterDialog.description', { defaultValue: 'Select criteria to filter workflow task activities.' })}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">
          {/* Search Filter */}
          <div className="space-y-1">
            <Label htmlFor="workflow-task-search" className="text-base font-semibold">{t('sections.workflowTasks.filterDialog.fields.search', { defaultValue: 'Search' })}</Label>
            <Input
              id="workflow-task-search"
              value={localFilters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSingleFilterChange('search', e.target.value)}
              placeholder={t('sections.workflowTasks.filterDialog.fields.searchPlaceholder', { defaultValue: 'Search title, description' })}
            />
          </div>

          {/* Workflow Execution Filter */}
          <div className="space-y-1">
            <Label htmlFor="workflow-execution-select" className="text-base font-semibold">{t('sections.workflowTasks.filterDialog.fields.workflowExecution', { defaultValue: 'Workflow Execution' })}</Label>
            <CustomSelect
              id="workflow-execution-select"
              value={localFilters.executionId || 'all'}
              onValueChange={(value) => handleSingleFilterChange('executionId', value === 'all' ? undefined : value)}
              options={[
                { value: 'all', label: t('sections.workflowTasks.filterDialog.fields.allExecutions', { defaultValue: 'All Executions' }) },
                ...workflowExecutions.map(execution => ({
                  value: execution.execution_id,
                  label: execution.workflow_name || execution.execution_id
                }))
              ]}
              placeholder={t('sections.workflowTasks.filterDialog.fields.workflowExecutionPlaceholder', { defaultValue: 'Select Workflow Execution...' })}
            />
          </div>

          {/* Priority Filter */}
          <div className="space-y-1">
            <Label htmlFor="workflow-task-priority-select" className="text-base font-semibold">{t('sections.workflowTasks.filterDialog.fields.priority', { defaultValue: 'Priority' })}</Label>
            <CustomSelect
              id="workflow-task-priority-select"
              value={selectedPriority}
              onValueChange={(value) => setSelectedPriority(value)}
              options={[
                { value: 'all', label: t('sections.workflowTasks.filterDialog.fields.allPriorities', { defaultValue: 'All Priorities' }) },
                { value: ActivityPriority.HIGH, label: t('sections.workflowTasks.filterDialog.fields.priorityHigh', { defaultValue: 'High' }) },
                { value: ActivityPriority.MEDIUM, label: t('sections.workflowTasks.filterDialog.fields.priorityMedium', { defaultValue: 'Medium' }) },
                { value: ActivityPriority.LOW, label: t('sections.workflowTasks.filterDialog.fields.priorityLow', { defaultValue: 'Low' }) },
              ]}
              placeholder={t('sections.workflowTasks.filterDialog.fields.priorityPlaceholder', { defaultValue: 'Select Priority...' })}
            />
          </div>

          {/* Due Date Range */}
          <div className="space-y-1">
            <Label htmlFor="workflow-task-due-date-range" className="text-base font-semibold">{t('sections.workflowTasks.filterDialog.fields.dueDateRange', { defaultValue: 'Due Date Range' })}</Label>
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
              label={t('sections.workflowTasks.filterDialog.fields.showClosedTasks', { defaultValue: 'Show Closed Tasks' })}
              checked={localFilters.isClosed}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalFilters(prev => ({ ...prev, isClosed: e.target.checked }))}
            />
          </div>

          {/* Include Hidden Tasks Filter */}
          <div className="pt-2">
            <Checkbox
              id="include-hidden-workflow-tasks"
              label={t('sections.workflowTasks.filterDialog.fields.includeHiddenTasks', { defaultValue: 'Include Hidden Tasks' })}
              checked={localFilters.includeHidden}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalFilters(prev => ({ ...prev, includeHidden: e.target.checked }))}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
