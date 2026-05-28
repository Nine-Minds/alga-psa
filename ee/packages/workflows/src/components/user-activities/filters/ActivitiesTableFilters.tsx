'use client';


import React, { useState, useCallback, useMemo } from 'react';
import {
  ActivityFilters as ActivityFiltersType,
  ActivityType,
  IClient,
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
import { ClientPicker } from "@alga-psa/ui/components/ClientPicker";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import TreeSelect, { TreeSelectOption } from "@alga-psa/ui/components/TreeSelect";
import { TagFilter } from "@alga-psa/ui/components";
import { RotateCcw, X } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { DEFAULT_TABLE_TYPES } from '../constants';

const PRIORITY_FILTERABLE_TYPES = new Set([ActivityType.TICKET, ActivityType.PROJECT_TASK]);

type ProjectNodeType = 'project' | 'phase' | 'status';

interface ActivitiesTableFiltersProps {
  filters: ActivityFiltersType;
  onChange: (filters: ActivityFiltersType) => void;
  priorities?: IPriority[];
  clients?: IClient[];
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
  clients = [],
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
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientClientTypeFilter, setClientClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const selectedTypes = filters.types || [];
  const hasTickets = selectedTypes.includes(ActivityType.TICKET);
  const hasProjectTasks = selectedTypes.includes(ActivityType.PROJECT_TASK);

  const isPriorityFilterAvailable =
    selectedTypes.length === 1 && PRIORITY_FILTERABLE_TYPES.has(selectedTypes[0]);
  const hasPriorityFilter = isPriorityFilterAvailable && priorities.length > 0;
  const hasClientFilter = clients.length > 0;

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

  const handleClientChange = useCallback(
    (clientId: string | null) => {
      const next: ActivityFiltersType = { ...filters };
      if (clientId) {
        next.clientId = clientId;
      } else {
        delete next.clientId;
      }
      onChange(next);
    },
    [filters, onChange]
  );

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
    <div className="border-b border-border pb-3 mb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
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

        <div className="ml-auto flex items-center gap-3">
          <Checkbox
            id="show-closed"
            label={t('filters.labels.showClosed', { defaultValue: 'Show closed' })}
            checked={filters.isClosed}
            onChange={handleClosedToggle}
            containerClassName="mb-0 whitespace-nowrap"
            size="sm"
          />
          <Button
            id="reset-filters-button"
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {t('filters.actions.reset', { defaultValue: 'Reset' })}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1 basis-[260px] lg:max-w-[320px]">
          <Label htmlFor="activities-search-input" className="sr-only">
            {t('filters.labels.search', { defaultValue: 'Search' })}
          </Label>
          <SearchInput
            id="activities-search-input"
            value={filters.search || ''}
            onChange={handleSearchChange}
            onClear={handleSearchClear}
            placeholder={t('filters.placeholders.search', { defaultValue: 'Search activities...' })}
            className="w-full h-9 py-2 text-sm"
          />
        </div>

        {hasClientFilter && (
          <div className={`flex items-center gap-1 ${filters.clientId ? 'w-[280px]' : 'w-[160px]'}`}>
            <Label htmlFor="activities-client-picker" className="sr-only">
              {t('filters.labels.client', { defaultValue: 'Client' })}
            </Label>
            <ClientPicker
              id="activities-client-picker"
              clients={clients}
              selectedClientId={filters.clientId || null}
              onSelect={handleClientChange}
              filterState={clientFilterState}
              onFilterStateChange={setClientFilterState}
              clientTypeFilter={clientClientTypeFilter}
              onClientTypeFilterChange={setClientClientTypeFilter}
              placeholder={t('filters.placeholders.allClients', { defaultValue: 'All Clients' })}
              fitContent={false}
              className="min-w-0 flex-1"
              triggerButtonClassName="h-9"
            />
            {filters.clientId && (
              <Button
                id="clear-client-filter-button"
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleClientChange(null)}
                aria-label={t('filters.actions.clearClient', { defaultValue: 'Clear client filter' })}
                className="shrink-0 px-1.5"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        {hasPriorityFilter && (
          <div className="w-[170px]">
            <Label htmlFor="priority-select" className="sr-only">
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


      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
          {hasTickets && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md border border-[rgb(var(--color-border-200))] border-l-2 bg-[rgb(var(--color-card))] px-2 py-1"
              style={{ borderLeftColor: 'rgb(var(--color-primary-500))' }}
            >
              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'rgb(var(--color-primary-500))' }}>
                {t('filters.labels.ticketsCompact', { defaultValue: 'Tickets' })}
              </span>

              {boardTreeOptions.length > 0 && (
                <div className="w-[135px]">
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
                <div className="w-[135px]">
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
                  id="ticket-tag-filter"
                  tags={uniqueTicketTags}
                  selectedTags={selectedTicketTagTexts}
                  onToggleTag={handleTicketTagToggle}
                  onClearTags={() => onChange({ ...filters, ticketTagIds: undefined })}
                  triggerLabel={t('filters.labels.tags', { defaultValue: 'Tags' })}
                  selectedLabel={t('filters.labels.tagsSelected', { count: selectedTicketTagTexts.length, defaultValue: '{{count}} tags' })}
                  placeholder={t('filters.placeholders.ticketTags', { defaultValue: 'Filter ticket tags...' })}
                />
              )}
            </div>
          )}

          {hasProjectTasks && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md border border-[rgb(var(--color-border-200))] border-l-2 bg-[rgb(var(--color-card))] px-2 py-1"
              style={{ borderLeftColor: 'rgb(var(--color-secondary-500))' }}
            >
              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'rgb(var(--color-secondary-500))' }}>
                {t('filters.labels.tasksCompact', { defaultValue: 'Tasks' })}
              </span>

              {projects.length > 0 && (
                <div className="w-[190px]">
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
                  id="project-task-tag-filter"
                  tags={uniqueProjectTaskTags}
                  selectedTags={selectedProjectTaskTagTexts}
                  onToggleTag={handleProjectTaskTagToggle}
                  onClearTags={() =>
                    onChange({ ...filters, projectTaskTagIds: undefined })
                  }
                  triggerLabel={t('filters.labels.tags', { defaultValue: 'Tags' })}
                  selectedLabel={t('filters.labels.tagsSelected', { count: selectedProjectTaskTagTexts.length, defaultValue: '{{count}} tags' })}
                  placeholder={t('filters.placeholders.projectTaskTags', { defaultValue: 'Filter task tags...' })}
                />
              )}
            </div>
          )}

        <div className="flex items-center gap-2 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-2 py-1">
          <Label htmlFor="activities-due-date-range-from" className="text-xs font-semibold text-[rgb(var(--color-text-600))] whitespace-nowrap">
            {t('filters.labels.dueDateShort', { defaultValue: 'Due' })}
          </Label>
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
            containerClassName="space-y-0"
            rangeClassName="flex gap-1"
            datePickerClassName="w-[128px]"
            fromPlaceholder={t('filters.placeholders.fromDateShort', { defaultValue: 'From' })}
            toPlaceholder={t('filters.placeholders.toDateShort', { defaultValue: 'To' })}
          />
        </div>
      </div>
    </div>
  );
}
