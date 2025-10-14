// server/src/components/interactions/OverallInteractionsFeed.tsx
'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { IInteraction, IInteractionType } from 'server/src/interfaces/interaction.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { IContact } from 'server/src/interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { Filter, RefreshCw, ChevronRight, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { getRecentInteractions, getInteractionStatuses } from 'server/src/lib/actions/interactionActions';
import { getAllInteractionTypes } from 'server/src/lib/actions/interactionTypeActions';
import { useDrawer } from "server/src/context/DrawerContext";
import InteractionDetails from './InteractionDetails';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import InteractionIcon from 'server/src/components/ui/InteractionIcon';
import UserPicker from 'server/src/components/ui/UserPicker';
import { ContactPicker } from 'server/src/components/ui/ContactPicker';
// ClientPicker replaced with CustomSelect
import { Input } from 'server/src/components/ui/Input';
import { DateTimePicker } from 'server/src/components/ui/DateTimePicker';
import { Button } from 'server/src/components/ui/Button';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent, ContainerComponent } from 'server/src/types/ui-reflection/types';

interface OverallInteractionsFeedProps {
  users: IUserWithRoles[];
  contacts: IContact[];
  clients: IClient[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}


const OverallInteractionsFeed: React.FC<OverallInteractionsFeedProps> = ({ 
  users, 
  contacts, 
  clients,
  isCollapsed = false,
  onToggleCollapse
}) => {
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [interactionTypes, setInteractionTypes] = useState<IInteractionType[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [selectedContact, setSelectedContact] = useState<string>('all');
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [startTime, setStartTime] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState<Date | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [interactionTypeId, setInteractionTypeId] = useState<string>('all');
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const { openDrawer } = useDrawer();

  // UI Reflection System Integration
  const { automationIdProps: searchInputProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: 'overall-interactions-search',
    type: 'formField',
    fieldType: 'textField',
    label: 'Search All Interactions',
    helperText: 'Search across all interactions in the system'
  });

  const { automationIdProps: filterButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'overall-interactions-filter-button',
    type: 'button',
    label: 'Filter Interactions',
    helperText: 'Open advanced filter options for interactions'
  });

