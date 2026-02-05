'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { ITicketListFilters, ITicketListItem, ITicketCategory, IBoard } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';
import { X } from 'lucide-react';
import { useTicketIntegration } from '../context/TicketIntegrationContext';
import TicketSelect, { TicketOption } from './TicketSelect';
import { mapTicketToTaskFields, TaskPrefillFields } from '../lib/taskTicketMapping';

interface SelectOption {
  value: string;
  label: string;
}

interface PrefillFromTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrefill: (payload: {
    prefillData: TaskPrefillFields;
    ticket: {
      ticket_id: string;
      ticket_number: string;
      title: string;
      status_name?: string;
      is_closed?: boolean;
      closed_at?: string | null;
    };
    shouldLink: boolean;
  }) => void;
  users: IUser[];
}

export default function PrefillFromTicketDialog({
  open,
  onOpenChange,
  onPrefill,
  users
}: PrefillFromTicketDialogProps): React.JSX.Element {
  const {
    getTicketsForList,
    getConsolidatedTicketData,
    getTicketCategories,
    getAllBoards,
    renderCategoryPicker
  } = useTicketIntegration();

  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [shouldLink, setShouldLink] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter state
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedBoard, setSelectedBoard] = useState('');
  const [boardFilterState, setBoardFilterState] = useState<'active' | 'inactive' | 'all'>('all');
  const [selectedTicketStatus, setSelectedTicketStatus] = useState('all');
  const [selectedPriority, setSelectedPriority] = useState('');
  const [statusOptions, setStatusOptions] = useState<SelectOption[]>([
    { value: 'all', label: 'All Statuses' }
  ]);
  const [priorityOptions, setPriorityOptions] = useState<SelectOption[]>([
    { value: 'all', label: 'All Priorities' }
  ]);
  const [filterOptionsLoaded, setFilterOptionsLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (!ticketsLoaded) {
      const fetchTickets = async () => {
        try {
          const filters: ITicketListFilters = { boardFilterState: 'all' };
          const results = await getTicketsForList(filters);
          setTickets(results || []);
          setTicketsLoaded(true);
        } catch (error) {
          console.error('Error fetching tickets for prefill:', error);
          setTickets([]);
        }
      };
      fetchTickets();
    }

    if (!filterOptionsLoaded) {
      const fetchFilterOptions = async () => {
        try {
          const [
            fetchedCategories,
            fetchedBoards,
            statuses,
            priorities
          ] = await Promise.all([
            getTicketCategories().catch(() => []),
            getAllBoards().catch(() => []),
            getTicketStatuses().catch(() => []),
            getAllPriorities('ticket').catch(() => [])
          ]);

          setCategories(fetchedCategories || []);
          setBoards(fetchedBoards || []);

          setStatusOptions([
            { value: 'all', label: 'All Statuses' },
            ...(statuses || []).map((status): SelectOption => ({
              value: status.status_id!,
              label: status.name ?? ''
            }))
          ]);

          setPriorityOptions([
            { value: 'all', label: 'All Priorities' },
            ...(priorities || []).map((priority): SelectOption => ({
              value: priority.priority_id,
              label: priority.priority_name
            }))
          ]);

          setFilterOptionsLoaded(true);
        } catch (error) {
          console.error('Error fetching filter options:', error);
        }
      };
      fetchFilterOptions();
    }
  }, [open, ticketsLoaded, filterOptionsLoaded]);

  const clearAllFilters = () => {
    setSearchValue('');
    setSelectedCategories([]);
    setSelectedUser('');
    setSelectedBoard('');
    setSelectedPriority('');
    setSelectedTicketStatus('all');
    setBoardFilterState('all');
  };

  const removeFilter = (filterType: string) => {
    switch (filterType) {
      case 'search': setSearchValue(''); break;
      case 'category': setSelectedCategories([]); break;
      case 'user': setSelectedUser(''); break;
      case 'board': setSelectedBoard(''); setBoardFilterState('all'); break;
      case 'priority': setSelectedPriority(''); break;
      case 'status': setSelectedTicketStatus('all'); break;
    }
  };

  const hasActiveFilters = searchValue || selectedCategories.length > 0 || selectedUser ||
    selectedBoard || selectedTicketStatus !== 'all' ||
    (selectedPriority && selectedPriority !== 'all');

  const filteredOptions = useMemo<TicketOption[]>(() => {
    const searchTerms = searchValue.toLowerCase().split(' ').filter(Boolean);
    return tickets
      .filter(ticket => {
        const searchableText = `
          ${ticket.ticket_number}
          ${ticket.title}
          ${ticket.status_name || ''}
          ${users.find(u => u.user_id === ticket.assigned_to)?.first_name || ''}
        `.toLowerCase();
        const matchesSearch = searchTerms.length === 0 || searchTerms.every(term => searchableText.includes(term));
        const matchesCategory = selectedCategories.length === 0 ||
          (ticket.category_id && selectedCategories.includes(ticket.category_id));
        const matchesUser = !selectedUser || ticket.assigned_to === selectedUser;
        const matchesBoard = !selectedBoard || selectedBoard === 'all' || ticket.board_id === selectedBoard;
        const matchesPriority = !selectedPriority || selectedPriority === 'all' || ticket.priority_id === selectedPriority;
        const matchesStatus = selectedTicketStatus === 'all' || ticket.status_id === selectedTicketStatus;

        return matchesSearch && matchesCategory && matchesUser && matchesBoard && matchesPriority && matchesStatus;
      })
      .map(ticket => ({
        value: ticket.ticket_id ?? '',
        label: `${ticket.ticket_number} - ${ticket.title}`,
        status: ticket.status_name || undefined
      }))
      .filter(option => option.value);
  }, [tickets, searchValue, selectedCategories, selectedUser, selectedBoard, selectedPriority, selectedTicketStatus, users]);

  const handleConfirm = async () => {
    if (!selectedTicketId) return;
    setIsSubmitting(true);
    try {
      const ticketData = await getConsolidatedTicketData(selectedTicketId);
      const prefillData = mapTicketToTaskFields(ticketData);
      onPrefill({
        prefillData,
        ticket: {
          ticket_id: ticketData.ticket_id,
          ticket_number: ticketData.ticket_number,
          title: ticketData.title,
          status_name: ticketData.status_name,
          is_closed: ticketData.is_closed,
          closed_at: ticketData.closed_at
        },
        shouldLink
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error fetching ticket data for prefill:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={open} onClose={() => onOpenChange(false)} title="Prefill From Ticket" className="max-w-xl">
      <DialogContent>
        <div className="space-y-4">
          {/* Search and Category on same line */}
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search tickets..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex-1">
              {renderCategoryPicker({
                id: 'prefill-category-picker',
                categories,
                selectedCategories,
                onSelect: setSelectedCategories,
                placeholder: 'Category',
                multiSelect: false,
              })}
            </div>
          </div>

          {/* Filters grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assigned To
                </label>
                <UserPicker
                  value={selectedUser}
                  onValueChange={setSelectedUser}
                  users={users}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  size="sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Board
                </label>
                <BoardPicker
                  id="prefill-board-picker"
                  boards={boards}
                  onSelect={(boardId) => {
                    setSelectedBoard(boardId);
                    setBoardFilterState('all');
                  }}
                  selectedBoardId={selectedBoard}
                  filterState={boardFilterState}
                  onFilterStateChange={setBoardFilterState}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <CustomSelect
                  value={selectedTicketStatus}
                  onValueChange={setSelectedTicketStatus}
                  options={statusOptions}
                  placeholder="All Statuses"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <CustomSelect
                  value={selectedPriority}
                  onValueChange={setSelectedPriority}
                  options={priorityOptions}
                  placeholder="All Priorities"
                />
              </div>
            </div>
          </div>

          {/* Active Filters */}
          {hasActiveFilters && (
            <div className="flex flex-wrap gap-2">
              {searchValue && (
                <span className="inline-flex items-center gap-1 text-sm bg-gray-100 px-2 py-1 rounded">
                  Search: {searchValue}
                  <button onClick={() => removeFilter('search')} className="text-gray-500 hover:text-gray-700">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {selectedCategories.length > 0 && (
                <span className="inline-flex items-center gap-1 text-sm bg-gray-100 px-2 py-1 rounded">
                  Categories: {selectedCategories.length}
                  <button onClick={() => removeFilter('category')} className="text-gray-500 hover:text-gray-700">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {selectedUser && (
                <span className="inline-flex items-center gap-1 text-sm bg-gray-100 px-2 py-1 rounded">
                  Assigned: {users.find(u => u.user_id === selectedUser)?.first_name}
                  <button onClick={() => removeFilter('user')} className="text-gray-500 hover:text-gray-700">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {selectedBoard && (
                <span className="inline-flex items-center gap-1 text-sm bg-gray-100 px-2 py-1 rounded">
                  Board: {boards.find(b => b.board_id === selectedBoard)?.board_name}
                  <button onClick={() => removeFilter('board')} className="text-gray-500 hover:text-gray-700">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {selectedPriority && selectedPriority !== 'all' && (
                <span className="inline-flex items-center gap-1 text-sm bg-gray-100 px-2 py-1 rounded">
                  Priority: {priorityOptions.find(p => p.value === selectedPriority)?.label}
                  <button onClick={() => removeFilter('priority')} className="text-gray-500 hover:text-gray-700">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {selectedTicketStatus !== 'all' && (
                <span className="inline-flex items-center gap-1 text-sm bg-gray-100 px-2 py-1 rounded">
                  Status: {statusOptions.find(s => s.value === selectedTicketStatus)?.label}
                  <button onClick={() => removeFilter('status')} className="text-gray-500 hover:text-gray-700">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              <Button
                id="prefill-clear-filters-button"
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="text-sm text-gray-500"
              >
                Clear all
              </Button>
            </div>
          )}

          {/* Ticket Select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Ticket
            </label>
            <TicketSelect
              options={filteredOptions}
              value={selectedTicketId}
              onValueChange={setSelectedTicketId}
              searchValue={searchValue}
              onSearchChange={setSearchValue}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={shouldLink}
              onChange={(event) => setShouldLink(event.target.checked)}
            />
            Link this ticket to the task
          </label>
        </div>

        <div className="mt-6 flex justify-end space-x-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!selectedTicketId || isSubmitting}>
            Prefill
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
