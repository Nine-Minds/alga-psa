'use client';

import React, { useState, useEffect, useRef } from 'react';
import { fromZonedTime } from 'date-fns-tz';
import { getScheduledHoursForTicket, getTicketAppointmentRequests } from '../../actions/ticketActions';
import { ITicket, ITimeSheet, ITimePeriod, ITimePeriodView, ITimeEntry, IAgentSchedule, IClient, IClientLocation, IContact } from '@alga-psa/types'; // Added IClient and IClientLocation
import { IUserWithRoles, ITeam } from '@alga-psa/types';
import { ITicketResource } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { TagManager } from '@alga-psa/tags/components';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Clock, Edit2, Play, Pause, StopCircle, UserPlus, X, Calendar as CalendarIcon, Building, Users, CalendarCheck } from 'lucide-react';
import { ContentCard } from '@alga-psa/ui/components';
import { formatMinutesAsHoursAndMinutes } from '@alga-psa/core';
import styles from './TicketDetails.module.css';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { toast } from 'react-hot-toast';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { getUserAvatarUrlAction, getContactAvatarUrlAction, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getUserContactId } from '@alga-psa/user-composition/actions';
import { utcToLocal, formatDateTime, getUserTimeZone } from '@alga-psa/core';
import { getTicketingDisplaySettings } from '../../actions/ticketDisplaySettings';
import type { TicketWatchListEntry } from '@shared/lib/tickets/watchList';
import TicketMaterialsCard from './TicketMaterialsCard';
import TicketWatchListCard from './TicketWatchListCard';
import TicketTimeEntries from './TicketTimeEntries';
import { useRegisterUnsavedChanges } from '@alga-psa/ui/context';
import { useDrawer } from '@alga-psa/ui';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { isBoardLiveTicketTimerEnabled } from '../../lib/boardLiveTicketTimer';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TicketPropertiesProps {
  id?: string;
  ticket: ITicket;
  client: any;
  contactInfo: any;
  createdByUser: any;
  board: any;
  isLiveTicketTimerEnabled?: boolean;
  elapsedTime: number;
  isRunning: boolean;
  isTimerLocked?: boolean;
  timeDescription: string;
  team: ITeam | null;
  teams?: ITeam[];
  additionalAgents: ITicketResource[];
  availableAgents: IUserWithRoles[];
  currentTimeSheet: ITimeSheet | null;
  currentTimePeriod: ITimePeriodView | null;
  userId: string;
  tenant: string;
  contacts: any[];
  clients: IClient[];
  locations?: IClientLocation[];
  clientFilterState: 'all' | 'active' | 'inactive';
  clientTypeFilter: 'all' | 'company' | 'individual';
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onTimeDescriptionChange: (value: string) => void;
  onAddTimeEntry: () => void;
  onClientClick: () => void;
  onContactClick: () => void;
  onAgentClick: (userId: string) => void;
  onAddAgent: (userId: string) => Promise<void>;
  onRemoveAgent: (assignmentId: string) => Promise<void>;
  onChangeContact: (contactId: string | null) => void;
  onChangeClient: (clientId: string) => void;
  onChangeLocation?: (locationId: string | null) => void;
  onClientFilterStateChange: (state: 'all' | 'active' | 'inactive') => void;
  onClientTypeFilterChange: (type: 'all' | 'company' | 'individual') => void;
  tags?: ITag[];
  allTagTexts?: string[];
  onTagsChange?: (tags: ITag[]) => void;
  onItilFieldChange?: (field: string, value: any) => void;
  onUpdateWatchList?: (watchList: TicketWatchListEntry[]) => Promise<boolean>;
  watchListSaving?: boolean;
  allContactsForWatchList?: IContact[];
  allContactsForWatchListLoading?: boolean;
  onLoadAllContactsForWatchList?: () => Promise<void>;
  surveySummaryCard?: React.ReactNode;
  renderIntervalManagement?: (args: { ticketId: string; userId: string }) => React.ReactNode;
  onRemoveTeamAssignment?: (mode: 'remove_all' | 'keep_all' | 'selective', keepUserIds?: string[]) => Promise<void>;
  onAssignTeam?: (teamId: string) => Promise<void>;
  timeEntriesRefreshKey?: number;
  onEditTimeEntry?: (entry: { entry_id: string }) => void;
  onDeleteTimeEntry?: (entry: { entry_id: string; user_name: string | null }) => void;
}

// Helper function to format location display
const formatLocationDisplay = (location: IClientLocation, unnamedLocationLabel: string): string => {
  const parts: string[] = [];
  
  if (location.location_name) {
    parts.push(location.location_name);
  }
  
  if (location.address_line1) {
    parts.push(location.address_line1);
  }
  
  if (location.city && location.state_province) {
    parts.push(`${location.city}, ${location.state_province}`);
  } else if (location.city) {
    parts.push(location.city);
  } else if (location.state_province) {
    parts.push(location.state_province);
  }
  
  if (location.postal_code) {
    parts.push(location.postal_code);
  }
  
  return parts.join(' - ') || unnamedLocationLabel;
};

