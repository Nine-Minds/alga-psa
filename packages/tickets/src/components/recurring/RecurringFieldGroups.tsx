'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { PrioritySelect } from '@alga-psa/ui/components/tickets/PrioritySelect';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions/avatarActions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions/team-actions/avatarActions';
import { CategoryPicker } from '../CategoryPicker';
import type { RecurringReferenceData } from './useRecurringReferenceData';

/**
 * The four groups of template fields a client may override (board + status, priority, category,
 * assignment). The definition editor renders them directly; the per-client overrides dialog renders
 * each behind an "Override" checkbox. They are controlled and stateless apart from picker UI state.
 */
interface GroupProps {
  idPrefix: string;
  reference: RecurringReferenceData;
  disabled?: boolean;
}

export interface BoardStatusValue {
  board_id: string;
  status_id: string | null;
}

export function BoardStatusFields({
  idPrefix, reference, disabled, value, onChange,
}: GroupProps & { value: BoardStatusValue; onChange: (value: BoardStatusValue) => void }) {
  const { t } = useTranslation('features/tickets');
  const [filterState, setFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const { ensureBoard } = reference;

  useEffect(() => {
    if (value.board_id) void ensureBoard(value.board_id).catch(() => undefined);
  }, [value.board_id, ensureBoard]);

  const statuses = reference.boardData[value.board_id]?.statuses ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label htmlFor={`${idPrefix}-board`}>{t('recurring.fields.board', 'Board')}</Label>
        <BoardPicker
          id={`${idPrefix}-board`}
          boards={reference.boards}
          selectedBoardId={value.board_id || null}
          filterState={filterState}
          onFilterStateChange={setFilterState}
          onSelect={(boardId) => onChange({ board_id: boardId, status_id: null })}
          placeholder={t('recurring.fields.boardPlaceholder', 'Select a board')}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-status`}>{t('recurring.fields.status', 'Status')}</Label>
        <CustomSelect
          id={`${idPrefix}-status`}
          value={value.status_id ?? ''}
          disabled={disabled || !value.board_id}
          onValueChange={(statusId) => onChange({ board_id: value.board_id, status_id: statusId || null })}
          options={[
            { value: '', label: t('recurring.fields.statusBoardDefault', 'Board default') },
            ...statuses.map((status) => ({ value: status.status_id, label: status.name })),
          ]}
        />
      </div>
    </div>
  );
}

export function PriorityField({
  idPrefix, reference, disabled, boardId, value, onChange,
}: GroupProps & { boardId: string; value: string | null; onChange: (priorityId: string) => void }) {
  const { t } = useTranslation('features/tickets');
  const { ensureBoard } = reference;
  useEffect(() => {
    if (boardId) void ensureBoard(boardId).catch(() => undefined);
  }, [boardId, ensureBoard]);

  const options = useMemo(
    () =>
      (reference.boardData[boardId]?.priorities ?? []).map((priority) => ({
        value: priority.priority_id,
        label: priority.priority_name,
        color: priority.color,
        is_from_itil_standard: priority.is_from_itil_standard,
        itil_priority_level: priority.itil_priority_level,
      })),
    [reference.boardData, boardId]
  );

  return (
    <div>
      <Label htmlFor={`${idPrefix}-priority`}>{t('recurring.fields.priority', 'Priority')}</Label>
      <PrioritySelect
        id={`${idPrefix}-priority`}
        value={value}
        options={options}
        disabled={disabled || !boardId}
        onValueChange={onChange}
        placeholder={t('recurring.fields.priorityPlaceholder', 'Select a priority')}
      />
    </div>
  );
}

export interface CategoryValue {
  category_id: string | null;
  subcategory_id: string | null;
}

export function CategoryField({
  idPrefix, reference, disabled, boardId, value, onChange,
}: GroupProps & { boardId: string; value: CategoryValue; onChange: (value: CategoryValue) => void }) {
  const { t } = useTranslation('features/tickets');
  const { ensureBoard } = reference;
  useEffect(() => {
    if (boardId) void ensureBoard(boardId).catch(() => undefined);
  }, [boardId, ensureBoard]);

  const categories = reference.boardData[boardId]?.categories ?? [];
  // The picker works on a single id: a subcategory id stands for "this subcategory of its parent".
  const selected = value.subcategory_id ?? value.category_id;

  return (
    <div>
      <Label htmlFor={`${idPrefix}-category`}>{t('recurring.fields.category', 'Category')}</Label>
      <CategoryPicker
        id={`${idPrefix}-category`}
        categories={categories}
        selectedCategories={selected ? [selected] : []}
        multiSelect={false}
        allowEmpty
        disabled={disabled || !boardId}
        placeholder={t('recurring.fields.categoryPlaceholder', 'No category')}
        className="w-full"
        onSelect={(ids) => {
          const picked = categories.find((category) => category.category_id === ids[0]);
          if (!picked) onChange({ category_id: null, subcategory_id: null });
          else if (picked.parent_category) onChange({ category_id: picked.parent_category, subcategory_id: picked.category_id });
          else onChange({ category_id: picked.category_id, subcategory_id: null });
        }}
      />
    </div>
  );
}

export interface AssignmentValue {
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agent_ids: string[];
}

export function AssignmentFields({
  idPrefix, reference, disabled, value, onChange,
}: GroupProps & { value: AssignmentValue; onChange: (value: AssignmentValue) => void }) {
  const { t } = useTranslation('features/tickets');
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label htmlFor={`${idPrefix}-assignee`}>{t('recurring.fields.assignedTo', 'Assigned to')}</Label>
        <UserAndTeamPicker
          id={`${idPrefix}-assignee`}
          value={value.assigned_to ?? ''}
          users={reference.users}
          teams={reference.teams}
          disabled={disabled}
          buttonWidth="full"
          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
          getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
          onValueChange={(userId) => onChange({ ...value, assigned_to: userId || null, assigned_team_id: null })}
          onTeamSelect={(teamId) => {
            const team = reference.teams.find((candidate) => candidate.team_id === teamId);
            // As in quick-add: choosing a team assigns its manager and records the team.
            onChange({ ...value, assigned_to: team?.manager_id ?? value.assigned_to, assigned_team_id: teamId });
          }}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-additional-agents`}>{t('recurring.fields.additionalAgents', 'Additional agents')}</Label>
        <MultiUserPicker
          id={`${idPrefix}-additional-agents`}
          values={value.additional_agent_ids}
          users={reference.users}
          disabled={disabled}
          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
          onValuesChange={(ids) => onChange({ ...value, additional_agent_ids: ids })}
        />
      </div>
    </div>
  );
}
