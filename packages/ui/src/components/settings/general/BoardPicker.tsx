'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { IBoard } from '@alga-psa/types';
import { ChevronDown } from 'lucide-react';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent, AutomationProps, FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { Button } from '@alga-psa/ui/components/Button';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';

interface BoardPickerProps {
  id?: string;
  boards: IBoard[];
  onSelect: (boardId: string) => void;
  selectedBoardId: string | null;
  filterState: 'active' | 'inactive' | 'all';
  onFilterStateChange: (state: 'active' | 'inactive' | 'all') => void;
  fitContent?: boolean;
  placeholder?: string;
  modal?: boolean;
}

export const BoardPicker: React.FC<BoardPickerProps & AutomationProps> = ({
  id = 'board-picker',
  boards = [],
  onSelect,
  selectedBoardId,
  filterState,
  onFilterStateChange,
  fitContent = false,
  placeholder = 'Select Board',
  modal = true,
  "data-automation-type": dataAutomationType = 'picker'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLButtonElement>(null);

  const mappedOptions = useMemo(() => 
    boards.map(board => ({
      value: board.board_id || '',
      label: board.board_name || ''
    })), 
    [boards]
  );

  const { automationIdProps: boardPickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id,
    value: selectedBoardId || '',
    disabled: false,
    required: false,
    options: mappedOptions
  });

  // Setup for storing previous metadata
  const prevMetadataRef = useRef<{
    value: string;
    label: string;
    disabled: boolean;
    required: boolean;
    options: { value: string; label: string }[];
  } | null>(null);  

  useEffect(() => {
    if (!updateMetadata) return;

    const selectedBoard = boards.find(c => c.board_id === selectedBoardId);

    // Construct the new metadata
    const newMetadata = {
      value: selectedBoardId || '',
      label: selectedBoard?.board_name || '',
      disabled: false,
      required: false,
      options: mappedOptions
    };

    // Compare with previous metadata
    // Custom equality check for options arrays
    const areOptionsEqual = (prev: { value: string; label: string }[] | undefined, 
                           curr: { value: string; label: string }[]) => {
      if (!prev) return false;
      if (prev.length !== curr.length) return false;
      
      // Create sets of values for comparison
      const prevValues = new Set(prev.map((o): string => `${o.value}:${o.label}`));
      const currValues = new Set(curr.map((o): string => `${o.value}:${o.label}`));
      
      // Check if all values exist in both sets
      for (const value of prevValues) {
        if (!currValues.has(value)) return false;
      }
      return true;
    };

    // Custom equality check for the entire metadata object
    const isMetadataEqual = () => {
      if (!prevMetadataRef.current) return false;
      
      const prev = prevMetadataRef.current;
      
      return prev.value === newMetadata.value &&
             prev.label === newMetadata.label &&
             prev.disabled === newMetadata.disabled &&
             prev.required === newMetadata.required &&
             areOptionsEqual(prev.options, newMetadata.options);
    };

    if (!isMetadataEqual()) {
      // Update metadata since it's different
      updateMetadata(newMetadata);

      // Update the ref with the new metadata
      prevMetadataRef.current = newMetadata;
    }
  }, [selectedBoardId, boards, updateMetadata]); // updateMetadata intentionally omitted

  const selectedBoard = useMemo(() =>
    boards.find((c) => c.board_id === selectedBoardId),
    [boards, selectedBoardId]
  );

  const filteredBoards = useMemo(() => {
    return boards.filter(board => {
      const matchesSearch = (board.board_name || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesState =
        filterState === 'all' ? true :
          filterState === 'active' ? !board.is_inactive :
            filterState === 'inactive' ? board.is_inactive :
              true;

      return matchesSearch && matchesState;
    });
  }, [boards, filterState, searchTerm]);


  const handleSelect = (boardId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(boardId);
    setIsOpen(false);
  };

  const opts = useMemo(() => [
    { value: 'active', label: 'Active Boards' },
    { value: 'inactive', label: 'Inactive Boards' },
    { value: 'all', label: 'All Boards' },
  ], []);

  return (
    <ReflectionContainer id={`${id}-board`} data-automation-type={dataAutomationType} label="Board Picker">
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between"
            label={selectedBoard?.board_name || placeholder}
            type="button"
            ref={dropdownRef}
            aria-expanded={isOpen}
            aria-controls={isOpen ? `${id}-content` : undefined}
            {...withDataAutomationId({ id })}
            data-automation-type={dataAutomationType}
          >
            <span className={`flex-1 text-left ${!selectedBoardId ? 'text-gray-400' : ''}`}>
              {selectedBoard?.board_name || (selectedBoardId ? `Loading...` : placeholder)}
            </span>
            <ChevronDown className="h-4 w-4 text-gray-500" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            id={`${id}-content`}
            className={`z-[9999] bg-white border rounded-md shadow-lg ${fitContent ? 'w-max' : 'w-[350px]'}`}
            sideOffset={5}
            align="start"
            style={{
              minWidth: dropdownRef.current ? `${dropdownRef.current.offsetWidth}px` : 'auto',
            }}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={() => setIsOpen(false)}
            onPointerDownOutside={(event) => {
              const target = event.target as HTMLElement;
              // Prevent closing when clicking on a Radix Select trigger (which might be portaled)
              if (target.closest('[data-radix-select-trigger]')) {
                event.preventDefault();
              }
              // We don't call setIsOpen(false) here because Popover.Root's onOpenChange handles it.
              // Calling it manually here causes conflicts with the trigger's own toggle logic.
            }}
          >
            <div className="p-3 space-y-3 bg-white">
              <div className="w-full">
                <CustomSelect
                  value={filterState}
                  onValueChange={(value) => onFilterStateChange(value as 'active' | 'inactive' | 'all')}
                  options={opts}
                  placeholder="Filter by status"
                  label="Status Filter"
                  modal={modal}
                />
              </div>
              <div className="whitespace-nowrap">
                <Input
                  id={`${id}-search`}
                  placeholder="Search boards..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                  }}
                  label="Search Boards"
                />
              </div>
            </div>
            <div
              className="max-h-60 overflow-y-auto border-t bg-white"
              role="listbox"
              aria-label="Boards"
              onWheel={(e) => {
                e.stopPropagation();
              }}
            >
              {filteredBoards.length === 0 ? (
                <div className="px-4 py-2 text-gray-500">No boards found</div>
              ) : (
                filteredBoards.map((board): React.JSX.Element => (
                  <Button
                    key={board.board_id}
                    id={`${id}-board-picker-board-${board.board_id}`}
                    variant="ghost"
                    onClick={(e) => handleSelect(board.board_id!, e)}
                    className={`w-full justify-start ${board.board_id === selectedBoardId ? 'bg-blue-100 hover:bg-blue-200' : ''}`}
                    label={board.board_name || ''}
                    role="option"
                    aria-selected={board.board_id === selectedBoardId}
                    type="button"
                  >
                    {board.board_name || ''}
                    {board.is_inactive && <span className="ml-2 text-gray-500">(Inactive)</span>}
                  </Button>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </ReflectionContainer>
  );
};
