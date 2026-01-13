'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "server/src/components/ui/Dialog";
import { Button } from "server/src/components/ui/Button";
import { Checkbox } from "server/src/components/ui/Checkbox";
import { Label } from "server/src/components/ui/Label";
import { Input } from "server/src/components/ui/Input";
import { StringDateRangePicker } from "server/src/components/ui/DateRangePicker";
import { ActivityFilters, ActivityPriority } from "server/src/interfaces/activity.interfaces";
import { ISO8601String } from '@alga-psa/shared/types';
import CustomSelect from "server/src/components/ui/CustomSelect";
import { IProject, IProjectPhase } from "server/src/interfaces/project.interfaces";

interface ProjectSectionFiltersDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters: Partial<ActivityFilters>;
  onApplyFilters: (filters: Partial<ActivityFilters>) => void;
  projects: IProject[];
  phases: IProjectPhase[];
}

export function ProjectSectionFiltersDialog({
  isOpen,
  onOpenChange,
  initialFilters,
  onApplyFilters,
  projects = [],
  phases = [],
}: ProjectSectionFiltersDialogProps) {
  // Local state excluding projectId and phaseId, which are handled separately
  const [localFilters, setLocalFilters] = useState<Omit<Partial<ActivityFilters>, 'projectId' | 'phaseId'>>(() => {
    const { projectId, phaseId, ...rest } = initialFilters;
    return rest;
  });
  
  // Separate state for the single-select project and phase dropdowns
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialFilters.projectId || 'all');
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>(initialFilters.phaseId || 'all');
  
  // State for project phases
  const [projectPhases, setProjectPhases] = useState<IProjectPhase[]>([]);
  const [loadingPhases, setLoadingPhases] = useState<boolean>(false);
// Sync local state when initial filters change from parent
useEffect(() => {
  const { projectId, phaseId, ...rest } = initialFilters;
  setLocalFilters(rest);
  setSelectedProjectId(projectId || 'all');
  setSelectedPhaseId(phaseId || 'all');
}, [initialFilters]);
// Load phases when a project is selected
useEffect(() => {
  async function loadProjectPhases() {
    if (selectedProjectId && selectedProjectId !== 'all') {
      try {
        setLoadingPhases(true);
        // Use getProjectDetails to get phases for the selected project
        const { getProjectDetails } = await import("server/src/lib/actions/project-actions/projectActions");
        const projectDetails = await getProjectDetails(selectedProjectId);
        setProjectPhases(projectDetails.phases);
      } catch (error) {
        console.error('Error loading project phases:', error);
        setProjectPhases([]);
      } finally {
        setLoadingPhases(false);
      }
    } else {
      setProjectPhases([]);
      setSelectedPhaseId('all');
    }
  }
  
  loadProjectPhases();
}, [selectedProjectId]);
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

  const handleSingleFilterChange = <K extends keyof Omit<ActivityFilters, 'projectId' | 'phaseId' | 'priority'>>( // Exclude array types
    key: K,
    value: string | null | undefined
  ) => {
    setLocalFilters((prev) => ({
      ...prev,
      [key]: value || undefined
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
        projectId: selectedProjectId !== 'all' ? selectedProjectId : undefined,
        phaseId: selectedPhaseId !== 'all' ? selectedPhaseId : undefined,
    };

    if (filtersToApply.priority?.length === 0) delete filtersToApply.priority;
    if (!filtersToApply.projectId) delete filtersToApply.projectId;
    if (!filtersToApply.phaseId) delete filtersToApply.phaseId;

    onApplyFilters(filtersToApply);
    onOpenChange(false);
  };

  const handleClear = () => {
    const clearedFilters: Omit<Partial<ActivityFilters>, 'projectId' | 'phaseId'> = {
      priority: [],
      isClosed: undefined,
      dueDateStart: undefined,
      dueDateEnd: undefined,
      search: undefined,
    };
    setLocalFilters(clearedFilters);
    setSelectedProjectId('all');
    setSelectedPhaseId('all');
  };

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>Filter Project Tasks</DialogTitle>
           <DialogDescription>
             Select criteria to filter project task activities.
           </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">

          {/* Search Filter */}
          <div className="space-y-1">
            <Label htmlFor="project-search" className="text-base font-semibold">Search</Label>
            <Input
              id="project-search"
              value={localFilters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSingleFilterChange('search', e.target.value)}
              placeholder="Search title, description"
            />
          </div>

          {/* Project and Phase Filters */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-0">
            <div className="space-y-1">
              <Label htmlFor="project-select" className="text-base font-semibold">Project</Label>
              <CustomSelect
                id="project-select"
                value={selectedProjectId}
                onValueChange={(value) => {
                  setSelectedProjectId(value);
                  setSelectedPhaseId('all');
                }}
                options={[
                  { value: 'all', label: 'All Projects' },
                  ...projects.map(project => ({ value: project.project_id, label: project.project_name }))
                ]}
                placeholder="Select Project..."
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="phase-select" className="text-base font-semibold">Phase</Label>
              <CustomSelect
                id="phase-select"
                value={selectedPhaseId}
                onValueChange={(value) => setSelectedPhaseId(value)}
                options={[
                  { value: 'all', label: 'All Phases' },
                  ...projectPhases.map(phase => ({ value: phase.phase_id, label: phase.phase_name }))
                ]}
                placeholder={loadingPhases ? "Loading phases..." : selectedProjectId ? "Select Phase..." : "Select a project first"}
                disabled={!selectedProjectId || loadingPhases}
              />
            </div>
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
             <Label htmlFor="project-due-date-range" className="text-base font-semibold">Due Date Range</Label>
             <StringDateRangePicker
                id="project-due-date-range"
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
                id="show-closed-tasks"
                label="Show Closed Tasks"
                checked={localFilters.isClosed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalFilters(prev => ({ ...prev, isClosed: e.target.checked }))}
              />
          </div>

        </div>
        <DialogFooter>
           <div className="flex justify-between w-full">
             <Button id="project-filter-clear" variant="outline" onClick={handleClear}>Clear Filters</Button>
             <div>
               <Button id="project-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>Cancel</Button>
               <Button id="project-filter-apply" onClick={handleApply}>Apply Filters</Button>
             </div>
           </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
