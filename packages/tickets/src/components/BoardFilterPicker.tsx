'use client';

import React, { useMemo } from 'react';
import { IBoard } from '@alga-psa/types';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '@alga-psa/ui/components/TreeSelect';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { AutomationProps, FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export const NO_BOARD_VALUE = 'no-board';

interface BoardFilterPickerProps {
  id?: string;
  boards: IBoard[];
  selectedBoards: string[];
  excludedBoards?: string[];
  onSelect: (boardIds: string[], excludedIds: string[]) => void;
  // Restricts which boards appear in the list (mirrors the legacy BoardPicker status filter).
  filterState?: 'active' | 'inactive' | 'all';
  placeholder?: string;
  multiSelect?: boolean;
  className?: string;
  showExclude?: boolean;
  showReset?: boolean;
  allowEmpty?: boolean;
  disabled?: boolean;
  modal?: boolean;
}

type BoardType = 'board';

export const BoardFilterPicker: React.FC<BoardFilterPickerProps & AutomationProps> = ({
  id = 'board-filter-picker',
  boards = [],
  selectedBoards = [],
  excludedBoards = [],
  onSelect,
  filterState = 'active',
  placeholder,
  multiSelect = true,
  className = '',
  showExclude = true,
  showReset = true,
  allowEmpty = true,
  disabled = false,
  modal = true,
  "data-automation-type": dataAutomationType = 'custom',
}) => {
  const { t } = useTranslation('features/tickets');

  const { automationIdProps: containerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    id,
    type: 'formField',
    fieldType: 'select',
  });

  // Apply the active/inactive/all status filter to the option list.
  const visibleBoards = useMemo(() => {
    if (!Array.isArray(boards)) return [];
    return boards.filter((board) => {
      if (!board || !board.board_id || !board.board_name) return false;
      if (filterState === 'all') return true;
      if (filterState === 'inactive') return !!board.is_inactive;
      return !board.is_inactive; // 'active'
    });
  }, [boards, filterState]);

  // Boards are flat (no hierarchy), so every option is a leaf.
  const treeOptions = useMemo((): TreeSelectOption<BoardType>[] => {
    const boardOptions: TreeSelectOption<BoardType>[] = visibleBoards.map((board): TreeSelectOption<BoardType> => ({
      label: board.is_inactive ? (
        <span className="flex items-center gap-1">
          {board.board_name}
          <span className="px-1.5 py-0.5 text-xs font-medium bg-gray-500/15 text-gray-600 dark:text-gray-400 rounded">
            {t('boardPicker.inactiveBadge', 'Inactive')}
          </span>
        </span>
      ) : board.board_name,
      value: board.board_id!,
      type: 'board' as BoardType,
      selected: selectedBoards.includes(board.board_id!),
      excluded: excludedBoards.includes(board.board_id!),
    }));

    return [
      {
        label: t('boardPicker.noBoard', 'No Board'),
        value: NO_BOARD_VALUE,
        type: 'board' as BoardType,
        selected: selectedBoards.includes(NO_BOARD_VALUE),
        excluded: excludedBoards.includes(NO_BOARD_VALUE),
      },
      ...boardOptions,
    ];
  }, [visibleBoards, selectedBoards, excludedBoards, t]);

  const handleValueChange = (value: string, _type: BoardType, excluded: boolean, _path?: TreeSelectPath) => {
    let nextSelected = selectedBoards;
    let nextExcluded = excludedBoards;

    if (value === '') {
      nextSelected = [];
      nextExcluded = [];
    } else if (excluded) {
      nextExcluded = excludedBoards.includes(value)
        ? excludedBoards.filter((boardId) => boardId !== value)
        : [...excludedBoards, value];
      nextSelected = selectedBoards.filter((boardId) => boardId !== value);
    } else if (multiSelect) {
      nextSelected = selectedBoards.includes(value)
        ? selectedBoards.filter((boardId) => boardId !== value)
        : [...selectedBoards, value];
      nextExcluded = excludedBoards.filter((boardId) => boardId !== value);
    } else {
      nextSelected = [value];
      nextExcluded = [];
    }

    onSelect(nextSelected, nextExcluded);
    updateMetadata({ value: nextSelected.join(',') });
  };

  const boardNameFor = (boardId: string): string | undefined => {
    if (boardId === NO_BOARD_VALUE) return t('boardPicker.noBoard', 'No Board');
    return boards.find((board) => board.board_id === boardId)?.board_name;
  };

  const currentValue = selectedBoards[0] || '';
  const displayLabel = useMemo(() => {
    const parts: string[] = [];

    if (selectedBoards.length === 1) {
      parts.push(boardNameFor(selectedBoards[0]) || '');
    } else if (selectedBoards.length > 1) {
      parts.push(t('boardPicker.selectedCount', {
        count: selectedBoards.length,
        defaultValue: '{{count}} boards',
      }));
    }

    if (excludedBoards.length === 1) {
      parts.push(t('boardPicker.excludingPrefix', {
        name: boardNameFor(excludedBoards[0]) || '',
        defaultValue: 'excluding {{name}}',
      }));
    } else if (excludedBoards.length > 1) {
      parts.push(t('boardPicker.excludingCount', {
        count: excludedBoards.length,
        defaultValue: 'excluding {{count}} boards',
      }));
    }

    return parts.filter(Boolean).join(', ');
  }, [boards, selectedBoards, excludedBoards, t]);

  const resolvedPlaceholder = placeholder || t('boardPicker.placeholder', 'Filter by board');

  return (
    <ReflectionContainer id={id} label={t('boardPicker.title', 'Board Picker')}>
      <div {...containerProps}>
        <TreeSelect
          options={treeOptions}
          value={currentValue}
          onValueChange={handleValueChange}
          placeholder={displayLabel || resolvedPlaceholder}
          className={className}
          selectedClassName="bg-gray-50"
          hoverClassName="hover:bg-gray-50"
          triggerClassName={`focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${!disabled ? 'hover:border-gray-400' : ''}`}
          contentClassName="bg-white dark:bg-[rgb(var(--color-card))] rounded-md shadow-lg border border-gray-200 dark:border-[rgb(var(--color-border-200))]"
          multiSelect={multiSelect}
          showExclude={showExclude}
          showReset={showReset}
          allowEmpty={allowEmpty}
          disabled={disabled}
          modal={modal}
          showSearch={true}
          searchPlaceholder={t('boardPicker.searchPlaceholder', 'Search boards...')}
        />
      </div>
    </ReflectionContainer>
  );
};

export default BoardFilterPicker;
