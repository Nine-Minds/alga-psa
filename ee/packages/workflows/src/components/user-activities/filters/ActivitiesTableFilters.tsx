'use client';


import React, { useState, useCallback, useMemo } from 'react';
import {
  ActivityFilters as ActivityFiltersType,
  ActivityType,
  IPriority,
  IStatus,
  ITag,
  ProjectWithPhases,
} from "@alga-psa/types";

import { Button } from "@alga-psa/ui/components/Button";
import { Label } from "@alga-psa/ui/components/Label";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { SearchInput } from "@alga-psa/ui/components/SearchInput";
import { StringDateRangePicker } from "@alga-psa/ui/components/DateRangePicker";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import TreeSelect, { TreeSelectOption } from "@alga-psa/ui/components/TreeSelect";
import { TagFilter } from "@alga-psa/ui/components";
import { RotateCcw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { DEFAULT_TABLE_TYPES } from '../constants';

const PRIORITY_FILTERABLE_TYPES = new Set([ActivityType.TICKET, ActivityType.PROJECT_TASK]);

type ProjectNodeType = 'project' | 'phase' | 'status';

interface ActivitiesTableFiltersProps {
  filters: ActivityFiltersType;
  onChange: (filters: ActivityFiltersType) => void;
  priorities?: IPriority[];
  projects?: ProjectWithPhases[];
  boards?: Array<{ board_id?: string; board_name?: string }>;
  ticketStatuses?: IStatus[];
  ticketTags?: ITag[];
  projectTaskTags?: ITag[];
}

// Deduplicate statuses by name, optionally scoped to a board
function buildUniqueStatusOptions(
  statuses: IStatus[],
  boardId?: string
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>(); // name → first status_id
  for (const s of statuses) {
    if (boardId && s.board_id !== boardId) continue;
    if (!seen.has(s.name)) {
      seen.set(s.name, s.status_id);
    }
  }
  return Array.from(seen.entries()).map(([name, id]) => ({
    value: id,
    label: name,
  }));
}

// Collect all status_ids that share a name (for cross-board filtering)
function getStatusIdsByName(statuses: IStatus[], statusId: string): string[] {
  const target = statuses.find((s) => s.status_id === statusId);
  if (!target) return [statusId];
  return statuses
    .filter((s) => s.name === target.name)
    .map((s) => s.status_id);
}

export function ActivitiesTableFilters({
  filters,
  onChange,
  priorities = [],
  projects = [],
  boards = [],
  ticketStatuses = [],
  ticketTags = [],
  projectTaskTags = [],
}: ActivitiesTableFiltersProps) {
  const { t } = useTranslation('msp/user-activities');
  const ACTIVITY_TYPE_OPTIONS = [
    { value: ActivityType.SCHEDULE, label: t('filters.activityTypeOptions.schedule', { defaultValue: 'Schedule' }) },
    { value: ActivityType.PROJECT_TASK, label: t('filters.activityTypeOptions.projectTask', { defaultValue: 'Project Tasks' }) },
    { value: ActivityType.TICKET, label: t('filters.activityTypeOptions.ticket', { defaultValue: 'Tickets' }) },
    { value: ActivityType.WORKFLOW_TASK, label: t('filters.activityTypeOptions.workflowTask', { defaultValue: 'Workflow Tasks' }) },
  ];
  const [selectedPriorityId, setSelectedPriorityId] = useState<string>(
    filters.priorityIds?.[0] || 'all'
  );

  const selectedTypes = filters.types || [];
  const hasTickets = selectedTypes.includes(ActivityType.TICKET);
  const hasProjectTasks = selectedTypes.includes(ActivityType.PROJECT_TASK);

  const isPriorityFilterAvailable =
    selectedTypes.length === 1 && PRIORITY_FILTERABLE_TYPES.has(selectedTypes[0]);

  // -------- Handlers -------------------------------------------------------

  const handleReset = useCallback(() => {
    setSelectedPriorityId('all');
    onChange({
      types: DEFAULT_TABLE_TYPES,
      isClosed: false,
    });
  }, [onChange]);

  const toggleType = useCallback(
    (typeValue: ActivityType) => {
      const currentTypes = filters.types || [];
      const newTypes = currentTypes.includes(typeValue)
        ? currentTypes.filter((t) => t !== typeValue)
        : [...currentTypes, typeValue];

      const next: ActivityFiltersType = { ...filters, types: newTypes };

      if (!newTypes.includes(ActivityType.TICKET)) {
        delete next.ticketBoardIds;
        delete next.ticketStatusIds;
        delete next.ticketTagIds;
      }
      if (!newTypes.includes(ActivityType.PROJECT_TASK)) {
        delete next.projectIds;
        delete next.phaseIds;
        delete next.projectStatusMappingIds;
        delete next.projectTaskTagIds;
      }

      const stillFilterable =
        newTypes.length === 1 && PRIORITY_FILTERABLE_TYPES.has(newTypes[0]);
      if (!stillFilterable) {
        setSelectedPriorityId('all');
        delete next.priorityIds;
      }

      onChange(next);
    },
    [filters, onChange]
  );

  const handlePriorityChange = useCallback(
    (value: string) => {
      setSelectedPriorityId(value);
      const next: ActivityFiltersType = {
        ...filters,
        priorityIds: value && value !== 'all' ? [value] : undefined,
      };
      if (!next.priorityIds) delete next.priorityIds;
      delete next.priority;
      onChange(next);
    },
    [filters, onChange]
  );

  const handleDateRangeChange = useCallback(
    (range: { from: string; to: string }) => {
      const startDate = range.from ? new Date(range.from) : undefined;
      const endDate = range.to ? new Date(range.to) : undefined;
      const effectiveStartDate = !startDate && endDate ? new Date() : startDate;
      if (effectiveStartDate) effectiveStartDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);
      onChange({
        ...filters,
        dueDateStart: effectiveStartDate
          ? (effectiveStartDate.toISOString() as any)
          : undefined,
        dueDateEnd: endDate ? (endDate.toISOString() as any) : undefined,
      });
    },
    [filters, onChange]
  );

  const handleClosedToggle = useCallback(
    (e: boolean | React.ChangeEvent<HTMLInputElement>) => {
      const isChecked =
        typeof e === 'boolean' ? e : (e.target as HTMLInputElement).checked;
      onChange({ ...filters, isClosed: isChecked });
    },
    [filters, onChange]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const search = e.target.value;
      const next: ActivityFiltersType = { ...filters, search };
      if (!search.trim()) {
        delete next.search;
      }
      onChange(next);
    },
    [filters, onChange]
  );

  const handleSearchClear = useCallback(() => {
    const next: ActivityFiltersType = { ...filters };
    delete next.search;
    onChange(next);
  }, [filters, onChange]);

  // -------- Ticket board (multi-select) ------------------------------------

  const boardTreeOptions = useMemo((): TreeSelectOption<'board'>[] => {
    const selectedIds = new Set(filters.ticketBoardIds || []);
    return boards
      .filter((b) => b.board_id && b.board_name)
      .map((b) => ({
        value: b.board_id!,
        label: b.board_name!,
        type: 'board' as const,
        selected: selectedIds.has(b.board_id!),
      }));
  }, [boards, filters.ticketBoardIds]);

  const handleBoardToggle = useCallback(
    (value: string, _type: string) => {
      if (!value) {
        const next = { ...filters };
        delete next.ticketBoardIds;
        delete next.ticketStatusIds;
        onChange(next);
        return;
      }
      const current = filters.ticketBoardIds || [];
      const updated = current.includes(value)
        ? current.filter((id) => id !== value)
        : [...current, value];
      onChange({
        ...filters,
        ticketBoardIds: updated.length > 0 ? updated : undefined,
      });
    },
    [filters, onChange]
  );

  // -------- Ticket status (multi-select, scoped to selected boards) --------

  const ticketStatusTreeOptions = useMemo((): TreeSelectOption<'ticketStatus'>[] => {
    const selectedIds = new Set(filters.ticketStatusIds || []);
    const selectedBoardIds = filters.ticketBoardIds;
    const opts = buildUniqueStatusOptions(
      ticketStatuses,
      // If exactly one board selected, scope statuses to it
      selectedBoardIds?.length === 1 ? selectedBoardIds[0] : undefined
    );
    return opts.map((o) => ({
      value: o.value,
      label: o.label,
      type: 'ticketStatus' as const,
      selected: selectedIds.has(o.value),
    }));
  }, [ticketStatuses, filters.ticketStatusIds, filters.ticketBoardIds]);

  const handleTicketStatusToggle = useCallback(
    (value: string, _type: string) => {
      if (!value) {
        const next = { ...filters };
        delete next.ticketStatusIds;
        onChange(next);
        return;
      }
      const current = filters.ticketStatusIds || [];
      const isSelected = current.includes(value);
      // When filtering across boards, include all status_ids that share the name
      const idsForThisName = (filters.ticketBoardIds && filters.ticketBoardIds.length === 1)
        ? [value]
        : getStatusIdsByName(ticketStatuses, value);

      let updated: string[];
      if (isSelected) {
        // Remove all IDs for this status name
        const removeSet = new Set(idsForThisName);
        updated = current.filter((id) => !removeSet.has(id));
      } else {
        // Add all IDs for this status name
        updated = [...new Set([...current, ...idsForThisName])];
      }
      onChange({
        ...filters,
        ticketStatusIds: updated.length > 0 ? updated : undefined,
      });
    },
    [filters, onChange, ticketStatuses]
  );

  // -------- Ticket tags (TagFilter) ----------------------------------------

  // Deduplicate tags by tag_text for the filter
  const uniqueTicketTags = useMemo(() => {
    const seen = new Set<string>();
    return ticketTags.filter((t) => {
      if (seen.has(t.tag_text)) return false;
      seen.add(t.tag_text);
      return true;
    });
  }, [ticketTags]);

  const handleTicketTagToggle = useCallback(
    (tagText: string) => {
      const tag = uniqueTicketTags.find((t) => t.tag_text === tagText);
      if (!tag) return;
      const current = filters.ticketTagIds || [];
      const isSelected = current.includes(tag.tag_id);
      const updated = isSelected
        ? current.filter((id) => id !== tag.tag_id)
        : [...current, tag.tag_id];
      onChange({
        ...filters,
        ticketTagIds: updated.length > 0 ? updated : undefined,
      });
    },
    [filters, onChange, uniqueTicketTags]
  );

  // Map tag_ids back to tag_texts for the TagFilter component
  const selectedTicketTagTexts = useMemo(() => {
    if (!filters.ticketTagIds) return [];
    const idSet = new Set(filters.ticketTagIds);
    return uniqueTicketTags
      .filter((t) => idSet.has(t.tag_id))
      .map((t) => t.tag_text);
  }, [filters.ticketTagIds, uniqueTicketTags]);

  // -------- Project / Phase / Status tree ----------------------------------

  const handleProjectTreeToggle = useCallback(
    (value: string, type: ProjectNodeType) => {
      if (!value) {
        const next = { ...filters };
        delete next.projectIds;
        delete next.phaseIds;
        delete next.projectStatusMappingIds;
        onChange(next);
        return;
      }

      if (type === 'project') {
        const current = filters.projectIds || [];
        const updated = current.includes(value)
          ? current.filter((id) => id !== value)
          : [...current, value];
        onChange({
          ...filters,
          projectIds: updated.length > 0 ? updated : undefined,
        });
      } else if (type === 'phase') {
        const current = filters.phaseIds || [];
        const updated = current.includes(value)
          ? current.filter((id) => id !== value)
          : [...current, value];
        onChange({
          ...filters,
          phaseIds: updated.length > 0 ? updated : undefined,
        });
      } else if (type === 'status') {
        const current = filters.projectStatusMappingIds || [];
        const updated = current.includes(value)
          ? current.filter((id) => id !== value)
          : [...current, value];
        onChange({
          ...filters,
          projectStatusMappingIds: updated.length > 0 ? updated : undefined,
        });
      }
    },
    [filters, onChange]
  );

  const projectTreeOptions = useMemo((): TreeSelectOption<ProjectNodeType>[] => {
    const selectedProjectIds = new Set(filters.projectIds || []);
    const selectedPhaseIds = new Set(filters.phaseIds || []);
    const selectedMappingIds = new Set(filters.projectStatusMappingIds || []);
    return projects.filter((p) => !p.is_inactive).map((p) => ({
      value: p.project_id,
      label: p.project_name,
      type: 'project' as const,
      selected: selectedProjectIds.has(p.project_id),
      children: p.phases.map((phase) => ({
        value: phase.phase_id,
        label: phase.phase_name,
        type: 'phase' as const,
        selected: selectedPhaseIds.has(phase.phase_id),
        children: (phase.statuses || []).map((st) => ({
          value: st.mapping_id,
          label: st.name + (st.is_closed ? t('filters.statusClosedSuffix', { defaultValue: ' (closed)' }) : ''),
          type: 'status' as const,
          selected: selectedMappingIds.has(st.mapping_id),
        })),
      })),
    }));
  }, [projects, filters.projectIds, filters.phaseIds, filters.projectStatusMappingIds, t]);

  // -------- Project task tags (TagFilter) -----------------------------------

  const uniqueProjectTaskTags = useMemo(() => {
    const seen = new Set<string>();
    return projectTaskTags.filter((t) => {
      if (seen.has(t.tag_text)) return false;
      seen.add(t.tag_text);
      return true;
    });
  }, [projectTaskTags]);

  const handleProjectTaskTagToggle = useCallback(
    (tagText: string) => {
      const tag = uniqueProjectTaskTags.find((t) => t.tag_text === tagText);
      if (!tag) return;
      const current = filters.projectTaskTagIds || [];
      const isSelected = current.includes(tag.tag_id);
      const updated = isSelected
        ? current.filter((id) => id !== tag.tag_id)
        : [...current, tag.tag_id];
      onChange({
        ...filters,
        projectTaskTagIds: updated.length > 0 ? updated : undefined,
      });
    },
    [filters, onChange, uniqueProjectTaskTags]
  );

  const selectedProjectTaskTagTexts = useMemo(() => {
    if (!filters.projectTaskTagIds) return [];
    const idSet = new Set(filters.projectTaskTagIds);
    return uniqueProjectTaskTags
      .filter((t) => idSet.has(t.tag_id))
      .map((t) => t.tag_text);
  }, [filters.projectTaskTagIds, uniqueProjectTaskTags]);

  // -------- Render ---------------------------------------------------------

  return (
    <div className="border-b border-border pb-4 mb-4 space-y-3">
      {/* Row 1: Activity types */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label className="text-sm font-semibold whitespace-nowrap">{t('filters.labels.types', { defaultValue: 'Types:' })}</Label>
        {ACTIVITY_TYPE_OPTIONS.map((option) => (
          <Checkbox
            key={option.value}
            id={`activity-type-${option.value}`}
            label={option.label}
            checked={selectedTypes.includes(option.value)}
            onChange={() => toggleType(option.value)}
            containerClassName="mb-0"
            size="sm"
          />
        ))}
      </div>

      {/* Ticket-specific filters */}
      {hasTickets && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 pl-4 border-l-2 border-primary-300">
          <Label className="text-xs font-semibold text-primary-600 self-center whitespace-nowrap">
            {t('filters.labels.tickets', { defaultValue: 'Tickets:' })}
          </Label>

          {boardTreeOptions.length > 0 && (
            <div className="min-w-[150px] max-w-[240px]">
              <TreeSelect<'board'>
                options={boardTreeOptions}
                value=""
                onValueChange={handleBoardToggle}
                placeholder={t('filters.placeholders.allBoards', { defaultValue: 'All Boards' })}
                multiSelect
                showReset
                allowEmpty
              />
            </div>
          )}

          {ticketStatusTreeOptions.length > 0 && (
            <div className="min-w-[150px] max-w-[240px]">
              <TreeSelect<'ticketStatus'>
                options={ticketStatusTreeOptions}
                value=""
                onValueChange={handleTicketStatusToggle}
                placeholder={t('filters.placeholders.allStatuses', { defaultValue: 'All Statuses' })}
                multiSelect
                showReset
                allowEmpty
              />
            </div>
          )}

          {uniqueTicketTags.length > 0 && (
            <TagFilter
              tags={uniqueTicketTags}
              selectedTags={selectedTicketTagTexts}
              onToggleTag={handleTicketTagToggle}
              onClearTags={() => onChange({ ...filters, ticketTagIds: undefined })}
            />
          )}
        </div>
      )}

      {/* Project task-specific filters */}
      {hasProjectTasks && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 pl-4 border-l-2" style={{ borderColor: 'rgb(var(--color-secondary-500))' }}>
          <Label className="text-xs font-semibold self-center whitespace-nowrap" style={{ color: 'rgb(var(--color-secondary-500))' }}>
            {t('filters.labels.tasks', { defaultValue: 'Tasks:' })}
          </Label>

          {projects.length > 0 && (
            <div className="min-w-[220px] max-w-[320px]">
              <TreeSelect<ProjectNodeType>
                options={projectTreeOptions}
                value=""
                onValueChange={handleProjectTreeToggle}
                placeholder={t('filters.placeholders.allProjects', { defaultValue: 'All Projects' })}
                multiSelect
                showReset
                allowEmpty
              />
            </div>
          )}

          {uniqueProjectTaskTags.length > 0 && (
            <TagFilter
              tags={uniqueProjectTaskTags}
              selectedTags={selectedProjectTaskTagTexts}
              onToggleTag={handleProjectTaskTagToggle}
              onClearTags={() =>
                onChange({ ...filters, projectTaskTagIds: undefined })
              }
            />
          )}
        </div>
      )}

      {/* Shared filters row */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-[220px] max-w-[320px] flex-1">
          <Label htmlFor="activities-search-input" className="text-sm font-semibold mb-1 block">
            {t('filters.labels.search', { defaultValue: 'Search' })}
          </Label>
          <SearchInput
            id="activities-search-input"
            value={filters.search || ''}
            onChange={handleSearchChange}
            onClear={handleSearchClear}
            placeholder={t('filters.placeholders.search', { defaultValue: 'Search activities...' })}
            className="w-full h-10 py-2 text-sm"
          />
        </div>

        {isPriorityFilterAvailable && priorities.length > 0 && (
          <div className="min-w-[180px]">
            <Label htmlFor="priority-select" className="text-sm font-semibold mb-1 block">
              {t('filters.labels.priority', { defaultValue: 'Priority' })}
            </Label>
            <CustomSelect
              id="priority-select"
              value={selectedPriorityId}
              onValueChange={handlePriorityChange}
              options={[
                { value: 'all', label: t('filters.placeholders.allPriorities', { defaultValue: 'All Priorities' }) },
                ...priorities.map((p) => ({
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
                })),
              ]}
              placeholder={t('filters.placeholders.selectPriority', { defaultValue: 'Select Priority...' })}
              size="sm"
            />
          </div>
        )}

        <div className="min-w-[240px]">
          <Label className="text-sm font-semibold mb-1 block">{t('filters.labels.dueDate', { defaultValue: 'Due Date' })}</Label>
          <StringDateRangePicker
            id="activities-due-date-range"
            value={{
              from: filters.dueDateStart
                ? new Date(filters.dueDateStart).toISOString().split('T')[0]
                : '',
              to: filters.dueDateEnd
                ? new Date(filters.dueDateEnd).toISOString().split('T')[0]
                : '',
            }}
            onChange={handleDateRangeChange}
          />
        </div>

        <div className="flex items-center pb-0.5">
          <Checkbox
            id="show-closed"
            label={t('filters.labels.showClosed', { defaultValue: 'Show closed' })}
            checked={filters.isClosed}
            onChange={handleClosedToggle}
            containerClassName="mb-0"
            size="sm"
          />
        </div>

        <div className="flex items-center pb-0.5 ml-auto">
          <Button
            id="reset-filters-button"
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {t('filters.actions.reset', { defaultValue: 'Reset' })}
          </Button>
        </div>
      </div>
    </div>
  );
}
