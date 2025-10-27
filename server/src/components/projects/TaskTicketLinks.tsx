'use client';

import { useState, useEffect } from 'react';
import { QuickAddTicket } from 'server/src/components/tickets/QuickAddTicket';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { 
  addTicketLinkAction,
  deleteTaskTicketLinkAction,
  getTaskTicketLinksAction
} from '@product/actions/project-actions/projectTaskActions';
import { getTicketsForList } from '@product/actions/ticket-actions/ticketActions';
import { getConsolidatedTicketData } from '@product/actions/ticket-actions/optimizedTicketActions';
import { ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import { ITicketListItem, ITicket, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { IProjectTicketLinkWithDetails } from 'server/src/interfaces/project.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Link, Plus, ExternalLink, Trash2, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import UserPicker from 'server/src/components/ui/UserPicker';
import { BoardPicker } from 'server/src/components/settings/general/BoardPicker';
import { IBoard } from 'server/src/interfaces';
import { getTicketCategories } from '@product/actions/ticketCategoryActions';
import { getAllBoards } from '@product/actions/board-actions/boardActions';
import { getTicketStatuses } from '@product/actions/status-actions/statusActions';
import { getAllPriorities } from '@product/actions/priorityActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import TicketSelect from './TicketSelect';

interface TaskTicketLinksProps {
  taskId?: string;
  phaseId: string;
  projectId: string;
  initialLinks?: IProjectTicketLinkWithDetails[];
  users: IUserWithRoles[];
  onLinksChange?: (links: IProjectTicketLinkWithDetails[]) => void;
}

interface SelectOption {
  value: string;
  label: string;
  status_name?: string;
  status_id?: string;
  category_id?: string;
  assigned_to?: string;
  board_id?: string;
  priority_id?: string;
  client_id?: string;
}

interface TicketDetails {
  ticket_id: string;
  ticket_number: string;
  title: string;
  status_name?: string;
  closed_at?: Date | null;
}

export default function TaskTicketLinks({
  taskId,
  phaseId,
  projectId,
  initialLinks = undefined,
  users,
  onLinksChange
}: TaskTicketLinksProps) {

  const [taskTicketLinks, setTaskTicketLinks] = useState<IProjectTicketLinkWithDetails[] | undefined>(initialLinks);
  const [availableTickets, setAvailableTickets] = useState<ITicketListItem[]>([]);
  const [defaultStatus, setDefaultStatus] = useState<{ status_id: string, name: string } | null>(null);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [filterOptionsLoaded, setFilterOptionsLoaded] = useState(false);
  const { openDrawer } = useDrawer();
  const [showLinkTicketDialog, setShowLinkTicketDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [statusOptions, setStatusOptions] = useState<SelectOption[]>([
    { value: 'all', label: 'All Statuses' }
  ]);
  const [priorityOptions, setPriorityOptions] = useState<SelectOption[]>([
    { value: 'all', label: 'All Priorities' }
  ]);
  const [boardFilterState, setBoardFilterState] = useState<'active' | 'inactive' | 'all'>('all');
  const [clientOptions, setClientOptions] = useState<SelectOption[]>([]);
  const [selectedTicketStatus, setSelectedTicketStatus] = useState('all');
  const [selectedTicketId, setSelectedTicketId] = useState('');

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedCategories([]);
    setSelectedUser('');
    setSelectedBoard('');
    setSelectedPriority('');
    setSelectedTicketStatus('all');
    setBoardFilterState('all');
  };

  const removeFilter = (filterType: string) => {
    switch (filterType) {
      case 'search':
        setSearchTerm('');
        break;
      case 'category':
        setSelectedCategories([]);
        break;
      case 'user':
        setSelectedUser('');
        break;
      case 'board':
        setSelectedBoard('');
        setBoardFilterState('all');
        break;
      case 'priority':
        setSelectedPriority('');
        break;
      case 'status':
        setSelectedTicketStatus('all');
        break;
    }
  };

  // Lazy load tickets only when the dialog is opened
  const fetchTickets = async () => {
    if (ticketsLoaded) return; // Skip if already loaded
    
    try {
      const user = await getCurrentUser();
      if (!user) return;

      const filters: ITicketListFilters = {
        boardFilterState: 'all'
      };
      const tickets = await getTicketsForList(user, filters);
      setAvailableTickets(tickets || []);
      setTicketsLoaded(true);
    } catch (error) {
      console.error('Error fetching tickets:', error);
      setAvailableTickets([]);
    }
  };

  // Find the default status from the list of statuses
  const findDefaultStatus = (statuses: any[]) => {
    const defaultStatus = statuses.find(status => status.is_default === true);
    if (defaultStatus) {
      setDefaultStatus({
        status_id: defaultStatus.status_id,
        name: defaultStatus.name
      });
    }
  };

  // Lazy load filter options only when needed
  const fetchFilterOptions = async () => {
    if (filterOptionsLoaded) return; // Skip if already loaded
    
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
      
      // Find the default status
      if (statuses && statuses.length > 0) {
        findDefaultStatus(statuses);
      }
      
      const defaultStatus = { value: 'all', label: 'All Statuses' };
      setStatusOptions([
        defaultStatus,
        ...(statuses || []).map((status): SelectOption => ({
          value: status.status_id!,
          label: status.name ?? ""
        }))
      ]);

      const defaultPriority = { value: 'all', label: 'All Priorities' };
      setPriorityOptions([
        defaultPriority,
        ...(priorities || []).map((priority): SelectOption => ({
          value: priority.priority_id,
          label: priority.priority_name
        }))
      ]);
      
      setFilterOptionsLoaded(true);
    } catch (error) {
      console.error('Error fetching filter options:', error);
      setCategories([]);
      setBoards([]);
      setStatusOptions([{ value: 'all', label: 'All Statuses' }]);
      setPriorityOptions([{ value: 'all', label: 'All Priorities' }]);
    }
  };

  // Only fetch links if initialLinks is empty and taskId is available
  useEffect(() => {
    let mounted = true;

    const fetchLinks = async () => {
      // Skip fetching if we already have initialLinks
      if (taskId && initialLinks) {
        try {
          const links = await getTaskTicketLinksAction(taskId);
          if (mounted) {
            setTaskTicketLinks(links || []);
            onLinksChange?.(links || []);
          }
        } catch (error) {
          console.error('Error fetching ticket links:', error);
          if (mounted) {
            setTaskTicketLinks([]);
            onLinksChange?.([]);
          }
        }
      }
    };

    fetchLinks();
    return () => {
      mounted = false;
    };
  }, [taskId, onLinksChange, initialLinks]);

  const filteredTicketOptions = availableTickets
    .filter(ticket => {
      const searchTerms = searchTerm.toLowerCase().split(' ');
      const searchableText = `
        ${ticket.ticket_number} 
        ${ticket.title} 
        ${ticket.status_name || ''} 
        ${users.find(u => u.user_id === ticket.assigned_to)?.first_name || ''}
      `.toLowerCase();

      const matchesSearch = searchTerms.every(term => searchableText.includes(term));
      
      const matchesCategory = selectedCategories.length === 0 || 
        (ticket.category_id && selectedCategories.includes(ticket.category_id));
      
      const matchesUser = !selectedUser || 
        ticket.assigned_to === selectedUser;
      
      const matchesBoard = !selectedBoard || selectedBoard === 'all' || 
        ticket.board_id === selectedBoard;
      
      const matchesPriority = !selectedPriority || selectedPriority === 'all' || 
        ticket.priority_id === selectedPriority;

      const matchesStatus = selectedTicketStatus === 'all' || 
        ticket.status_id === selectedTicketStatus;

      return matchesSearch && matchesCategory && matchesUser && 
             matchesBoard && matchesPriority && matchesStatus;
    })
    .map((ticket): SelectOption => ({
      value: ticket.ticket_id!,
      label: `${ticket.ticket_number} - ${ticket.title}`,
      status_name: ticket.status_name || undefined,
      status_id: ticket.status_id || undefined,
      category_id: ticket.category_id || undefined,
      assigned_to: ticket.assigned_to || undefined,
      board_id: ticket.board_id || undefined,
      priority_id: ticket.priority_id || undefined
    }));

  const addTempTicketLink = (ticketDetails: TicketDetails | ITicketListItem | ITicket) => {
    // Check if ticket is already linked
    if (!('ticket_id' in ticketDetails) || !ticketDetails.ticket_id) {
      return null;
    }

    const isAlreadyLinked = (taskTicketLinks || []).some(link => link.ticket_id === ticketDetails.ticket_id);
    if (isAlreadyLinked) {
      toast.error('This ticket is already linked to this task');
      return null;
    }

    const tempLink: IProjectTicketLinkWithDetails = {
      link_id: `temp-${Date.now()}`,
      task_id: 'temp',
      ticket_id: ticketDetails.ticket_id,
      ticket_number: 'ticket_number' in ticketDetails ? ticketDetails.ticket_number : `#${Date.now()}`,
      title: ticketDetails.title,
      created_at: new Date(),
      project_id: projectId,
      phase_id: phaseId,
      status_name: 'status_name' in ticketDetails ? ticketDetails.status_name || 'New' : 'New',
      is_closed: 'closed_at' in ticketDetails ? ticketDetails.closed_at !== null : false
    };
    const newLinks = [...taskTicketLinks || [], tempLink];
    setTaskTicketLinks(newLinks);
    onLinksChange?.(newLinks);
    return tempLink;
  };

  const onLinkTicket = async () => {
    if (!selectedTicketId) return;
    
    try {
      if (taskId) {
        await addTicketLinkAction(projectId, taskId, selectedTicketId, phaseId);
        
        // Find the selected ticket in available tickets
        const selectedTicketDetails = availableTickets.find(t => t.ticket_id === selectedTicketId);
        
        if (selectedTicketDetails) {
          // Create a new link object instead of fetching all links again
          const newLink: IProjectTicketLinkWithDetails = {
            link_id: `new-${Date.now()}`, // This will be replaced with the actual ID on next fetch
            task_id: taskId,
            ticket_id: selectedTicketDetails.ticket_id!,
            ticket_number: selectedTicketDetails.ticket_number,
            title: selectedTicketDetails.title,
            created_at: new Date(),
            project_id: projectId,
            phase_id: phaseId,
            status_name: selectedTicketDetails.status_name || 'New',
            is_closed: false
          };
          
          const updatedLinks = [...taskTicketLinks || [], newLink];
          setTaskTicketLinks(updatedLinks);
          onLinksChange?.(updatedLinks);
          toast.success('Ticket linked successfully');
        }
      } else {
        // For new tasks, store the link temporarily
        const selectedTicketDetails = availableTickets.find(t => t.ticket_id === selectedTicketId);
        if (selectedTicketDetails) {
          const link = addTempTicketLink(selectedTicketDetails);
          if (link) {
            toast.success('Ticket linked successfully');
          }
        }
      }
      setShowLinkTicketDialog(false);
      setSelectedTicketId('');
    } catch (error) {
      console.error('Error linking ticket:', error);
      if (error instanceof Error && error.message === 'This ticket is already linked to this task') {
        toast.error('This ticket is already linked to this task');
      } else {
        toast.error('Failed to link ticket');
      }
    }
  };

  const onViewTicket = async (ticketId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        toast.error('No user session found');
        return;
      }
      
      const ticketData = await getConsolidatedTicketData(ticketId, user);
      if (!ticketData) {
        toast.error('Failed to load ticket');
        return;
      }

      openDrawer(
        <TicketDetails
          isInDrawer={true}
          initialTicket={ticketData.ticket}
          initialComments={ticketData.comments}
          initialBoard={ticketData.board}
          initialClient={ticketData.client}
          initialContactInfo={ticketData.contactInfo}
          initialCreatedByUser={ticketData.createdByUser}
          initialAdditionalAgents={ticketData.additionalAgents}
          statusOptions={ticketData.options.status}
          agentOptions={ticketData.options.agent}
          boardOptions={ticketData.options.board}
          priorityOptions={ticketData.options.priority}
          initialCategories={ticketData.categories}
          initialClients={ticketData.clients}
          initialAgentSchedules={ticketData.agentSchedules}
          initialUserMap={ticketData.userMap}
          initialAvailableAgents={ticketData.availableAgents}
          currentUser={user}
        />
      );
    } catch (error) {
      console.error('Error loading ticket:', error);
      toast.error('Failed to load ticket');
    }
  };

  const onDeleteLink = async (linkId: string) => {
    try {
      if (taskId) {
        await deleteTaskTicketLinkAction(linkId);
        
        // Update state directly instead of fetching all links again
        const newLinks = (taskTicketLinks || []).filter(link => link.link_id !== linkId);
        setTaskTicketLinks(newLinks);
        onLinksChange?.(newLinks);
      } else {
        // For new tasks, just remove from state
        const newLinks = (taskTicketLinks || []).filter(link => link.link_id !== linkId);
        setTaskTicketLinks(newLinks);
        onLinksChange?.(newLinks);
      }
      toast.success('Ticket link removed');
    } catch (error) {
      console.error('Error deleting ticket link:', error);
      toast.error('Failed to remove ticket link');
    }
  };

  const handleBoardSelect = (boardId: string) => {
    setSelectedBoard(boardId);
    setBoardFilterState('all');
  };

  const onNewTicketCreated = async (ticket: ITicket) => {
    if (!ticket.ticket_id) {
      toast.error('Invalid ticket ID');
      return;
    }
    try {
      if (taskId) {
        await addTicketLinkAction(projectId, taskId, ticket.ticket_id, phaseId);
        
        // Create a new link object instead of fetching all links again
        const newLink: IProjectTicketLinkWithDetails = {
          link_id: `new-${Date.now()}`, // This will be replaced with the actual ID on next fetch
          task_id: taskId,
          ticket_id: ticket.ticket_id,
          ticket_number: ticket.ticket_number || `#${Date.now()}`,
          title: ticket.title,
          created_at: new Date(),
          project_id: projectId,
          phase_id: phaseId,
          status_name: defaultStatus?.name || 'New',
          is_closed: false
        };
        
        const updatedLinks = [...(taskTicketLinks || []), newLink];
        setTaskTicketLinks(updatedLinks);
        onLinksChange?.(updatedLinks);
      } else {
        // For new tasks, add to temporary list
        const link = addTempTicketLink(ticket);
        if (link) {
          toast.success('Ticket created and linked successfully');
        }
      }
      
      // Add the new ticket to available tickets instead of fetching all again
      if (ticketsLoaded) {
        setAvailableTickets(prev => [
          ...prev,
          {
            ticket_id: ticket.ticket_id,
            ticket_number: ticket.ticket_number || `#${Date.now()}`,
            title: ticket.title,
            status_name: defaultStatus?.name || 'New',
            // Use type assertion to handle potential property differences
            status_id: defaultStatus?.status_id,
            category_id: ticket.category_id,
            assigned_to: ticket.assigned_to,
            board_id: ticket.board_id,
            priority_id: ticket.priority_id
          } as ITicketListItem
        ]);
      }
      
      setShowCreateDialog(false);
    } catch (error) {
      console.error('Error linking new ticket:', error);
      toast.error('Failed to link new ticket');
    }
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Associated Tickets</h3>
        <div className="flex space-x-2">
          <Button
            id="show-link-dialog-button"
            type="button"
            variant="soft"
            onClick={() => {
              // Load data when dialog is opened
              fetchTickets();
              fetchFilterOptions();
              setShowLinkTicketDialog(true);
            }}
            className="flex items-center"
          >
            <Link className="h-4 w-4 mr-1" />
            Link Ticket
          </Button>
          <Button
            id="show-create-dialog-button"
            type="button"
            variant="soft"
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center"
          >
            <Plus className="h-4 w-4 mr-1" />
            Create Ticket
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {(taskTicketLinks || []).map((link): JSX.Element => (
          <div key={link.link_id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
            <div className="flex flex-col">
              <span>{link.ticket_number} - {link.title}</span>
              {link.status_name && (
                <span className="text-xs text-gray-500 mt-0.5">
                  {link.status_name}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                id={`view-ticket-${link.ticket_id}-button`}
                type="button"
                variant="ghost"
                onClick={() => onViewTicket(link.ticket_id)}
                className="flex items-center text-sm"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
              </Button>
              <Button
                id={`delete-link-${link.link_id}-button`}
                type="button"
                variant="ghost"
                onClick={() => onDeleteLink(link.link_id)}
                className="flex items-center text-sm text-red-500 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {showLinkTicketDialog && (
        <Dialog 
          isOpen={showLinkTicketDialog} 
          onClose={() => setShowLinkTicketDialog(false)}
          title="Link Existing Ticket"
          className="max-w-xl"
        >
          <DialogContent>
            <div className="relative">
              <div className="[&_select]:z-[200] [&_[role=listbox]]:z-[200] [&_[role=presentation]]:z-[200] [&_.radix-select-content]:z-[200] [&_.radix-select-portal]:z-[200] [&_.radix-select-viewport]:z-[200]">
                  <div className="space-y-4">
                    {/* Top Section - Search and Category on same line */}
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <Input
                          placeholder="Search tickets..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full"
                        />
                      </div>
                      <div className="flex-1">
                        <CategoryPicker
                          id='category-picker'
                          categories={categories}
                          selectedCategories={selectedCategories}
                          onSelect={setSelectedCategories}
                          placeholder="Category"
                          multiSelect={false}
                        />
                      </div>
                    </div>

                    {/* Rest of the filters */}
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
                            size="sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Board
                          </label>
                          <BoardPicker
                            id='board-picker'
                            boards={boards}
                            onSelect={handleBoardSelect}
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
                    <div className="mt-4 mb-2">
                      {(searchTerm || selectedCategories.length > 0 || selectedUser || 
                        selectedBoard || selectedTicketStatus !== 'all' || 
                        (selectedPriority && selectedPriority !== 'all')) && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {searchTerm && (
                            <span className="inline-flex items-center gap-1 text-sm bg-gray-100 px-2 py-1 rounded">
                              Search: {searchTerm}
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
                              Board: {boards.find(c => c.board_id === selectedBoard)?.board_name}
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
                            id="clear-filters-button"
                            variant="ghost"
                            size="sm"
                            onClick={clearAllFilters}
                            className="text-sm text-gray-500"
                          >
                            Clear all
                          </Button>
                        </div>
                      )}
                    </div>
                    
                    {/* Tickets Dropdown */}
                    <div className="mt-6">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Select Ticket
                      </label>
                      <TicketSelect
                        value={selectedTicketId}
                        onValueChange={setSelectedTicketId}
                        options={filteredTicketOptions}
                        placeholder="Select a ticket"
                        className="w-full"
                        searchValue={searchTerm}
                        onSearchChange={setSearchTerm}
                      />
                    </div>

                    <div className="flex justify-end space-x-2 mt-6">
                      <Button id="cancel-link-dialog-button" variant="ghost" onClick={() => setShowLinkTicketDialog(false)}>
                        Cancel
                      </Button>
                      <Button id="confirm-link-button" onClick={onLinkTicket} disabled={!selectedTicketId}>
                        Link Ticket
                      </Button>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showCreateDialog && (
        <div className="relative z-[80]">
          <QuickAddTicket
            id='quick-add-ticket'
            open={showCreateDialog}
            onOpenChange={(open) => {
              if (!open) {
                setShowCreateDialog(false);
              }
            }}
            onTicketAdded={onNewTicketCreated}
            isEmbedded={true}
          />
        </div>
      )}
    </div>
  );
}
