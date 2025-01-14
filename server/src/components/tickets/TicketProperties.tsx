'use client';

import React, { useState } from 'react';
import { ITicket, ITimeSheet, ITimePeriod, ITimeEntry } from '../../interfaces';
import { IUserWithRoles, ITeam } from '../../interfaces/auth.interfaces';
import { ITicketResource } from '../../interfaces/ticketResource.interfaces';
import { Button } from '../ui/Button';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import { Clock, Edit2, Play, Pause, StopCircle, UserPlus, X } from 'lucide-react';
import styles from './TicketDetails.module.css';
import UserPicker from '../ui/UserPicker';
import AvatarIcon from '../ui/AvatarIcon';
import { TimeEntryDialog } from '../time-management/TimeEntryDialog';
import { CompanyPicker } from '../companies/CompanyPicker';
import CustomSelect from '../ui/CustomSelect';
import { toast } from 'react-hot-toast';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';

interface TicketPropertiesProps {
  id?: string;
  ticket: ITicket;
  company: any;
  contactInfo: any;
  createdByUser: any;
  channel: any;
  elapsedTime: number;
  isRunning: boolean;
  timeDescription: string;
  team: ITeam | null;
  additionalAgents: ITicketResource[];
  availableAgents: IUserWithRoles[];
  currentTimeSheet: ITimeSheet | null;
  currentTimePeriod: ITimePeriod | null;
  userId: string;
  tenant: string;
  contacts: any[];
  companies: any[];
  companyFilterState: 'all' | 'active' | 'inactive';
  clientTypeFilter: 'all' | 'company' | 'individual';
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onTimeDescriptionChange: (value: string) => void;
  onAddTimeEntry: () => void;
  onCompanyClick: () => void;
  onContactClick: () => void;
  onAgentClick: (userId: string) => void;
  onAddAgent: (userId: string) => Promise<void>;
  onRemoveAgent: (assignmentId: string) => Promise<void>;
  onChangeContact: (contactId: string | null) => void;
  onChangeCompany: (companyId: string) => void;
  onCompanyFilterStateChange: (state: 'all' | 'active' | 'inactive') => void;
  onClientTypeFilterChange: (type: 'all' | 'company' | 'individual') => void;
}

