'use client';

import { useState, useEffect } from 'react';
import { QuickAddTicket } from '@/components/tickets/QuickAddTicket';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { 
  addTicketLinkAction,
  deleteTaskTicketLinkAction,
  getTaskTicketLinksAction
} from '@/lib/actions/project-actions/projectTaskActions';
import { getTicketsForList, getTicketById } from '@/lib/actions/ticket-actions/ticketActions';
import { ITicketListFilters } from '@/interfaces/ticket.interfaces';
import { useDrawer } from '@/context/DrawerContext';
import TicketDetails from '@/components/tickets/TicketDetails';
import { ITicketListItem, ITicket, ITicketCategory } from '@/interfaces/ticket.interfaces';
import { IProjectTicketLinkWithDetails } from '@/interfaces/project.interfaces';
import { Button } from '@/components/ui/Button';
import { Link, Plus, ExternalLink, Trash2, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import * as Dialog from '@radix-ui/react-dialog';
import { Input } from '@/components/ui/Input';
import CustomSelect from '@/components/ui/CustomSelect';
import { CategoryPicker } from '@/components/tickets/CategoryPicker';
import UserPicker from '@/components/ui/UserPicker';
import { ChannelPicker } from '@/components/settings/general/ChannelPicker';
import { IChannel } from '@/interfaces';
import { getTicketCategories } from '@/lib/actions/ticketCategoryActions';
import { getAllChannels } from '@/lib/actions/channel-actions/channelActions';
import { getTicketStatuses } from '@/lib/actions/status-actions/statusActions';
import { getAllPriorities } from '@/lib/actions/priorityActions';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
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
  channel_id?: string;
  priority_id?: string;
  company_id?: string;
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
  initialLinks = [],
  users,
  onLinksChange
}: TaskTicketLinksProps) {

  const [taskTicketLinks, setTaskTicketLinks] = useState<IProjectTicketLinkWithDetails[]>(initialLinks);
  const [availableTickets, setAvailableTickets] = useState<ITicketListItem[]>([]);
  const { openDrawer } = useDrawer();
  const [showLinkTicketDialog, setShowLinkTicketDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [statusOptions, setStatusOptions] = useState<SelectOption[]>([
    { value: 'all', label: 'All Statuses' }
  ]);
  const [priorityOptions, setPriorityOptions] = useState<SelectOption[]>([
    { value: 'all', label: 'All Priorities' }
  ]);
  const [channelFilterState, setChannelFilterState] = useState<'active' | 'inactive' | 'all'>('all');
  const [companyOptions, setCompanyOptions] = useState<SelectOption[]>([]);
  const [selectedTicketStatus, setSelectedTicketStatus] = useState('all');
  const [selectedTicketId, setSelectedTicketId] = useState('');

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedCategories([]);
    setSelectedUser('');
    setSelectedChannel('');
    setSelectedPriority('');
    setSelectedTicketStatus('all');
    setChannelFilterState('all');
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
      case 'channel':
        setSelectedChannel('');
        setChannelFilterState('all');
        break;
      case 'priority':
        setSelectedPriority('');
        break;
      case 'status':
        setSelectedTicketStatus('all');
        break;
    }
  };

  useEffect(() => {
    let mounted = true;

    const fetchTickets = async () => {
      try {
        const user = await getCurrentUser();
        if (!user || !mounted) return;

        const filters: ITicketListFilters = {
          channelFilterState: 'all'
        };
        const tickets = await getTicketsForList(user, filters);
        if (mounted) {
          setAvailableTickets(tickets || []);
        }
      } catch (error) {
        console.error('Error fetching tickets:', error);
        if (mounted) {
          setAvailableTickets([]);
        }
      }
    };

    fetchTickets();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchFilterOptions = async () => {
      try {
        const [
          fetchedCategories,
          fetchedChannels,
          statuses,
          priorities
        ] = await Promise.all([
          getTicketCategories().catch(() => []),
          getAllChannels().catch(() => []),
          getTicketStatuses().catch(() => []),
          getAllPriorities().catch(() => [])
        ]);

        if (!mounted) return;

        setCategories(fetchedCategories || []);
        setChannels(fetchedChannels || []);
        
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
      } catch (error) {
        console.error('Error fetching filter options:', error);
        if (mounted) {
          setCategories([]);
          setChannels([]);
          setStatusOptions([{ value: 'all', label: 'All Statuses' }]);
          setPriorityOptions([{ value: 'all', label: 'All Priorities' }]);
        }
      }
    };

    fetchFilterOptions();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchLinks = async () => {
      if (taskId) {
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
  }, [taskId, onLinksChange]);

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
      
      const matchesChannel = !selectedChannel || selectedChannel === 'all' || 
        ticket.channel_id === selectedChannel;
      
      const matchesPriority = !selectedPriority || selectedPriority === 'all' || 
        ticket.priority_id === selectedPriority;

      const matchesStatus = selectedTicketStatus === 'all' || 
        ticket.status_id === selectedTicketStatus;

      return matchesSearch && matchesCategory && matchesUser && 
             matchesChannel && matchesPriority && matchesStatus;
    })
    .map((ticket): SelectOption => ({
      value: ticket.ticket_id!,
      label: `${ticket.ticket_number} - ${ticket.title}`,
      status_name: ticket.status_name || undefined,
      status_id: ticket.status_id || undefined,
      category_id: ticket.category_id || undefined,
      assigned_to: ticket.assigned_to || undefined,
      channel_id: ticket.channel_id || undefined,
      priority_id: ticket.priority_id || undefined
    }));

  const addTempTicketLink = (ticketDetails: TicketDetails | ITicketListItem | ITicket) => {
    // Check if ticket is already linked
    if (!('ticket_id' in ticketDetails) || !ticketDetails.ticket_id) {
      return null;
    }

    const isAlreadyLinked = taskTicketLinks.some(link => link.ticket_id === ticketDetails.ticket_id);
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
    const newLinks = [...taskTicketLinks, tempLink];
    setTaskTicketLinks(newLinks);
    onLinksChange?.(newLinks);
    return tempLink;
  };

  const onLinkTicket = async () => {
    if (!selectedTicketId) return;
    
    try {
      if (taskId) {
        await addTicketLinkAction(projectId, taskId, selectedTicketId, phaseId);
        const links = await getTaskTicketLinksAction(taskId);
        setTaskTicketLinks(links);
        onLinksChange?.(links);
        toast.success('Ticket linked successfully');
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
      
      const ticket = await getTicketById(ticketId, user);
      if (!ticket) {
        toast.error('Failed to load ticket');
        return;
      }

      openDrawer(<TicketDetails initialTicket={ticket} />);
    } catch (error) {
      console.error('Error loading ticket:', error);
      toast.error('Failed to load ticket');
    }
  };

  const onDeleteLink = async (linkId: string) => {
    try {
      if (taskId) {
        await deleteTaskTicketLinkAction(linkId);
        const links = await getTaskTicketLinksAction(taskId);
        setTaskTicketLinks(links);
        onLinksChange?.(links);
      } else {
        // For new tasks, just remove from state
        const newLinks = taskTicketLinks.filter(link => link.link_id !== linkId);
        setTaskTicketLinks(newLinks);
        onLinksChange?.(newLinks);
      }
      toast.success('Ticket link removed');
    } catch (error) {
      console.error('Error deleting ticket link:', error);
      toast.error('Failed to remove ticket link');
    }
  };

  const handleChannelSelect = (channelId: string) => {
    setSelectedChannel(channelId);
    setChannelFilterState('all');
  };

  const onNewTicketCreated = async (ticket: ITicket) => {
    if (!ticket.ticket_id) {
      toast.error('Invalid ticket ID');
      return;
    }
    try {
      if (taskId) {
        await addTicketLinkAction(projectId, taskId, ticket.ticket_id, phaseId);
        const links = await getTaskTicketLinksAction(taskId);
        setTaskTicketLinks(links);
        onLinksChange?.(links);
      } else {
        // For new tasks, add to temporary list
        const link = addTempTicketLink(ticket);
        if (link) {
          toast.success('Ticket created and linked successfully');
        }
      }
      
      // Update available tickets list
      const user = await getCurrentUser();
      if (user) {
        const filters: ITicketListFilters = {
          channelFilterState: 'all'
        };
        const tickets = await getTicketsForList(user, filters);
        setAvailableTickets(tickets);
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
            onClick={() => setShowLinkTicketDialog(true)}
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
        {taskTicketLinks.map((link): JSX.Element => (
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
        <Dialog.Root 
          open={showLinkTicketDialog} 
          onOpenChange={(open) => !open && setShowLinkTicketDialog(false)}
          modal={true}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50 z-[60]" />
            <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-[580px] z-[70]">
              <div className="relative">
                <div className="[&_select]:z-[200] [&_[role=listbox]]:z-[200] [&_[role=presentation]]:z-[200] [&_.radix-select-content]:z-[200] [&_.radix-select-portal]:z-[200] [&_.radix-select-viewport]:z-[200]">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">Link Existing Ticket</h2>
                    <button
                      id="close-dialog-button"
                      onClick={() => setShowLinkTicketDialog(false)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
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
                            Channel
                          </label>
                          <ChannelPicker
                            id='channel-picker'
                            channels={channels}
                            onSelect={handleChannelSelect}
                            selectedChannelId={selectedChannel}
                            filterState={channelFilterState}
                            onFilterStateChange={setChannelFilterState}
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
                        selectedChannel || selectedTicketStatus !== 'all' || 
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
                          {selectedChannel && (
                            <span className="inline-flex items-center gap-1 text-sm bg-gray-100 px-2 py-1 rounded">
                              Channel: {channels.find(c => c.channel_id === selectedChannel)?.channel_name}
                              <button onClick={() => removeFilter('channel')} className="text-gray-500 hover:text-gray-700">
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
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
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
