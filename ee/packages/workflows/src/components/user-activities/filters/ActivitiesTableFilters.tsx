'use client';


import React, { useState, useCallback, useMemo } from 'react';
import {
  ActivityFilters as ActivityFiltersType,
  ActivityType,
  IPriority
} from "@alga-psa/types";

export interface ProjectWithPhases {
  project_id: string;
  project_name: string;
  is_inactive: boolean;
  phases: Array<{ phase_id: string; phase_name: string; wbs_code: string }>;
}

type ProjectNodeType = 'project' | 'phase';
import { Button } from "@alga-psa/ui/components/Button";
import { Label } from "@alga-psa/ui/components/Label";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { StringDateRangePicker } from "@alga-psa/ui/components/DateRangePicker";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import TreeSelect, { TreeSelectOption } from "@alga-psa/ui/components/TreeSelect";
import { RotateCcw } from 'lucide-react';
import { DEFAULT_TABLE_TYPES } from '../constants';

// Activity types that support priority filtering via the priorities table
const PRIORITY_FILTERABLE_TYPES = new Set([ActivityType.TICKET, ActivityType.PROJECT_TASK]);

// Time entries and notifications are intentionally excluded from the list view —
// they create noise and aren't meaningful "tasks to do today".
const ACTIVITY_TYPE_OPTIONS = [
  { value: ActivityType.SCHEDULE, label: 'Schedule' },
  { value: ActivityType.PROJECT_TASK, label: 'Project Tasks' },
  { value: ActivityType.TICKET, label: 'Tickets' },
  { value: ActivityType.WORKFLOW_TASK, label: 'Workflow Tasks' },
];

interface ActivitiesTableFiltersProps {
  filters: ActivityFiltersType;
  onChange: (filters: ActivityFiltersType) => void;
  priorities?: IPriority[];
  projects?: ProjectWithPhases[];
}