const TicketProperties: React.FC<TicketPropertiesProps> = ({
  id = 'ticket-properties',
  ticket,
  company,
  contactInfo,
  createdByUser,
  channel,
  elapsedTime,
  isRunning,
  timeDescription,
  team,
  additionalAgents,
  availableAgents,
  currentTimeSheet,
  currentTimePeriod,
  userId,
  tenant,
  contacts,
  companies,
  companyFilterState,
  clientTypeFilter,
  onStart,
  onPause,
  onStop,
  onTimeDescriptionChange,
  onAddTimeEntry,
  onCompanyClick,
  onContactClick,
  onAgentClick,
  onAddAgent,
  onRemoveAgent,
  onChangeContact,
  onChangeCompany,
  onCompanyFilterStateChange,
  onClientTypeFilterChange,
}) => {
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

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
              <Button {...withDataAutomationId({ id: `${id}-start-timer-btn` })} onClick={onStart} className={`w-24`} variant='soft'>
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
            <span className="mr-2">Add time</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="#D6BBFB">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </Button>
        </div>
      </div>

      <div {...withDataAutomationId({ id: `${id}-contact-info` })} className={`${styles['card']} p-6 space-y-4`}>
        <h2 className={`${styles['panel-header']}`}>Contact Info</h2>
        <div className="space-y-2">
          <div>
            <h5 className="font-bold">Contact</h5>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <p
                    {...withDataAutomationId({ id: `${id}-contact-name` })}
                    className="text-sm text-blue-500 cursor-pointer hover:underline"
                    onClick={onCompanyClick}
                  >
                    {company?.company_name || 'N/A'}
                  </p>
                  <Button
                    {...withDataAutomationId({ id: `${id}-toggle-company-picker-btn` })}
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCompanyPicker(!showCompanyPicker)}
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
                    <CustomSelect
                      {...withDataAutomationId({ id: `${id}-contact-select` })}
                      value={selectedContactId || contactInfo?.contact_name_id || ''}
                      onValueChange={(value) => {
                        setSelectedContactId(value);
                      }}
                      options={contacts.map((contact): { value: string; label: string } => ({
                        value: contact.contact_name_id,
                        label: contact.full_name
                      }))}
                      placeholder="Select Contact"
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
            <h5 className="font-bold">Client</h5>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <p
                  className="text-sm text-blue-500 cursor-pointer hover:underline"
                  onClick={onCompanyClick}
                >
                  {company?.company_name || 'N/A'}
                </p>                  
                <Button
                  {...withDataAutomationId({ id: `${id}-edit-company-btn` })}
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAgentPicker(!showAgentPicker)}
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
              {showCompanyPicker && (
                <div className="space-y-2">
                  <div className="flex items-center group relative">
                    <div className="w-full">
                      <CompanyPicker
                        {...withDataAutomationId({ id: `${id}-company-picker` })}
                        companies={companies}
                        onSelect={setSelectedCompanyId}
                        selectedCompanyId={selectedCompanyId || company?.company_id || ''}
                        filterState={companyFilterState}
                        onFilterStateChange={onCompanyFilterStateChange}
                        clientTypeFilter={clientTypeFilter}
                        onClientTypeFilterChange={onClientTypeFilterChange}
                        fitContent={false}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button
                      {...withDataAutomationId({ id: `${id}-cancel-company-picker-btn` })}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowCompanyPicker(false);
                        setSelectedCompanyId(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      {...withDataAutomationId({ id: `${id}-save-company-picker-btn` })}
                      variant="default"
                      size="sm"
                      onClick={() => {
                        if (selectedCompanyId) {
                          onChangeCompany(selectedCompanyId);
                        }
                        setShowCompanyPicker(false);
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
            <h5 className="font-bold">{contactInfo ? 'Contact Phone' : 'Company Phone'}</h5>
            <p className="text-sm">
              {contactInfo?.phone_number || company?.phone_no || 'N/A'}
            </p>
          </div>
          <div>
            <h5 className="font-bold">{contactInfo ? 'Contact Email' : 'Company Email'}</h5>
            <p className="text-sm">
              {contactInfo?.email || company?.email || 'N/A'}
            </p>
          </div>
        </div>
      </div>

      <div className={`${styles['card']} p-6 space-y-4`}>
        <h2 className={`${styles['panel-header']}`}>Agent team</h2>
        <div className="space-y-4">
          {/* Primary Agent */}
          <div>
            <h5 className="font-bold mb-2">Primary Agent</h5>
            {ticket.assigned_to ? (
              <div
                className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                onClick={() => onAgentClick(ticket.assigned_to!)}
              >
                <AvatarIcon
                  {...withDataAutomationId({ id: `${id}-primary-agent-avatar` })}
                  userId={ticket.assigned_to}
                  firstName={availableAgents.find(a => a.user_id === ticket.assigned_to)?.first_name || ''}
                  lastName={availableAgents.find(a => a.user_id === ticket.assigned_to)?.last_name || ''}
                  size="sm"
                />
                <span className="text-sm">
                  {availableAgents.find(a => a.user_id === ticket.assigned_to)?.first_name || 'Unknown'}{' '}
                  {availableAgents.find(a => a.user_id === ticket.assigned_to)?.last_name || 'Agent'}
                </span>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No primary agent assigned</p>
            )}
          </div>

          {/* Team */}
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
                    agent => !additionalAgents.some(a => a.additional_user_id === agent.user_id)
                  )}
                />
              </div>
            )}

            <div className="space-y-2">
              {additionalAgents.map((agent): JSX.Element => {
                const agentUser = availableAgents.find(u => u.user_id === agent.additional_user_id);
                return (
                  <div
                    key={agent.assignment_id}
                    className="flex items-center justify-between group hover:bg-gray-50 p-2 rounded"
                  >
                    <div
                      key={agent.assignment_id}
                      className="flex items-center justify-between group hover:bg-gray-50 p-2 rounded"
                    >
                      <AvatarIcon
                        userId={agent.additional_user_id!}
                        firstName={agentUser?.first_name || ''}
                        lastName={agentUser?.last_name || ''}
                        size="sm"
                      />
                      <span className="text-sm">
                        {agentUser?.first_name || 'Unknown'} {agentUser?.last_name || 'Agent'}
                      </span>

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