const TicketProperties: React.FC<TicketPropertiesProps> = ({
  id = 'ticket-properties',
  ticket,
  client,
  contactInfo,
  createdByUser,
  board,
  isLiveTicketTimerEnabled,
  elapsedTime,
  isRunning,
  isTimerLocked = false,
  timeDescription,
  team,
  teams = [],
  additionalAgents,
  availableAgents,
  currentTimeSheet,
  currentTimePeriod,
  userId,
  tenant,
  contacts,
  clients,
  locations = [],
  clientFilterState,
  clientTypeFilter,
  onStart,
  onPause,
  onStop,
  onTimeDescriptionChange,
  onAddTimeEntry,
  onClientClick,
  onContactClick,
  onAgentClick,
  onAddAgent,
  onRemoveAgent,
  onChangeContact,
  onChangeClient,
  onChangeLocation,
  onClientFilterStateChange,
  onClientTypeFilterChange,
  tags = [],
  allTagTexts = [],
  onTagsChange,
  onItilFieldChange,
  onUpdateWatchList,
  watchListSaving = false,
  allContactsForWatchList = [],
  allContactsForWatchListLoading = false,
  onLoadAllContactsForWatchList,
  surveySummaryCard,
  renderIntervalManagement,
  onRemoveTeamAssignment,
  onAssignTeam,
  timeEntriesRefreshKey = 0,
  onEditTimeEntry,
  onDeleteTimeEntry,
}) => {
  const { openDrawer } = useDrawer();
  const { renderQuickAddContact } = useQuickAddClient();
  const { t } = useTranslation('features/tickets');
  const liveTicketTimerEnabled = isLiveTicketTimerEnabled ?? isBoardLiveTicketTimerEnabled(board);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);

  // Ref to prevent race conditions when rapidly adding/removing agents
  const isProcessingAgentsRef = useRef(false);
  const [contactFilterState, setContactFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [pickerContacts, setPickerContacts] = useState<IContact[]>(contacts);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [agentSchedules, setAgentSchedules] = useState<IAgentSchedule[]>([]);
  const isAgentTeamEmpty = !ticket.assigned_to && additionalAgents.length === 0 && !ticket.assigned_team_id;
  const [primaryAgentAvatarUrl, setPrimaryAgentAvatarUrl] = useState<string | null>(null);
  const [additionalAgentAvatarUrls, setAdditionalAgentAvatarUrls] = useState<Record<string, string | null>>({});
  const [contactAvatarUrl, setContactAvatarUrl] = useState<string | null>(null);
  const [dateTimeFormat, setDateTimeFormat] = useState<string>('MMM d, yyyy h:mm a');
  const [appointmentRequests, setAppointmentRequests] = useState<any[]>([]);
  const [showAppointmentTooltip, setShowAppointmentTooltip] = useState(false);
  const [isRemoveTeamDialogOpen, setIsRemoveTeamDialogOpen] = useState(false);

  useEffect(() => {
    setPickerContacts(contacts);
  }, [contacts]);
  const [removeTeamMode, setRemoveTeamMode] = useState<'remove_all' | 'keep_all' | 'selective'>('remove_all');
  const [selectedTeamMemberIds, setSelectedTeamMemberIds] = useState<string[]>([]);
  const [teamAvatarUrl, setTeamAvatarUrl] = useState<string | null>(null);
  const [pendingSwitchTeamId, setPendingSwitchTeamId] = useState<string | null>(null);

  // Register unsaved changes for contact, client, and location pickers
  // Popup triggers if picker is open AND a different selection is made (but not yet saved)
  const hasUnsavedContactChanges = showContactPicker && selectedContactId !== null && selectedContactId !== (contactInfo?.contact_name_id ?? '');
  const hasUnsavedClientChanges = showClientPicker && selectedClientId !== null && selectedClientId !== ticket.client_id;
  const hasUnsavedLocationChanges = showLocationPicker && selectedLocationId !== null && selectedLocationId !== ticket.location_id;

  useRegisterUnsavedChanges(`ticket-properties-contact-${id}`, hasUnsavedContactChanges);
  useRegisterUnsavedChanges(`ticket-properties-client-${id}`, hasUnsavedClientChanges);
  useRegisterUnsavedChanges(`ticket-properties-location-${id}`, hasUnsavedLocationChanges);

  const uniqueClientsForPicker = React.useMemo(() => {
    if (!clients) return [];
    const seen = new Set<string>();
    return clients.filter(client => {
      // Ensure client and client_id are valid before processing
      if (!client || typeof client.client_id === 'undefined') {
        return false;
      }
      if (seen.has(client.client_id)) {
        return false;
      }
      seen.add(client.client_id);
      return true;
    });
  }, [clients]);

  const teamMembersOnTicket = React.useMemo(() => {
    return additionalAgents.filter(agent => agent.role === 'team_member');
  }, [additionalAgents]);

  useEffect(() => {
    if (!ticket.assigned_team_id || !tenant) {
      setTeamAvatarUrl(null);
      return;
    }
    const fetchTeamAvatar = async () => {
      try {
        const map = await getTeamAvatarUrlsBatchAction([ticket.assigned_team_id!], tenant);
        if (map && typeof (map as Map<string, string | null>).get === 'function') {
          setTeamAvatarUrl((map as Map<string, string | null>).get(ticket.assigned_team_id!) ?? null);
        } else {
          setTeamAvatarUrl((map as unknown as Record<string, string | null>)[ticket.assigned_team_id!] ?? null);
        }
      } catch {
        setTeamAvatarUrl(null);
      }
    };
    fetchTeamAvatar();
  }, [ticket.assigned_team_id, tenant]);

  useEffect(() => {
    if (!isRemoveTeamDialogOpen) return;
    setSelectedTeamMemberIds(teamMembersOnTicket.map(member => member.additional_user_id).filter(Boolean) as string[]);
  }, [isRemoveTeamDialogOpen, teamMembersOnTicket]);

  // Fetch scheduled hours from schedule entries
  useEffect(() => {
    const fetchScheduledHours = async () => {
      if (!ticket.ticket_id) return;
      
      try {
        // Use the server action to get scheduled hours
        const schedules = await getScheduledHoursForTicket(ticket.ticket_id);
        setAgentSchedules(schedules);
      } catch (error) {
        console.error('Error fetching scheduled hours:', error);
      }
    };
    
    fetchScheduledHours();
  }, [ticket.ticket_id, userId]);

  // Fetch avatar URLs for primary agent, additional agents, and contact
  useEffect(() => {
    const fetchAvatarUrls = async () => {
      if (!tenant) return;

      // Fetch primary agent avatar URL
      if (ticket.assigned_to) {
        try {
          const avatarUrl = await getUserAvatarUrlAction(ticket.assigned_to, tenant);
          setPrimaryAgentAvatarUrl(avatarUrl);
        } catch (error) {
          console.error('Error fetching primary agent avatar URL:', error);
        }
      }

      // Fetch additional agents avatar URLs
      const avatarUrls: Record<string, string | null> = {};
      for (const agent of additionalAgents) {
        if (agent.additional_user_id) {
          try {
            const avatarUrl = await getUserAvatarUrlAction(agent.additional_user_id, tenant);
            avatarUrls[agent.additional_user_id] = avatarUrl;
          } catch (error) {
            console.error(`Error fetching avatar URL for agent ${agent.additional_user_id}:`, error);
          }
        }
      }
      setAdditionalAgentAvatarUrls(avatarUrls);
    };

    fetchAvatarUrls();
  }, [ticket.assigned_to, additionalAgents, tenant]);

  // Fetch contact avatar URL
  useEffect(() => {
    const fetchContactAvatarUrl = async () => {
      if (!tenant || !contactInfo?.contact_name_id) return;

      try {
        const avatarUrl = await getContactAvatarUrlAction(contactInfo.contact_name_id, tenant);
        setContactAvatarUrl(avatarUrl);
      } catch (error) {
        console.error('Error fetching contact avatar URL:', error);
      }
    };

    fetchContactAvatarUrl();
  }, [contactInfo?.contact_name_id, tenant]);

  // Helper function to get scheduled hours for a specific agent
  const getAgentScheduledHours = (agentId: string): number => {
    const schedule = agentSchedules.find(s => s.userId === agentId);
    return schedule ? schedule.minutes : 0;
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Load ticket display settings (date/time format)
  useEffect(() => {
    const loadDisplay = async () => {
      try {
        const s = await getTicketingDisplaySettings();
        if (s?.dateTimeFormat) setDateTimeFormat(s.dateTimeFormat);
      } catch (e) {
        console.error('Failed to load ticketing display settings', e);
      }
    };
    loadDisplay();
  }, []);

  // Fetch appointment requests linked to this ticket
  useEffect(() => {
    const fetchAppointmentRequests = async () => {
      if (!ticket.ticket_id) return;
      try {
        const result = await getTicketAppointmentRequests(ticket.ticket_id);
        if (result.success && result.data) {
          setAppointmentRequests(result.data);
        }
      } catch (error) {
        console.error('Error fetching appointment requests:', error);
      }
    };
    fetchAppointmentRequests();
  }, [ticket.ticket_id]);

  return (
    <>
      <div className="flex-shrink-0 space-y-6">
      <ContentCard
        id={`${id}-time-entry`}
        collapsible
        defaultExpanded
        title={t('properties.timeEntry', 'Time Entry')}
        headerIcon={<Clock className="w-5 h-5" />}
      >
        <div className="space-y-4">
          {liveTicketTimerEnabled && (
            <>
              <div className="flex items-center justify-between">
                <span>{t('properties.ticketTimer', 'Ticket Timer - #{{ticketNumber}}', { ticketNumber: ticket.ticket_number })}</span>
              </div>
              <div className={`${styles['digital-clock']} text-2xl flex items-center justify-between px-4`}>
                <span>{formatTime(elapsedTime)}</span>
                <div className='pl-5'>
                  <svg xmlns="http://www.w3.org/2000/svg" width="17" height="21" viewBox="0 0 17 21" fill="none">
                    <path d="M0.625 20.2V1L15.825 10.2571L0.625 20.2Z" fill="#000" stroke="#000" strokeWidth="0.8" />
                  </svg>
                </div>
              </div>
              <div className="flex justify-center space-x-2">
                {!isRunning ? (
                  <Button
                    {...withDataAutomationId({ id: `${id}-start-timer-btn` })}
                    onClick={onStart}
                    className={`w-24 ${isTimerLocked ? 'opacity-60' : ''}`}
                    variant='soft'
                    aria-disabled={isTimerLocked}
                    title={isTimerLocked ? t('properties.timerActiveElsewhere', 'Timer active in another window') : undefined}
                  >
                    <Play className="mr-2 h-4 w-4" /> {t('properties.start', 'Start')}
                  </Button>
                ) : (
                  <Button {...withDataAutomationId({ id: `${id}-pause-timer-btn` })} onClick={onPause} className={`w-24`} variant='soft'>
                    <Pause className="mr-2 h-4 w-4" /> {t('properties.pause', 'Pause')}
                  </Button>
                )}
                <Button {...withDataAutomationId({ id: `${id}-stop-timer-btn` })} onClick={onStop} className={`w-24`} variant='soft'>
                  <StopCircle className="mr-2 h-4 w-4" /> {t('properties.reset', 'Reset')}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">{t('fields.description', 'Description')}</Label>
                <Input
                  {...withDataAutomationId({ id: `${id}-description-input` })}
                  id="description"
                  value={timeDescription}
                  onChange={(e) => onTimeDescriptionChange(e.target.value)}
                  placeholder={t('properties.enterWorkDescription', 'Enter work description')}
                  className={styles['custom-input']}
                />
              </div>
            </>
          )}
          <div className="space-y-2">
            {!liveTicketTimerEnabled && (
              <p className="text-sm text-muted-foreground" data-testid={`${id}-live-timer-disabled-message`}>
                {t('properties.liveTimerDisabled', 'Live ticket timer is disabled for this board.')}
              </p>
            )}
          </div>
          <Button
            {...withDataAutomationId({ id: `${id}-add-time-entry-btn` })}
            type="button"
            className={`w-full mt-4 flex items-center justify-center`}
            onClick={onAddTimeEntry}
          >
            <span className="mr-2">{t('properties.addTimeEntry', 'Add Time Entry')}</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="#D6BBFB">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </Button>

          {ticket.ticket_id && userId && (
            <TicketTimeEntries
              id={id}
              ticketId={ticket.ticket_id}
              currentUserId={userId}
              dateTimeFormat={dateTimeFormat}
              refreshKey={timeEntriesRefreshKey}
              onEditEntry={onEditTimeEntry}
              onDeleteEntry={onDeleteTimeEntry}
            />
          )}

          {/* Interval Management Section */}
          {liveTicketTimerEnabled && ticket.ticket_id && userId && renderIntervalManagement && (
            <div className="mt-2 border-t pt-4" {...withDataAutomationId({ id: `${id}-interval-management` })}>
              <h3 className="text-sm font-medium mb-2">{t('properties.trackedIntervals', 'Tracked Intervals')}</h3>
              {renderIntervalManagement({ ticketId: ticket.ticket_id, userId })}
            </div>
          )}

        </div>
      </ContentCard>

      <ContentCard
        id={`${id}-contact-info`}
        collapsible
        defaultExpanded
        title={t('properties.contactInfo', 'Contact Info')}
        headerIcon={<Building className="w-5 h-5" />}
      >
        <div className="space-y-2">
          <div>
            <h5 className="font-bold">{t('properties.contact', 'Contact')}</h5>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {contactInfo && (
                    <ContactAvatar
                      contactId={contactInfo.contact_name_id || ''}
                      contactName={contactInfo.full_name || ''}
                      avatarUrl={contactAvatarUrl}
                      size="sm"
                    />
                  )}
                  <p
                    {...withDataAutomationId({ id: `${id}-contact-name` })}
                    className="text-sm text-blue-500 cursor-pointer hover:underline"
                    onClick={onContactClick}
                  >
                    {contactInfo?.full_name || t('properties.noContactSelected', 'No contact selected')}
                  </p>
                  <Button
                    {...withDataAutomationId({ id: `${id}-toggle-contact-picker-btn` })}
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowContactPicker(!showContactPicker)}
                    className="p-1 h-auto"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
                {contactInfo && showContactPicker && (
                  <Button
                    {...withDataAutomationId({ id: `${id}-remove-contact-btn` })}
                    variant="ghost"
                    size="sm"
                    onClick={() => onChangeContact(null)}
                    className="p-1 h-auto text-red-500 hover:text-red-700"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {showContactPicker && (
                <div className="space-y-2">
                  <div className="flex items-center group">
                    <ContactPicker
                      {...withDataAutomationId({ id: `${id}-contact-picker` })}
                      contacts={pickerContacts}
                      value={selectedContactId ?? contactInfo?.contact_name_id ?? ''}
                      onValueChange={setSelectedContactId}
                      clientId={client?.client_id}
                      placeholder={t('properties.selectOrChangeContact', 'Select or change contact')}
                      onAddNew={() => setIsQuickAddContactOpen(true)}
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button
                      {...withDataAutomationId({ id: `${id}-cancel-contact-picker-btn` })}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowContactPicker(false);
                        setSelectedContactId(null);
                      }}
                    >
                      {t('actions.cancel', 'Cancel')}
                    </Button>
                    <Button
                      {...withDataAutomationId({ id: `${id}-save-contact-picker-btn` })}
                      variant="default"
                      size="sm"
                      onClick={() => {
                        onChangeContact(selectedContactId);
                        setShowContactPicker(false);
                      }}
                    >
                      {t('actions.save', 'Save')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {renderQuickAddContact({
            isOpen: isQuickAddContactOpen,
            onClose: () => setIsQuickAddContactOpen(false),
            onContactAdded: (newContact) => {
              setPickerContacts((prevContacts) => {
                const existingIndex = prevContacts.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
                if (existingIndex >= 0) {
                  const nextContacts = [...prevContacts];
                  nextContacts[existingIndex] = newContact;
                  return nextContacts;
                }
                return [...prevContacts, newContact];
              });
              setSelectedContactId(newContact.contact_name_id);
              setIsQuickAddContactOpen(false);
              setShowContactPicker(true);
            },
            clients,
            selectedClientId: ticket.client_id || client?.client_id,
          })}
          <div>
            <h5 className="font-bold">{t('properties.createdBy', 'Created By')}</h5>
            <p className="text-sm">
              {createdByUser ? `${createdByUser.first_name} ${createdByUser.last_name}` : t('properties.notAvailable', 'N/A')}
            </p>
          </div>
          <div>
            <h5 className="font-bold">{t('fields.created', 'Created')}</h5>
            <p className="text-sm">
              {(() => {
                if (!ticket.entered_at) return t('properties.notAvailable', 'N/A');
                try {
                  const tz = getUserTimeZone();
                  const local = utcToLocal(ticket.entered_at, tz);
                  return formatDateTime(local, tz, dateTimeFormat);
                } catch (e) {
                  return ticket.entered_at;
                }
              })()}
            </p>
          </div>
          <div>
            <h5 className="font-bold">{t('fields.client', 'Client')}</h5>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                {client && (
                  <ClientAvatar
                    clientId={client.client_id}
                    clientName={client.client_name}
                    logoUrl={client.logoUrl}
                    size="sm"
                  />
                )}
                <p
                  className="text-sm text-blue-500 cursor-pointer hover:underline"
                  onClick={onClientClick}
                >
                  {client?.client_name || t('properties.notAvailable', 'N/A')}
                </p>
                <Button
                  {...withDataAutomationId({ id: `${id}-show-client-picker-btn` })}
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowClientPicker(!showClientPicker)}
                  className="p-1 h-auto"
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              </div>
              {showClientPicker && (
                <div className="space-y-2">
                  <div className="flex items-center group relative">
                    <div className="w-full">
                      <ClientPicker
                        {...withDataAutomationId({ id: `${id}-client-picker` })}
                        clients={uniqueClientsForPicker}
                        onSelect={setSelectedClientId}
                        selectedClientId={selectedClientId || client?.client_id || ''}
                        filterState={clientFilterState}
                        onFilterStateChange={onClientFilterStateChange}
                        clientTypeFilter={clientTypeFilter}
                        onClientTypeFilterChange={onClientTypeFilterChange}
                        fitContent={false}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button
                      {...withDataAutomationId({ id: `${id}-cancel-client-picker-btn` })}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowClientPicker(false);
                        setSelectedClientId(null);
                      }}
                    >
                      {t('actions.cancel', 'Cancel')}
                    </Button>
                    <Button
                      {...withDataAutomationId({ id: `${id}-save-client-picker-btn` })}
                      variant="default"
                      size="sm"
                      onClick={() => {
                        if (selectedClientId) {
                          onChangeClient(selectedClientId);
                        }
                        setShowClientPicker(false);
                      }}
                    >
                      {t('actions.save', 'Save')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {client && locations.length > 0 && (
            <div>
              <h5 className="font-bold">{t('properties.location', 'Location')}</h5>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <p className="text-sm">
                    {(() => {
                      const unnamedLocationLabel = t('quickAdd.unnamedLocation', 'Unnamed Location');
                      const defaultSuffix = t('properties.defaultSuffix', '(Default)');
                      // If ticket has a location, show it
                      if (ticket.location) {
                        return formatLocationDisplay(ticket.location, unnamedLocationLabel);
                      }
                      // Otherwise, show the default location if one exists
                      const defaultLocation = locations.find(l => l.is_default);
                      if (defaultLocation) {
                        return `${formatLocationDisplay(defaultLocation, unnamedLocationLabel)} ${defaultSuffix}`;
                      }
                      // Otherwise show no location
                      return t('properties.noLocationSpecified', 'No location specified');
                    })()}
                  </p>
                  <Button
                    {...withDataAutomationId({ id: `${id}-show-location-picker-btn` })}
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowLocationPicker(!showLocationPicker)}
                    className="p-1 h-auto"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
                {showLocationPicker && (
                  <div className="space-y-2">
                    <CustomSelect
                      {...withDataAutomationId({ id: `${id}-location-select` })}
                      value={selectedLocationId || ticket.location?.location_id || 'none'}
                      onValueChange={(value) => setSelectedLocationId(value === 'none' ? null : value)}
                      options={[
                        { value: 'none', label: t('properties.noSpecificLocation', 'No specific location') },
                        ...locations.map((location) => ({
                          value: location.location_id,
                          label: formatLocationDisplay(
                            location,
                            t('quickAdd.unnamedLocation', 'Unnamed Location')
                          ) + (location.is_default ? ` ${t('properties.defaultSuffix', '(Default)')}` : '')
                        }))
                      ]}
                      placeholder={t('properties.selectLocation', 'Select location')}
                      className="w-full"
                    />
                    <div className="flex justify-end space-x-2">
                      <Button
                        {...withDataAutomationId({ id: `${id}-cancel-location-picker-btn` })}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowLocationPicker(false);
                          setSelectedLocationId(null);
                        }}
                      >
                        {t('actions.cancel', 'Cancel')}
                      </Button>
                      <Button
                        {...withDataAutomationId({ id: `${id}-save-location-picker-btn` })}
                        variant="default"
                        size="sm"
                        onClick={() => {
                          if (onChangeLocation) {
                            onChangeLocation(selectedLocationId);
                          }
                          setShowLocationPicker(false);
                        }}
                      >
                        {t('actions.save', 'Save')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div>
            <h5 className="font-bold">
              {contactInfo
                ? t('properties.contactPhone', 'Contact Phone')
                : t('properties.clientPhone', 'Client Phone')}
            </h5>
            <p className="text-sm">
              {contactInfo?.default_phone_number
                || contactInfo?.phone_numbers?.find((phoneNumber: { is_default?: boolean; phone_number?: string }) => phoneNumber.is_default)?.phone_number
                || client?.phone_no
                || t('properties.notAvailable', 'N/A')}
            </p>
          </div>
          <div>
            <h5 className="font-bold">
              {contactInfo
                ? t('properties.contactEmail', 'Contact Email')
                : t('properties.clientEmail', 'Client Email')}
            </h5>
            <p className="text-sm">
              {contactInfo?.email || client?.email || t('properties.notAvailable', 'N/A')}
            </p>
          </div>
        </div>
      </ContentCard>

      <ContentCard
        id={`${id}-agent-team`}
        collapsible
        defaultExpanded={!isAgentTeamEmpty}
        title={t('properties.agentTeam', 'Agent team')}
        headerIcon={<Users className="w-5 h-5" />}
        count={(ticket.assigned_to ? 1 : 0) + additionalAgents.length}
      >
        <div className="flex items-center justify-end mb-4">
          {/* Appointment Requests Indicator */}
          {appointmentRequests.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAppointmentTooltip(prev => !prev)}
                className="flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 p-1.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30"
                title={t('properties.appointmentRequests', 'Appointment requests')}
              >
                <CalendarCheck className="h-4 w-4 mr-1" />
                <span>{appointmentRequests.length}</span>
              </button>

              {showAppointmentTooltip && (
                <>
                  {/* Backdrop to close dropdown */}
                  <div className="fixed inset-0 z-40" onClick={() => setShowAppointmentTooltip(false)} />
                  <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3 max-h-48 overflow-y-auto">
                    <div className="space-y-1">
                      {appointmentRequests.map((request: any, index: number) => {
                        // Normalize PG DATE/TIME values
                        const dateVal = request.requested_date;
                        const dateStr = dateVal instanceof Date
                          ? dateVal.toISOString().split('T')[0]
                          : typeof dateVal === 'string' ? dateVal.slice(0, 10) : null;
                        const timeStr = typeof request.requested_time === 'string'
                          ? request.requested_time.slice(0, 5) : null;
                        let displayDateTime = t('properties.notAvailable', 'N/A');
                        if (dateStr && timeStr) {
                          try {
                            const dt = fromZonedTime(`${dateStr}T${timeStr}:00`, request.requester_timezone || 'UTC');
                            if (!isNaN(dt.getTime())) {
                              displayDateTime = dt.toLocaleString('en-US', {
                                month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                              });
                            }
                          } catch { /* fallback */ }
                        }

                        const statusColor = request.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
                          request.status === 'approved' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                          request.status === 'declined' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' :
                          'bg-gray-100 dark:bg-gray-800/30 text-gray-800 dark:text-gray-300';

                        return (
                          <button
                            key={request.appointment_request_id}
                            type="button"
                            onClick={() => {
                              setShowAppointmentTooltip(false);
                              openDrawer(
                                <div className="p-6 space-y-4">
                                  <h2 className="text-lg font-semibold">{t('properties.appointmentRequest', 'Appointment Request')}</h2>
                                  <div className="space-y-3">
                                    <div>
                                      <span className="text-sm text-gray-500">{t('properties.service', 'Service')}</span>
                                      <p className="text-sm font-medium">{request.service_name || t('properties.notAvailable', 'N/A')}</p>
                                    </div>
                                    <div>
                                      <span className="text-sm text-gray-500">{t('fields.status', 'Status')}</span>
                                      <p><span className={`text-xs px-2 py-0.5 rounded ${statusColor}`}>{request.status}</span></p>
                                    </div>
                                    <div>
                                      <span className="text-sm text-gray-500">{t('properties.requestedDateTime', 'Requested Date & Time')}</span>
                                      <p className="text-sm font-medium">{displayDateTime}</p>
                                    </div>
                                    <div>
                                      <span className="text-sm text-gray-500">{t('properties.duration', 'Duration')}</span>
                                      <p className="text-sm font-medium">{request.requested_duration} {t('ticketSection.minutes', 'minutes')}</p>
                                    </div>
                                    {request.description && (
                                      <div>
                                        <span className="text-sm text-gray-500">{t('fields.description', 'Description')}</span>
                                        <p className="text-sm">{request.description}</p>
                                      </div>
                                    )}
                                    {request.contact_name && (
                                      <div>
                                        <span className="text-sm text-gray-500">{t('properties.contact', 'Contact')}</span>
                                        <p className="text-sm font-medium">{request.contact_name}</p>
                                      </div>
                                    )}
                                    {request.approved_at && (
                                      <div>
                                        <span className="text-sm text-gray-500">{t('properties.approvedAt', 'Approved At')}</span>
                                        <p className="text-sm font-medium">
                                          {new Date(request.approved_at).toLocaleString('en-US', {
                                            month: 'short', day: 'numeric', year: 'numeric',
                                            hour: '2-digit', minute: '2-digit'
                                          })}
                                        </p>
                                      </div>
                                    )}
                                    {request.decline_reason && (
                                      <div>
                                        <span className="text-sm text-gray-500">{t('properties.declineReason', 'Decline Reason')}</span>
                                        <p className="text-sm text-red-600">{request.decline_reason}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            }}
                            className={`block w-full text-left p-2 rounded hover:bg-gray-50 cursor-pointer ${index > 0 ? 'border-t border-gray-100' : ''}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-gray-900 truncate">
                                {request.service_name || t('properties.appointmentFallback', 'Appointment')}
                              </span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${statusColor}`}>
                                {request.status}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 flex items-center gap-2">
                              <span className="flex items-center">
                                <CalendarIcon className="h-3 w-3 mr-0.5" />
                                {displayDateTime}
                              </span>
                              <span className="flex items-center">
                                <Clock className="h-3 w-3 mr-0.5" />
                                {request.requested_duration}m
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {ticket.assigned_team_id && (
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-100 rounded-full pl-1 pr-2 py-1">
                <TeamAvatar
                  teamId={ticket.assigned_team_id!}
                  teamName={team?.team_name || t('properties.team', 'Team')}
                  avatarUrl={teamAvatarUrl}
                  size="sm"
                />
                <span className="text-sm">{team?.team_name || t('properties.assignedTeamFallback', 'Assigned Team')}</span>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setIsRemoveTeamDialogOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setIsRemoveTeamDialogOpen(true);
                    }
                  }}
                  className="ml-1 p-1 hover:bg-gray-200 rounded-full cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </div>
              </div>
              <span className="text-xs text-gray-500">
                {t('properties.lead', 'Lead')}: {team?.members?.find(m => m.role === 'lead' || m.user_id === team.manager_id)
                  ? `${team.members.find(m => m.role === 'lead' || m.user_id === team.manager_id)!.first_name || ''} ${team.members.find(m => m.role === 'lead' || m.user_id === team.manager_id)!.last_name || ''}`.trim()
                  : t('properties.unknown', 'Unknown')}
              </span>
            </div>
          </div>
        )}
        <div className="space-y-4">
          {/* Primary Agent */}
          <div>
            <h5 className="font-bold mb-2">{t('properties.primaryAgent', 'Primary Agent')}</h5>
            {ticket.assigned_to ? (
              <div
                className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                onClick={() => onAgentClick(ticket.assigned_to!)}
              >
                <UserAvatar
                  {...withDataAutomationId({ id: `${id}-primary-agent-avatar` })}
                  userId={ticket.assigned_to}
                  userName={`${availableAgents.find(a => a.user_id === ticket.assigned_to)?.first_name || ''} ${availableAgents.find(a => a.user_id === ticket.assigned_to)?.last_name || ''}`}
                  avatarUrl={primaryAgentAvatarUrl}
                  size="sm"
                />
                <div className="flex flex-col">
                  <span className="text-sm">
                    {(() => {
                      const assignedAgent = availableAgents.find(a => a.user_id === ticket.assigned_to);
                      if (!assignedAgent) {
                        return t('properties.unknownAgent', 'Unknown Agent');
                      }

                      const fullName = `${assignedAgent.first_name || ''} ${assignedAgent.last_name || ''}`.trim();
                      return fullName || t('properties.unknownAgent', 'Unknown Agent');
                    })()}
                  </span>
                  {getAgentScheduledHours(ticket.assigned_to!) > 0 && (
                    <div className="flex items-center text-xs text-gray-500 mt-1">
                      <Clock className="w-3 h-3 mr-1" />
                      <span>
                        {t('properties.scheduled', 'Scheduled: {{time}}', {
                          time: formatMinutesAsHoursAndMinutes(getAgentScheduledHours(ticket.assigned_to!)),
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">{t('properties.noPrimaryAgentAssigned', 'No primary agent assigned')}</p>
            )}
          </div>

          {/* Team - Commented out for now
          <div>
            <h5 className="font-bold mb-2">Team</h5>
            {team ? (
              <div className="text-sm">
                <p>{team.team_name}</p>
                <p className="text-gray-500">
                  Manager: {team.members.find(m => m.user_id === team.manager_id)?.first_name || 'Unknown Manager'}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No team assigned</p>
            )}
          </div>
          */}

          {/* Additional Agents */}
          <div>
            <h5 className="font-bold mb-2">{t('properties.additionalAgents', 'Additional Agents')}</h5>
            <MultiUserAndTeamPicker
              id={`${id}-additional-agents`}
              values={additionalAgents.filter(a => a.additional_user_id).map(a => a.additional_user_id!)}
              getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
              getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
              teams={teams}
              teamSectionLabel={t('quickAdd.addTeamMembers', 'Add Team Members')}
              onTeamValuesChange={(selectedTeamIds) => {
                // When a team is selected, assign the team — assignTeamToTicket already
                // expands team members into ticket_resources, so we must NOT also call
                // onAddAgent for each member (that would cause duplicate-insert errors).
                for (const teamId of selectedTeamIds) {
                  if (ticket.assigned_team_id && onRemoveTeamAssignment) {
                    // A team is already assigned — show the removal dialog first,
                    // then assign the new team after the user confirms.
                    setPendingSwitchTeamId(teamId);
                    setIsRemoveTeamDialogOpen(true);
                  } else if (onAssignTeam) {
                    onAssignTeam(teamId);
                  }
                }
              }}
              onValuesChange={async (newUserIds) => {
                if (isProcessingAgentsRef.current) {
                  return;
                }
                isProcessingAgentsRef.current = true;

                try {
                  const currentUserIds = additionalAgents
                    .filter(a => a.additional_user_id)
                    .map(a => a.additional_user_id!);

                  const addedUserIds = newUserIds.filter(id => !currentUserIds.includes(id));
                  const removedUserIds = currentUserIds.filter(id => !newUserIds.includes(id));

                  for (const userId of addedUserIds) {
                    await onAddAgent(userId);
                  }

                  for (const userId of removedUserIds) {
                    const agent = additionalAgents.find(a => a.additional_user_id === userId);
                    if (agent?.assignment_id) {
                      await onRemoveAgent(agent.assignment_id);
                    }
                  }
                } finally {
                  isProcessingAgentsRef.current = false;
                }
              }}
              users={availableAgents.filter(agent => agent.user_id !== ticket.assigned_to)}
              size="sm"
              placeholder={t('properties.selectAdditionalAgents', 'Select additional agents...')}
              onUserClick={onAgentClick}
            />
          </div>
        </div>
      </ContentCard>

      <TicketWatchListCard
        id={`${id}-watch-list`}
        attributes={ticket.attributes}
        onUpdateWatchList={onUpdateWatchList}
        watchListSaving={watchListSaving}
        internalUsers={availableAgents}
        clientContacts={contacts}
        allContacts={allContactsForWatchList}
        allContactsLoading={allContactsForWatchListLoading}
        onLoadAllContacts={onLoadAllContactsForWatchList}
        teams={teams}
        getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
        getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
      />


      {ticket.ticket_id && ticket.client_id && (
        <TicketMaterialsCard
          ticketId={ticket.ticket_id}
          clientId={ticket.client_id}
        />
      )}

      {surveySummaryCard}

    </div>
      {ticket.assigned_team_id && (() => {
        const removeTeamFooter = (
          <div className="flex justify-end space-x-2">
            <Button
              id="remove-team-cancel-btn"
              variant="outline"
              onClick={() => {
                setPendingSwitchTeamId(null);
                setIsRemoveTeamDialogOpen(false);
              }}
            >
              {t('actions.cancel', 'Cancel')}
            </Button>
            <Button
              id="remove-team-confirm-btn"
              variant="default"
              onClick={async () => {
                if (onRemoveTeamAssignment) {
                  await onRemoveTeamAssignment(
                    removeTeamMode,
                    removeTeamMode === 'selective' ? selectedTeamMemberIds : undefined
                  );
                }
                // If switching to a new team, assign it after the old one is removed
                if (pendingSwitchTeamId && onAssignTeam) {
                  await onAssignTeam(pendingSwitchTeamId);
                }
                setPendingSwitchTeamId(null);
                setIsRemoveTeamDialogOpen(false);
              }}
            >
              {t('actions.confirm', 'Confirm')}
            </Button>
          </div>
        );
        return (
        <Dialog
          isOpen={isRemoveTeamDialogOpen}
          onClose={() => {
            setPendingSwitchTeamId(null);
            setIsRemoveTeamDialogOpen(false);
          }}
          title={pendingSwitchTeamId
            ? t('properties.switchTeamAssignment', 'Switch team assignment')
            : t('properties.removeTeamAssignment', 'Remove team assignment')}
          id={`${id}-remove-team-dialog`}
          footer={removeTeamFooter}
        >
        <DialogContent className="space-y-4">
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="remove-team-mode"
                value="remove_all"
                checked={removeTeamMode === 'remove_all'}
                onChange={() => setRemoveTeamMode('remove_all')}
              />
              <span>{t('properties.removeTeamMode.removeAll', 'Remove all team members')}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="remove-team-mode"
                value="keep_all"
                checked={removeTeamMode === 'keep_all'}
                onChange={() => setRemoveTeamMode('keep_all')}
              />
              <span>{t('properties.removeTeamMode.keepAll', 'Keep all team members as individual agents')}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="remove-team-mode"
                value="selective"
                checked={removeTeamMode === 'selective'}
                onChange={() => setRemoveTeamMode('selective')}
              />
              <span>{t('properties.removeTeamMode.selective', 'Select individual members to keep/remove')}</span>
            </label>
          </div>
          {removeTeamMode === 'selective' && (
            <div className="space-y-2 border border-gray-100 rounded p-3">
              {teamMembersOnTicket.length === 0 ? (
                <div className="text-sm text-gray-500">{t('properties.noTeamMembersFound', 'No team members found on this ticket.')}</div>
              ) : (
                teamMembersOnTicket.map(member => {
                  const memberId = member.additional_user_id!;
                  const agent = availableAgents.find(a => a.user_id === memberId);
                  const memberName = agent
                    ? `${agent.first_name || ''} ${agent.last_name || ''}`.trim() || t('properties.unnamedUser')
                    : memberId;

                  return (
                    <label key={memberId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`${id}-team-member-${memberId}`}
                      checked={selectedTeamMemberIds.includes(memberId)}
                      onChange={() => {
                        setSelectedTeamMemberIds(prev =>
                          prev.includes(memberId)
                            ? prev.filter(idValue => idValue !== memberId)
                            : [...prev, memberId]
                        );
                      }}
                    />
                    <span>{memberName}</span>
                  </label>
                );
                })
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      );
      })()}
    </>
  );
};

export default TicketProperties;
