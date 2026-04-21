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
import { ActivityFilters, IPriority } from "@alga-psa/types";
import { ISO8601String } from '@alga-psa/types';
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { IProject, IProjectPhase } from "@alga-psa/types";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ProjectSectionFiltersDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters: Partial<ActivityFilters>;
  onApplyFilters: (filters: Partial<ActivityFilters>) => void;
  projects: IProject[];
  phases: IProjectPhase[];
  priorities: IPriority[];
}

export function ProjectSectionFiltersDialog({
  isOpen,
  onOpenChange,
  initialFilters,
  onApplyFilters,
  projects = [],
  phases = [],
  priorities = [],
}: ProjectSectionFiltersDialogProps) {
  const { t } = useTranslation('msp/user-activities');
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
  const { projectId, phaseId, priorityIds, ...rest } = initialFilters;
  setLocalFilters(rest);
  setSelectedProjectId(projectId || 'all');
  setSelectedPhaseId(phaseId || 'all');
  setSelectedPriorityId(priorityIds?.[0] || 'all');
}, [initialFilters]);
// Load phases when a project is selected
useEffect(() => {
  async function loadProjectPhases() {
    if (selectedProjectId && selectedProjectId !== 'all') {
      try {
        setLoadingPhases(true);
        // Use getProjectDetails to get phases for the selected project
        const { getProjectDetails } = await import("@alga-psa/projects/actions/projectActions");
        const projectDetails = await getProjectDetails(selectedProjectId);
        if (isActionPermissionError(projectDetails)) {
          setProjectPhases([]);
          return;
        }
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
  const [selectedPriorityId, setSelectedPriorityId] = useState<string>(initialFilters.priorityIds?.[0] || 'all');

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
    // Construct the final filters object, converting single selects back to arrays
    const filtersToApply: Partial<ActivityFilters> = {
        ...localFilters,
        projectId: selectedProjectId !== 'all' ? selectedProjectId : undefined,
        phaseId: selectedPhaseId !== 'all' ? selectedPhaseId : undefined,
        priorityIds: selectedPriorityId && selectedPriorityId !== 'all' ? [selectedPriorityId] : undefined,
    };

    if (!filtersToApply.projectId) delete filtersToApply.projectId;
    if (!filtersToApply.phaseId) delete filtersToApply.phaseId;
    if (!filtersToApply.priorityIds) delete filtersToApply.priorityIds;

    onApplyFilters(filtersToApply);
    onOpenChange(false);
  };

  const handleClear = () => {
    const clearedFilters: Omit<Partial<ActivityFilters>, 'projectId' | 'phaseId' | 'priorityIds'> = {
      isClosed: undefined,
      dueDateStart: undefined,
      dueDateEnd: undefined,
      search: undefined,
    };
    setLocalFilters(clearedFilters);
    setSelectedProjectId('all');
    setSelectedPhaseId('all');
    setSelectedPriorityId('all');
  };

  const footer = (
    <div className="flex justify-between w-full">
      <Button id="project-filter-clear" variant="outline" onClick={handleClear}>{t('sections.projects.filterDialog.actions.reset', { defaultValue: 'Reset' })}</Button>
      <div>
        <Button id="project-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>{t('sections.projects.filterDialog.actions.cancel', { defaultValue: 'Cancel' })}</Button>
        <Button id="project-filter-apply" onClick={handleApply}>{t('sections.projects.filterDialog.actions.apply', { defaultValue: 'Apply Filters' })}</Button>
      </div>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)} footer={footer}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>{t('sections.projects.filterDialog.title', { defaultValue: 'Filter Project Tasks' })}</DialogTitle>
           <DialogDescription>
             {t('sections.projects.filterDialog.description', { defaultValue: 'Select criteria to filter project task activities.' })}
           </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">

          {/* Search Filter */}
          <div className="space-y-1">
            <Label htmlFor="project-search" className="text-base font-semibold">{t('sections.projects.filterDialog.fields.search', { defaultValue: 'Search' })}</Label>
            <Input
              id="project-search"
              value={localFilters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSingleFilterChange('search', e.target.value)}
              placeholder={t('sections.projects.filterDialog.fields.searchPlaceholder', { defaultValue: 'Search title, description' })}
            />
          </div>

          {/* Project and Phase Filters */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-0">
            <div className="space-y-1">
              <Label htmlFor="project-select" className="text-base font-semibold">{t('sections.projects.filterDialog.fields.project', { defaultValue: 'Project' })}</Label>
              <CustomSelect
                id="project-select"
                value={selectedProjectId}
                onValueChange={(value) => {
                  setSelectedProjectId(value);
                  setSelectedPhaseId('all');
                }}
                options={[
                  { value: 'all', label: t('sections.projects.filterDialog.fields.allProjects', { defaultValue: 'All Projects' }) },
                  ...projects.map(project => ({ value: project.project_id, label: project.project_name }))
                ]}
                placeholder={t('sections.projects.filterDialog.fields.projectPlaceholder', { defaultValue: 'Select Project...' })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="phase-select" className="text-base font-semibold">{t('sections.projects.filterDialog.fields.phase', { defaultValue: 'Phase' })}</Label>
              <CustomSelect
                id="phase-select"
                value={selectedPhaseId}
                onValueChange={(value) => setSelectedPhaseId(value)}
                options={[
                  { value: 'all', label: t('sections.projects.filterDialog.fields.allPhases', { defaultValue: 'All Phases' }) },
                  ...projectPhases.map(phase => ({ value: phase.phase_id, label: phase.phase_name }))
                ]}
                placeholder={loadingPhases
                  ? t('sections.projects.filterDialog.fields.phaseLoadingPlaceholder', { defaultValue: 'Loading phases...' })
                  : selectedProjectId
                    ? t('sections.projects.filterDialog.fields.phasePlaceholder', { defaultValue: 'Select Phase...' })
                    : t('sections.projects.filterDialog.fields.phaseSelectFirstPlaceholder', { defaultValue: 'Select a project first' })}
                disabled={!selectedProjectId || loadingPhases}
              />
            </div>
            {/* Priority Filter */}
            {priorities.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="project-priority-select" className="text-base font-semibold">{t('sections.projects.filterDialog.fields.priority', { defaultValue: 'Priority' })}</Label>
                <CustomSelect
                  id="project-priority-select"
                  value={selectedPriorityId}
                  onValueChange={(value) => setSelectedPriorityId(value)}
                  options={[
                    { value: 'all', label: t('sections.projects.filterDialog.fields.allPriorities', { defaultValue: 'All Priorities' }) },
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
                  placeholder={t('sections.projects.filterDialog.fields.priorityPlaceholder', { defaultValue: 'Select Priority...' })}
                />
              </div>
            )}
          </div>

          {/* Due Date Range */}
          <div className="space-y-1">
             <Label htmlFor="project-due-date-range" className="text-base font-semibold">{t('sections.projects.filterDialog.fields.dueDateRange', { defaultValue: 'Due Date Range' })}</Label>
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
                label={t('sections.projects.filterDialog.fields.showClosedTasks', { defaultValue: 'Show Closed Tasks' })}
                checked={localFilters.isClosed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalFilters(prev => ({ ...prev, isClosed: e.target.checked }))}
              />
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
