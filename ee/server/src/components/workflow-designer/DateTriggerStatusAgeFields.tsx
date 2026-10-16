'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { getTicketFieldOptions } from '@alga-psa/integrations/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IBoard } from '@alga-psa/types';
import {
  DEFAULT_STATUS_AGE_PARAMS,
  isStatusNameAvailable,
  parseDayCount,
  statusNameOptions,
  type StatusAgeParamsDraft,
  type StatusAgeStatusOption,
} from './dateTriggerStatusAge';

type BoardOption = { id: string; name: string; is_default?: boolean };

/**
 * Controls for the `ticket.status_age` date trigger: status, optional board, N days, optional repeat
 * and the "no activity" condition. Values are the trigger's `params`.
 */
export function DateTriggerStatusAgeFields({
  params,
  disabled,
  onChange,
}: {
  params: StatusAgeParamsDraft | undefined;
  disabled?: boolean;
  onChange: (next: StatusAgeParamsDraft) => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/workflows');
  const value = params ?? DEFAULT_STATUS_AGE_PARAMS;
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [statuses, setStatuses] = useState<StatusAgeStatusOption[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTicketFieldOptions()
      .then((result: any) => {
        if (cancelled) return;
        const options = result?.options;
        if (!options) { setLoadFailed(true); return; }
        setBoards(options.boards ?? []);
        setStatuses(options.statuses ?? []);
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const boardList = useMemo(
    () => boards.map((board) => ({ board_id: board.id, board_name: board.name, is_default: board.is_default, is_inactive: false } as IBoard)),
    [boards],
  );
  const statusOptions = useMemo(() => statusNameOptions(statuses, value.boardId), [statuses, value.boardId]);
  const statusMissing = Boolean(value.statusName) && statuses.length > 0 && !isStatusNameAvailable(statuses, value.boardId, value.statusName);
  const patch = (next: Partial<StatusAgeParamsDraft>) => onChange({ ...value, ...next });
  const repeating = value.repeatEveryDays != null;

  return (
    <div className="space-y-3" id="workflow-date-status-age-params">
      <div>
        <label htmlFor="workflow-date-status-name" className="mb-1 block text-sm font-medium">{t('designer.form.statusAgeStatus', { defaultValue: 'Status' })}</label>
        <CustomSelect
          id="workflow-date-status-name"
          value={value.statusName}
          disabled={disabled}
          showPlaceholderInDropdown={false}
          placeholder={t('designer.form.statusAgeStatusPlaceholder', { defaultValue: 'Select a status' })}
          options={statusOptions}
          onValueChange={(next) => patch({ statusName: next })}
        />
        {statusMissing && (
          <p className="mt-1 text-xs text-amber-700">{t('designer.form.statusAgeStatusMissing', { defaultValue: 'No status with this name exists on the selected board.' })}</p>
        )}
        {loadFailed && (
          <p className="mt-1 text-xs text-red-600">{t('designer.form.statusAgeOptionsFailed', { defaultValue: 'Could not load statuses and boards.' })}</p>
        )}
        <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{t('designer.form.statusAgeMatchByName', { defaultValue: 'Statuses are matched by name. Renaming a status stops this trigger from matching.' })}</p>
      </div>
      <div>
        <label htmlFor="workflow-date-status-board-picker" className="mb-1 block text-sm font-medium">{t('designer.form.statusAgeBoard', { defaultValue: 'Board (optional)' })}</label>
        <BoardPicker
          id="workflow-date-status-board-picker"
          boards={boardList}
          selectedBoardId={value.boardId ?? null}
          onSelect={(boardId) => patch({ boardId: boardId || null })}
          filterState="active"
          onFilterStateChange={() => {}}
          placeholder={t('designer.form.statusAgeAnyBoard', { defaultValue: 'Any board' })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="workflow-date-status-days" className="mb-1 block text-sm font-medium">{t('designer.form.statusAgeDays', { defaultValue: 'Days in status' })}</label>
          <Input
            id="workflow-date-status-days"
            type="number"
            min={1}
            max={365}
            value={value.days}
            disabled={disabled}
            onChange={(event) => patch({ days: parseDayCount(event.target.value) ?? 1 })}
          />
        </div>
        <div className="flex items-end">
          <Checkbox
            id="workflow-date-status-repeat"
            label={t('designer.form.statusAgeRepeat', { defaultValue: 'Repeat while in status' })}
            checked={repeating}
            disabled={disabled}
            onChange={(event) => patch({ repeatEveryDays: event.target.checked ? value.repeatEveryDays ?? value.days : null })}
          />
        </div>
        {repeating && (
          <div>
            <label htmlFor="workflow-date-status-repeat-days" className="mb-1 block text-sm font-medium">{t('designer.form.statusAgeRepeatEvery', { defaultValue: 'Repeat every (days)' })}</label>
            <Input
              id="workflow-date-status-repeat-days"
              type="number"
              min={1}
              max={365}
              value={value.repeatEveryDays ?? ''}
              disabled={disabled}
              onChange={(event) => patch({ repeatEveryDays: parseDayCount(event.target.value) ?? 1 })}
            />
          </div>
        )}
      </div>
      <Checkbox
        id="workflow-date-status-no-activity"
        label={t('designer.form.statusAgeNoActivity', { defaultValue: 'Only if there has been no activity (comments or changes by people) for that long' })}
        checked={Boolean(value.requireNoActivity)}
        disabled={disabled}
        onChange={(event) => patch({ requireNoActivity: event.target.checked })}
      />
    </div>
  );
}
