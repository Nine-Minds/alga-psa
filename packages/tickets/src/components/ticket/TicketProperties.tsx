'use client';

import React, { useState, useEffect } from 'react';
import { ITicket, ITimeSheet, ITimePeriodView, IClient, IClientLocation } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Clock, Edit2, Play, Pause, StopCircle, X, Building } from 'lucide-react';
import styles from './TicketDetails.module.css';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { getContactAvatarUrlAction } from '@alga-psa/users/actions';
import { utcToLocal, formatDateTime, getUserTimeZone } from '@alga-psa/core';
import { getTicketingDisplaySettings } from '../../actions/ticketDisplaySettings';
import type { SurveyTicketSatisfactionSummary } from '@alga-psa/types';
import TicketMaterialsCard from './TicketMaterialsCard';
import TicketSurveySummaryCard from './TicketSurveySummaryCard';
import { useRegisterUnsavedChanges } from '@alga-psa/ui/context';

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
  renderIntervalManagement?: (args: { ticketId: string; userId: string }) => React.ReactNode;
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
  renderIntervalManagement,
}) => {
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  const [contactFilterState, setContactFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [contactAvatarUrl, setContactAvatarUrl] = useState<string | null>(null);
  const [dateTimeFormat, setDateTimeFormat] = useState<string>('MMM d, yyyy h:mm a');

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

  return (
    <div className="flex-shrink-0 space-y-6">
      <div {...withDataAutomationId({ id: `${id}-time-entry` })} className={`${styles['card']} p-6 space-y-4`}>
        <h2 className={`${styles['panel-header']}`}>
            <Clock className="inline-block w-5 h-5 mr-2" />
            Time Entry
          </h2>
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
          {ticket.ticket_id && userId && renderIntervalManagement && (
            <div className="mt-2 border-t pt-4" {...withDataAutomationId({ id: `${id}-interval-management` })}>
              <h3 className="text-sm font-medium mb-2">Tracked Intervals</h3>
              {renderIntervalManagement({ ticketId: ticket.ticket_id, userId })}
            </div>
          )}

        </div>
      </div>

      <div {...withDataAutomationId({ id: `${id}-contact-info` })} className={`${styles['card']} p-6 space-y-4`}>
        <h2 className={`${styles['panel-header']}`}>
            <Building className="inline-block w-5 h-5 mr-2" />
            Contact Info
          </h2>
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

      {ticket.ticket_id && ticket.client_id && (
        <TicketMaterialsCard
          ticketId={ticket.ticket_id}
          clientId={ticket.client_id}
        />
      )}

      {surveySummary !== undefined && (
        <TicketSurveySummaryCard summary={surveySummary} />
      )}

    </div>
  );
};

export default TicketProperties;