export function ActivitiesTableFilters({
  filters,
  onChange,
  priorities = [],
  projects = []
}: ActivitiesTableFiltersProps) {
  const [selectedPriorityId, setSelectedPriorityId] = useState<string>(filters.priorityIds?.[0] || 'all');

  // Determine if priority filter should be enabled based on selected types
  const isPriorityFilterAvailable = filters.types?.length === 1
    && PRIORITY_FILTERABLE_TYPES.has(filters.types[0]);

  const handleReset = useCallback(() => {
    setSelectedPriorityId('all');
    onChange({
      types: DEFAULT_TABLE_TYPES,
      status: [],
      assignedTo: [],
      isClosed: false,
      projectIds: undefined,
      phaseIds: undefined,
    });
  }, [onChange]);

  // Toggle a value in an array filter and apply immediately
  const toggleType = useCallback((typeValue: ActivityType) => {
    const currentTypes = filters.types || [];
    const newTypes = currentTypes.includes(typeValue)
      ? currentTypes.filter(t => t !== typeValue)
      : [...currentTypes, typeValue];

    // Clear priority selection if the result is no longer a single prioritized type
    const stillFilterable = newTypes.length === 1 && PRIORITY_FILTERABLE_TYPES.has(newTypes[0]);
    const updatedFilters: ActivityFiltersType = { ...filters, types: newTypes };
    if (!stillFilterable) {
      setSelectedPriorityId('all');
      delete updatedFilters.priorityIds;
    }
    onChange(updatedFilters);
  }, [filters, onChange]);

  const handlePriorityChange = useCallback((value: string) => {
    setSelectedPriorityId(value);
    const updatedFilters: ActivityFiltersType = {
      ...filters,
      priorityIds: value && value !== 'all' ? [value] : undefined,
    };
    if (!updatedFilters.priorityIds) delete updatedFilters.priorityIds;
    delete updatedFilters.priority;
    onChange(updatedFilters);
  }, [filters, onChange]);

  const handleDateRangeChange = useCallback((range: { from: string; to: string }) => {
    const startDate = range.from ? new Date(range.from) : undefined;
    const endDate = range.to ? new Date(range.to) : undefined;
    const effectiveStartDate = !startDate && endDate ? new Date() : startDate;

    if (effectiveStartDate) effectiveStartDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);

    onChange({
      ...filters,
      dueDateStart: effectiveStartDate ? effectiveStartDate.toISOString() as any : undefined,
      dueDateEnd: endDate ? endDate.toISOString() as any : undefined,
    });
  }, [filters, onChange]);

  const handleProjectTreeToggle = useCallback((value: string, type: ProjectNodeType) => {
    if (!value) {
      // Reset clicked — clear both projects and phases
      const next: ActivityFiltersType = { ...filters };
      delete next.projectIds;
      delete next.phaseIds;
      onChange(next);
      return;
    }

    if (type === 'project') {
      const current = filters.projectIds || [];
      const isSelected = current.includes(value);
      const updated = isSelected
        ? current.filter(id => id !== value)
        : [...current, value];
      const next: ActivityFiltersType = { ...filters };
      if (updated.length > 0) {
        next.projectIds = updated;
      } else {
        delete next.projectIds;
      }
      onChange(next);
      return;
    }

    if (type === 'phase') {
      const current = filters.phaseIds || [];
      const isSelected = current.includes(value);
      const updated = isSelected
        ? current.filter(id => id !== value)
        : [...current, value];
      const next: ActivityFiltersType = { ...filters };
      if (updated.length > 0) {
        next.phaseIds = updated;
      } else {
        delete next.phaseIds;
      }
      onChange(next);
    }
  }, [filters, onChange]);

  // Build project/phase tree options with selected state
  const projectTreeOptions = useMemo((): TreeSelectOption<ProjectNodeType>[] => {
    const selectedProjectIds = new Set(filters.projectIds || []);
    const selectedPhaseIds = new Set(filters.phaseIds || []);
    return projects.map(p => ({
      value: p.project_id,
      label: p.project_name,
      type: 'project' as const,
      selected: selectedProjectIds.has(p.project_id),
      children: p.phases.map(phase => ({
        value: phase.phase_id,
        label: phase.phase_name,
        type: 'phase' as const,
        selected: selectedPhaseIds.has(phase.phase_id),
      })),
    }));
  }, [projects, filters.projectIds, filters.phaseIds]);

  const handleClosedToggle = useCallback((e: boolean | React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = typeof e === 'boolean' ? e : (e.target as HTMLInputElement).checked;
    onChange({ ...filters, isClosed: isChecked });
  }, [filters, onChange]);

  return (
    <div className="border-b border-border pb-4 mb-4">
      {/* Row 1: Activity types */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <Label className="text-sm font-semibold whitespace-nowrap">Types:</Label>
        {ACTIVITY_TYPE_OPTIONS.map(option => (
          <Checkbox
            key={option.value}
            id={`activity-type-${option.value}`}
            label={option.label}
            checked={(filters.types || []).includes(option.value)}
            onChange={() => toggleType(option.value)}
            containerClassName="mb-0"
            size="sm"
          />
        ))}
      </div>

      {/* Row 2: Priority, Date Range, Show Closed, Reset */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        {/* Priority filter */}
        {isPriorityFilterAvailable && priorities.length > 0 && (
          <div className="min-w-[180px]">
            <Label htmlFor="priority-select" className="text-sm font-semibold mb-1 block">Priority</Label>
            <CustomSelect
              id="priority-select"
              value={selectedPriorityId}
              onValueChange={handlePriorityChange}
              options={[
                { value: 'all', label: 'All Priorities' },
                ...priorities.map(p => ({
                  value: p.priority_id,
                  label: (
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: p.color || '#94a3b8' }}
                      />
                      {p.priority_name}
                    </span>
                  ),
                  textValue: p.priority_name,
                }))
              ]}
              placeholder="Select Priority..."
              size="sm"
            />
          </div>
        )}

        {/* Project + phase filter */}
        {projects.length > 0 && (
          <div className="min-w-[220px] max-w-[320px]">
            <Label className="text-sm font-semibold mb-1 block">Projects / Phases</Label>
            <TreeSelect<ProjectNodeType>
              options={projectTreeOptions}
              value=""
              onValueChange={handleProjectTreeToggle}
              placeholder="All Projects"
              multiSelect
              showReset
              allowEmpty
            />
          </div>
        )}

        {/* Date range filter */}
        <div className="min-w-[240px]">
          <Label className="text-sm font-semibold mb-1 block">Due Date</Label>
          <StringDateRangePicker
            id="activities-due-date-range"
            value={{
              from: filters.dueDateStart ? new Date(filters.dueDateStart).toISOString().split('T')[0] : '',
              to: filters.dueDateEnd ? new Date(filters.dueDateEnd).toISOString().split('T')[0] : ''
            }}
            onChange={handleDateRangeChange}
          />
        </div>

        {/* Show closed */}
        <div className="flex items-center pb-0.5">
          <Checkbox
            id="show-closed"
            label="Show closed"
            checked={filters.isClosed}
            onChange={handleClosedToggle}
            containerClassName="mb-0"
            size="sm"
          />
        </div>

        {/* Reset button */}
        <div className="flex items-center pb-0.5 ml-auto">
          <Button
            id="reset-filters-button"
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