  const { automationIdProps: resetButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'overall-interactions-reset-button',
    type: 'button',
    label: 'Reset Filters',
    helperText: 'Clear all applied filters'
  });

  const { automationIdProps: clientPickerProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: 'overall-interactions-client-picker',
    type: 'formField',
    fieldType: 'select',
    label: 'Filter by Client',
    helperText: 'Filter interactions by associated client'
  });

  const { automationIdProps: startTimePickerProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: 'overall-interactions-start-time',
    type: 'formField',
    fieldType: 'textField',
    label: 'Interaction Start Time',
    helperText: 'Filter interactions from this start time'
  });

  const { automationIdProps: endTimePickerProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: 'overall-interactions-end-time',
    type: 'formField',
    fieldType: 'textField',
    label: 'Interaction End Time',
    helperText: 'Filter interactions until this end time'
  });

  useEffect(() => {
    fetchInteractionTypes();
    fetchStatuses();
    fetchInteractions();
  }, []);

  const fetchInteractionTypes = async () => {
    try {
      const types = await getAllInteractionTypes();
      // Sort to ensure system types appear first
      const sortedTypes = types.sort((a, b) => {
        // If both are system types or both are tenant types, sort by name
        if (('created_at' in a) === ('created_at' in b)) {
          return a.type_name.localeCompare(b.type_name);
        }
        // System types ('created_at' exists) come first
        return 'created_at' in a ? -1 : 1;
      });
      setInteractionTypes(sortedTypes);
    } catch (error) {
      console.error('Error fetching interaction types:', error);
    }
  };

  const fetchStatuses = async () => {
    try {
      const statusList = await getInteractionStatuses();
      setStatuses(statusList);
    } catch (error) {
      console.error('Error fetching interaction statuses:', error);
    }
  };

  const fetchInteractions = useCallback(async () => {
    try {
      const fetchedInteractions = await getRecentInteractions({});
      setInteractions(fetchedInteractions);
    } catch (error) {
      console.error('Error fetching interactions:', error);
    }
  }, []);

  const getTypeLabel = (type: IInteractionType) => {
    return (
      <div className="flex items-center gap-2">
        <InteractionIcon icon={type.icon} typeName={type.type_name} />
        <span>{type.type_name}</span>
      </div>
    );
  };

  const filteredInteractions = useMemo(() => {
    return interactions.filter(interaction => {
      // Text search
      const matchesSearch = !searchTerm || (
        interaction.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        interaction.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        interaction.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      // Filter conditions
      const matchesUser = selectedUser === 'all' || interaction.user_id === selectedUser;
      const matchesContact = selectedContact === 'all' || interaction.contact_name_id === selectedContact;
      const matchesClient = selectedClient === 'all' || interaction.client_id === selectedClient;
      const matchesStatus = selectedStatus === 'all' || interaction.status_id === selectedStatus;
      const matchesType = interactionTypeId === 'all' || interaction.type_id === interactionTypeId;
      
      // Time-based filtering (using start_time and end_time if available, fallback to interaction_date)
      const interactionStartTime = interaction.start_time ? new Date(interaction.start_time) : new Date(interaction.interaction_date);
      const interactionEndTime = interaction.end_time ? new Date(interaction.end_time) : new Date(interaction.interaction_date);
      
      const matchesStartTime = !startTime || interactionStartTime >= startTime;
      const matchesEndTime = !endTime || interactionEndTime <= endTime;
      
      return matchesSearch && matchesUser && matchesContact && matchesClient && 
             matchesStatus && matchesType && matchesStartTime && matchesEndTime;
    });
  }, [interactions, searchTerm, selectedUser, selectedContact, selectedClient, selectedStatus, interactionTypeId, startTime, endTime]);

  const isFilterActive = useMemo(() => {
    return selectedUser !== 'all' ||
           selectedContact !== 'all' ||
           selectedClient !== 'all' ||
           selectedStatus !== 'all' ||
           interactionTypeId !== 'all' ||
           startTime !== undefined ||
           endTime !== undefined;
  }, [selectedUser, selectedContact, selectedClient, selectedStatus, interactionTypeId, startTime, endTime]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleInteractionDeleted = useCallback((deletedInteractionId: string) => {
    // Remove the deleted interaction from the list
    setInteractions(prevInteractions => 
      prevInteractions.filter(i => i.interaction_id !== deletedInteractionId)
    );
  }, [setInteractions]);

  const handleInteractionUpdated = useCallback((updatedInteraction: IInteraction) => {
    // Update the interaction in the list
    setInteractions(prevInteractions => 
      prevInteractions.map(i => 
        i.interaction_id === updatedInteraction.interaction_id ? updatedInteraction : i
      )
    );
  }, [setInteractions]);

  const handleInteractionClick = (interaction: IInteraction) => {
    openDrawer(
      <InteractionDetails 
        interaction={interaction} 
        onInteractionDeleted={() => handleInteractionDeleted(interaction.interaction_id)}
        onInteractionUpdated={handleInteractionUpdated}
      />
    );
  };

  const resetFilters = () => {
    setSelectedUser('all');
    setSelectedContact('all');
    setSelectedClient('all');
    setSelectedStatus('all');
    setStartTime(undefined);
    setEndTime(undefined);
    setInteractionTypeId('all');
  };

  const handleApplyFilters = () => {
    setIsFilterDialogOpen(false);
  };

  const handleUserChange = (userId: string) => {
    setSelectedUser(userId === '' ? 'all' : userId);
  };

  const userPickerValue = selectedUser === 'all' ? '' : selectedUser;
  
  const handleContactChange = (contactId: string) => {
    setSelectedContact(contactId === '' ? 'all' : contactId);
  };
  const contactPickerValue = selectedContact === 'all' ? '' : selectedContact;
  
  const handleClientChange = (clientId: string | null) => {
    const newClientSelection = clientId === null || clientId === '' ? 'all' : clientId;
    setSelectedClient(newClientSelection);
    
    // Reset contact selection when client changes
    if (newClientSelection !== selectedClient) {
      setSelectedContact('all');
    }
  };
  const selectedClientValue = selectedClient === 'all' ? null : selectedClient;
  
  // Filter contacts based on selected client
  const filteredContacts = useMemo(() => {
    if (selectedClient === 'all') {
      return contacts; // Show all contacts if no client is selected
    }
    return contacts.filter(contact => contact.client_id === selectedClient);
  }, [contacts, selectedClient]);

  return (
    <ReflectionContainer id="overall-interactions-feed" label="Overall Interactions Feed">
      {isCollapsed ? (
        <div className="bg-white shadow rounded-lg h-full flex items-center justify-center p-2">
          <Button
            id="expand-interactions-button"
            onClick={onToggleCollapse}
            variant="ghost"
            className="flex flex-col items-center gap-2 h-full min-h-[200px]"
            aria-label="Expand Recent Interactions"
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="writing-mode-vertical-lr text-sm font-semibold" style={{ writingMode: 'vertical-lr' }}>
              Recent Interactions
            </span>
          </Button>
        </div>
      ) : (
      <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Recent Interactions</h2>
        <Button
          id="collapse-interactions-button"
          onClick={onToggleCollapse}
          variant="ghost"
          size="sm"
          className="p-1"
          aria-label="Collapse"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
      <div className="flex flex-nowrap items-stretch gap-4 mb-4">
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 w-full h-full">
            <Input
              {...searchInputProps}
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search interactions"
              className="w-full h-full py-3"
            />
          </div>
        </div>
        {isFilterActive ? (
          <Button
            {...resetButtonProps}
            onClick={resetFilters}
            size="lg"
            variant="outline"
            className="flex-shrink-0 whitespace-nowrap"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset
          </Button>
        ) : (
          <Button
            {...filterButtonProps}
            onClick={() => setIsFilterDialogOpen(true)}
            size="lg"
            className="flex-shrink-0 whitespace-nowrap"
          >
            <Filter className="mr-2" />
            Filter
          </Button>
        )}
      </div>

      <Dialog 
        isOpen={isFilterDialogOpen} 
        onClose={() => setIsFilterDialogOpen(false)} 
        title="Filter Interactions"
      >
        <DialogContent>
          <div className="space-y-4">
            <CustomSelect
              options={[
                { value: 'all', label: 'All Types' },
                ...interactionTypes.map((type) => ({
                  value: type.type_id,
                  label: getTypeLabel(type)
                }))
              ]}
              value={interactionTypeId}
              onValueChange={setInteractionTypeId}
              placeholder="Interaction Type"
            />
            <UserPicker
              users={users}
              value={userPickerValue}
              onValueChange={handleUserChange}
              placeholder="All Users"
              buttonWidth="full"
            />      
            <div className="space-y-2">
              <CustomSelect
                {...clientPickerProps}
                options={clients.map((client) => ({
                  value: client.client_id,
                  label: client.client_name
                }))}
                value={selectedClientValue || null}
                onValueChange={handleClientChange}
                placeholder="Filter by client"
              />
            </div>
            <ContactPicker
              contacts={filteredContacts}
              value={contactPickerValue}
              onValueChange={handleContactChange}
              placeholder={selectedClient === 'all' ? "All Contacts" : "Contacts from selected client"}
              buttonWidth="full"
              disabled={selectedClient !== 'all' && filteredContacts.length === 0}
            />
            <CustomSelect
              options={[
                { value: 'all', label: 'All Statuses' },
                ...statuses.map((status) => ({
                  value: status.status_id,
                  label: status.name
                }))
              ]}
              value={selectedStatus}
              onValueChange={setSelectedStatus}
              placeholder="Status"
            />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Interaction Start Time</label>
                <DateTimePicker
                  {...startTimePickerProps}
                  value={startTime}
                  onChange={setStartTime}
                  placeholder="Filter from this start time"
                  label="Start Time"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Interaction End Time</label>
                <DateTimePicker
                  {...endTimePickerProps}
                  value={endTime}
                  onChange={setEndTime}
                  placeholder="Filter until this end time"
                  label="End Time"
                  minDate={startTime}
                />
              </div>
            </div>
            <div className="flex justify-between">
              <Button 
                id="reset-filters-button"
                onClick={resetFilters} 
                variant="outline" 
                className="flex items-center"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset Filters
              </Button>
              <Button 
                id="apply-filters-button"
                onClick={handleApplyFilters}
              >
                Apply Filters
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      <ul className="space-y-4 overflow-y-auto max-h-[calc(100vh-300px)]">
        {filteredInteractions.map((interaction: IInteraction): JSX.Element => (
          <li key={interaction.interaction_id} className="flex items-start space-x-3 p-2 hover:bg-gray-100 rounded cursor-pointer" onClick={() => handleInteractionClick(interaction)}>
            <InteractionIcon icon={interaction.icon} typeName={interaction.type_name} />
            <div>
              <p className="font-semibold">{interaction.title}</p>
              <p className="text-sm text-gray-500">
                {new Date(interaction.interaction_date).toLocaleString()} - 
                {interaction.contact_name && (
                  <Link href={`/msp/contacts/${interaction.contact_name_id}`} className="text-blue-500 hover:underline">
                    {interaction.contact_name}
                  </Link>
                )}
                {interaction.client_name && ` (${interaction.client_name})`}
              </p>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>By {interaction.user_name}</span>
                {interaction.status_name && (
                  <>
                    <span>•</span>
                    <span className="text-gray-600">{interaction.status_name}</span>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      </div>
      )}
    </ReflectionContainer>
  );
};

export default OverallInteractionsFeed;
