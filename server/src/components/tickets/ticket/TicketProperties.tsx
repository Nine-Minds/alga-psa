'use client';

import React, { useState, useEffect } from 'react';
import { getScheduledHoursForTicket } from 'server/src/lib/actions/ticket-actions/ticketActions';
import { ITicket, ITimeSheet, ITimePeriod, ITimePeriodView, ITimeEntry, IAgentSchedule, IClient, IClientLocation } from 'server/src/interfaces'; // Added IClient and IClientLocation
import { IUserWithRoles, ITeam } from 'server/src/interfaces/auth.interfaces';
import { ITicketResource } from 'server/src/interfaces/ticketResource.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { TagManager } from 'server/src/components/tags';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Clock, Edit2, Play, Pause, StopCircle, UserPlus, X, AlertCircle, Calendar as CalendarIcon } from 'lucide-react';
import { formatMinutesAsHoursAndMinutes } from 'server/src/lib/utils/dateTimeUtils';
import styles from './TicketDetails.module.css';
import UserPicker from 'server/src/components/ui/UserPicker';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { ContactPicker } from 'server/src/components/ui/ContactPicker';
import { toast } from 'react-hot-toast';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { IntervalManagement } from 'server/src/components/time-management/interval-tracking/IntervalManagement';
import ClientAvatar from 'server/src/components/ui/ClientAvatar';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import { getUserAvatarUrlAction, getContactAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { getUserContactId } from 'server/src/lib/actions/user-actions/userActions';
import { utcToLocal, formatDateTime, getUserTimeZone } from 'server/src/lib/utils/dateTimeUtils';
import { getTicketingDisplaySettings } from 'server/src/lib/actions/ticket-actions/ticketDisplaySettings';
import TicketSurveySummaryCard from 'server/src/components/surveys/TicketSurveySummaryCard';
import type { SurveyTicketSatisfactionSummary } from 'server/src/interfaces/survey.interface';
import { getAppointmentRequestsByTicketId } from 'server/src/lib/actions/appointmentRequestManagementActions';

interface TicketPropertiesProps {
  id?: string;
  ticket: ITicket;
  client: any;
  contactInfo: any;
  createdByUser: any;
  board: any;
  elapsedTime: number;
  isRunning: boolean;
  isTimerLocked?: boolean;
  timeDescription: string;
  team: ITeam | null;
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
  surveySummary?: SurveyTicketSatisfactionSummary | null;
}

// Helper function to format location display
const formatLocationDisplay = (location: IClientLocation): string => {
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
  
  return parts.join(' - ') || 'Unnamed Location';
};

const TicketProperties: React.FC<TicketPropertiesProps> = ({
  id = 'ticket-properties',
  ticket,
  client,
  contactInfo,
  createdByUser,
  board,
  elapsedTime,
  isRunning,
  isTimerLocked = false,
  timeDescription,
  team,
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
  surveySummary = null,
}) => {
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [contactFilterState, setContactFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [agentSchedules, setAgentSchedules] = useState<IAgentSchedule[]>([]);
  const [primaryAgentAvatarUrl, setPrimaryAgentAvatarUrl] = useState<string | null>(null);
  const [additionalAgentAvatarUrls, setAdditionalAgentAvatarUrls] = useState<Record<string, string | null>>({});
  const [contactAvatarUrl, setContactAvatarUrl] = useState<string | null>(null);
  const [dateTimeFormat, setDateTimeFormat] = useState<string>('MMM d, yyyy h:mm a');
  const [appointmentRequestsCount, setAppointmentRequestsCount] = useState<number>(0);
  const [appointmentRequests, setAppointmentRequests] = useState<any[]>([]);
  const [showAppointmentTooltip, setShowAppointmentTooltip] = useState(false);

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

  // Fetch appointment requests
  useEffect(() => {
    const fetchAppointmentRequests = async () => {
      if (!ticket.ticket_id) return;

      try {
        const result = await getAppointmentRequestsByTicketId(ticket.ticket_id);
        if (result.success && result.data) {
          setAppointmentRequests(result.data);
          setAppointmentRequestsCount(result.data.length);
        }
      } catch (error) {
        console.error('Error fetching appointment requests:', error);
      }
    };

    fetchAppointmentRequests();
  }, [ticket.ticket_id]);

  return (
    <div className="flex-shrink-0 space-y-6">
      <div {...withDataAutomationId({ id: `${id}-time-entry` })} className={`${styles['card']} p-6 space-y-4`}>
        <h2 className={`${styles['panel-header']}`}>Time Entry</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span>Ticket Timer - #{ticket.ticket_number}</span>
            <Clock className="h-6 w-6" />
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
                title={isTimerLocked ? 'Timer active in another window' : undefined}
              >
                <Play className="mr-2 h-4 w-4" /> Start
              </Button>
            ) : (
              <Button {...withDataAutomationId({ id: `${id}-pause-timer-btn` })} onClick={onPause} className={`w-24`} variant='soft'>
                <Pause className="mr-2 h-4 w-4" /> Pause
              </Button>
            )}
            <Button {...withDataAutomationId({ id: `${id}-stop-timer-btn` })} onClick={onStop} className={`w-24`} variant='soft'>
              <StopCircle className="mr-2 h-4 w-4" /> Reset
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              {...withDataAutomationId({ id: `${id}-description-input` })}
              id="description"
              value={timeDescription}
              onChange={(e) => onTimeDescriptionChange(e.target.value)}
              placeholder="Enter work description"
              className={styles['custom-input']}
            />
          </div>
          <Button
            {...withDataAutomationId({ id: `${id}-add-time-entry-btn` })}
            type="button"
            className={`w-full mt-4 flex items-center justify-center`}
            onClick={onAddTimeEntry}
          >
            <span className="mr-2">Add Time Entry</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="#D6BBFB">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </Button>
          
          {/* Interval Management Section */}
          <div className="mt-6 border-t pt-4">
            <h3 className="text-sm font-medium mb-2">Tracked Intervals</h3>
            {ticket.ticket_id && userId && (
              <div {...withDataAutomationId({ id: `${id}-interval-management` })}>
                <IntervalManagement
                  ticketId={ticket.ticket_id}
                  userId={userId}
                  onCreateTimeEntry={onAddTimeEntry}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Customer Feedback Survey Summary */}
      <TicketSurveySummaryCard summary={surveySummary} />

      <div {...withDataAutomationId({ id: `${id}-contact-info` })} className={`${styles['card']} p-6 space-y-4`}>
        <h2 className={`${styles['panel-header']}`}>Contact Info</h2>
        <div className="space-y-2">
          <div>
            <h5 className="font-bold">Contact</h5>
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
                    {contactInfo?.full_name || 'No contact selected'}
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
                      contacts={contacts}
                      value={selectedContactId ?? contactInfo?.contact_name_id ?? ''}
                      onValueChange={setSelectedContactId}
                      clientId={client?.client_id}
                      placeholder="Select or change contact"
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
                      Cancel
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
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div>
            <h5 className="font-bold">Created By</h5>
            <p className="text-sm">
              {createdByUser ? `${createdByUser.first_name} ${createdByUser.last_name}` : 'N/A'}
            </p>
          </div>
          <div>
            <h5 className="font-bold">Created</h5>
            <p className="text-sm">
              {(() => {
                if (!ticket.entered_at) return 'N/A';
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
            <h5 className="font-bold">Client</h5>
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
                  {client?.client_name || 'N/A'}
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
                      Cancel
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
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {client && locations.length > 0 && (
            <div>
              <h5 className="font-bold">Location</h5>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <p className="text-sm">
                    {(() => {
                      // If ticket has a location, show it
                      if (ticket.location) {
                        return formatLocationDisplay(ticket.location);
                      }
                      // Otherwise, show the default location if one exists
                      const defaultLocation = locations.find(l => l.is_default);
                      if (defaultLocation) {
                        return `${formatLocationDisplay(defaultLocation)} (Default)`;
                      }
                      // Otherwise show no location
                      return 'No location specified';
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
                        { value: 'none', label: 'No specific location' },
                        ...locations.map((location) => ({
                          value: location.location_id,
                          label: formatLocationDisplay(location) + (location.is_default ? ' (Default)' : '')
                        }))
                      ]}
                      placeholder="Select location"
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
                        Cancel
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
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div>
            <h5 className="font-bold">{contactInfo ? 'Contact Phone' : 'Client Phone'}</h5>
            <p className="text-sm">
              {contactInfo?.phone_number || client?.phone_no || 'N/A'}
            </p>
          </div>
          <div>
            <h5 className="font-bold">{contactInfo ? 'Contact Email' : 'Client Email'}</h5>
            <p className="text-sm">
              {contactInfo?.email || client?.email || 'N/A'}
            </p>
          </div>
        </div>
      </div>

      <div className={`${styles['card']} p-6 space-y-4`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`${styles['panel-header']}`}>Agent team</h2>
          {/* Appointment Requests Indicator */}
          {appointmentRequestsCount > 0 && (
            <div
              className="relative"
              onMouseEnter={() => setShowAppointmentTooltip(true)}
              onMouseLeave={() => setShowAppointmentTooltip(false)}
            >
              <a
                href="/msp/schedule"
                className="flex items-center text-sm text-blue-600 hover:text-blue-800 p-2 rounded hover:bg-blue-50"
                target="_blank"
                rel="noopener noreferrer"
                title="View appointment requests on calendar"
              >
                <CalendarIcon className="h-4 w-4 mr-1" />
                <span>{appointmentRequestsCount} Appointment Request{appointmentRequestsCount !== 1 ? 's' : ''}</span>
              </a>

              {/* Tooltip */}
              {showAppointmentTooltip && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4">
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {appointmentRequests.map((request, index) => (
                      <div key={request.appointment_request_id} className="border-b border-gray-100 pb-3 last:border-0">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-700">
                            Request #{index + 1}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            request.status === 'approved' ? 'bg-green-100 text-green-800' :
                            request.status === 'declined' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {request.status}
                          </span>
                        </div>
                        <div className="space-y-1 text-xs text-gray-600">
                          <div className="flex items-center">
                            <CalendarIcon className="h-3 w-3 mr-1" />
                            <span>{new Date(request.requested_date).toLocaleDateString()}</span>
                            <span className="mx-1">at</span>
                            <span>{request.requested_time}</span>
                          </div>
                          {request.service_name && (
                            <div className="flex items-center">
                              <span className="font-medium">Service:</span>
                              <span className="ml-1">{request.service_name}</span>
                            </div>
                          )}
                          {request.preferred_technician_first_name && (
                            <div className="flex items-center">
                              <span className="font-medium">Technician:</span>
                              <span className="ml-1">
                                {request.preferred_technician_first_name} {request.preferred_technician_last_name}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center">
                            <Clock className="h-3 w-3 mr-1" />
                            <span>{request.requested_duration} minutes</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-500 text-center">
                      Click to view on calendar
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="space-y-4">
          {/* Primary Agent */}
          <div>
            <h5 className="font-bold mb-2">Primary Agent</h5>
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
                    {availableAgents.find(a => a.user_id === ticket.assigned_to)?.first_name || 'Unknown'}{' '}
                    {availableAgents.find(a => a.user_id === ticket.assigned_to)?.last_name || 'Agent'}
                  </span>
                  <div className="flex items-center text-xs text-gray-500 mt-1">
                    <Clock className="w-3 h-3 mr-1" />
                    <span>Scheduled: {formatMinutesAsHoursAndMinutes(getAgentScheduledHours(ticket.assigned_to!))}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No primary agent assigned</p>
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
            <div className="flex items-center justify-between mb-2">
              <h5 className="font-bold">Additional Agents</h5>
              <Button
                id={`${id}-toggle-agent-picker-btn`}
                variant="ghost"
                size="sm"
                onClick={() => setShowAgentPicker(!showAgentPicker)}
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>

            {showAgentPicker && (
              <div className="mb-4">
                <UserPicker
                  {...withDataAutomationId({ id: `${id}-agent-picker` })}
                  label="Add Agent"
                  value=""
                  onValueChange={(userId) => {
                    onAddAgent(userId);
                    setShowAgentPicker(false);
                  }}
                  users={availableAgents.filter(
                    agent =>
                      agent.user_id !== ticket.assigned_to &&
                      !additionalAgents.some(a => a.additional_user_id === agent.user_id)
                  )}
                />
              </div>
            )}

            <div className="space-y-2">
              {additionalAgents.map((agent): React.JSX.Element => {
                const agentUser = availableAgents.find(u => u.user_id === agent.additional_user_id);
                return (
                  <div
                    key={agent.assignment_id}
                    className="flex items-center justify-between group hover:bg-gray-50 p-2 rounded"
                  >
                    <div
                      className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                      onClick={() => agent.additional_user_id && onAgentClick(agent.additional_user_id)}
                    >
                      <UserAvatar
                        userId={agent.additional_user_id!}
                        userName={`${agentUser?.first_name || ''} ${agentUser?.last_name || ''}`}
                        avatarUrl={additionalAgentAvatarUrls[agent.additional_user_id!] || null}
                        size="sm"
                      />
                      <div className="flex flex-col">
                        <span className="text-sm">
                          {agentUser?.first_name || 'Unknown'} {agentUser?.last_name || 'Agent'}
                        </span>
                        <div className="flex items-center text-xs text-gray-500 mt-1">
                          <Clock className="w-3 h-3 mr-1" />
                          <span>Scheduled: {formatMinutesAsHoursAndMinutes(getAgentScheduledHours(agent.additional_user_id!))}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      {...withDataAutomationId({ id: `${id}-remove-agent-${agent.assignment_id}-btn` })}
                      variant="ghost"
                      size="sm"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() => onRemoveAgent(agent.assignment_id!)}
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
              {additionalAgents.length === 0 && (
                <p className="text-sm text-gray-500">No additional agents assigned</p>
              )}
            </div>
          </div>
        </div>
      </div>


    </div>
  );
};

export default TicketProperties;
