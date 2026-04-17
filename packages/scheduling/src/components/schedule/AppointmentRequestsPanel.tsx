'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Drawer from '@alga-psa/ui/components/Drawer';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { fromZonedTime } from 'date-fns-tz';
import { Check, X, Calendar, Clock, User, FileText, Briefcase, Ticket } from 'lucide-react';
import { getAllUsersBasic, getCurrentUser, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { IUser } from '@shared/interfaces/user.interfaces';
import {
  getAppointmentRequests,
  approveAppointmentRequest as approveRequest,
  declineAppointmentRequest as declineRequest,
  IAppointmentRequest
} from '@alga-psa/scheduling/actions';
import { getSchedulingTicketById, type SchedulingTicketDetailsRecord } from '../../actions/ticketLookupActions';
import { SchedulingTicketDetails } from '../shared/SchedulingTicketDetails';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface AppointmentRequestsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestProcessed?: () => void;
  highlightedRequestId?: string | null;
}

export default function AppointmentRequestsPanel({
  isOpen,
  onClose,
  onRequestProcessed,
  highlightedRequestId
}: AppointmentRequestsPanelProps) {
  const { t } = useTranslation('msp/schedule');
  const { formatDate } = useFormatters();
  const [requests, setRequests] = useState<IAppointmentRequest[]>([]);
  const [filteredRequests, setFilteredRequests] = useState<IAppointmentRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<IAppointmentRequest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('pending');

  // Approval form state
  const [assignedTechnicianId, setAssignedTechnicianId] = useState<string>('');
  const [finalDateTime, setFinalDateTime] = useState<Date | null>(null);
  const [internalNotes, setInternalNotes] = useState('');
  const [linkedTicketId, setLinkedTicketId] = useState('');

  // Decline form state
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineForm, setShowDeclineForm] = useState(false);

  // Ticket drawer state
  const [selectedTicket, setSelectedTicket] = useState<SchedulingTicketDetailsRecord | null>(null);
  const [isTicketDrawerOpen, setIsTicketDrawerOpen] = useState(false);

  // Users for technician assignment
  const [technicians, setTechnicians] = useState<IUser[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadRequests();
      loadTechnicians();
    }
  }, [isOpen]);

  useEffect(() => {
    filterRequests();
  }, [requests, statusFilter]);

  const loadRequests = async () => {
    setIsLoading(true);
    try {
      const result = await getAppointmentRequests();
      if (result.success && result.data) {
        setRequests(result.data);
      } else {
        toast.error(result.error || t('requests.errors.load', {
          defaultValue: 'Failed to load appointment requests',
        }));
      }
    } catch (error) {
      handleError(error, t('requests.errors.load', {
        defaultValue: 'Failed to load appointment requests',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const loadTechnicians = async () => {
    try {
      const users = await getAllUsersBasic(false, 'internal');
      setTechnicians(users);
    } catch (error) {
      console.error('Failed to load technicians:', error);
      // If user doesn't have permission to load all users,
      // they can still approve requests but only assign to themselves
      const currentUser = await getCurrentUser();
      if (currentUser) {
        setTechnicians([{
          user_id: currentUser.user_id,
          username: currentUser.email.split('@')[0], // Use email prefix as username
          first_name: currentUser.first_name,
          last_name: currentUser.last_name,
          email: currentUser.email,
          is_inactive: false,
          user_type: currentUser.user_type,
          tenant: currentUser.tenant,
          hashed_password: '',
          created_at: currentUser.created_at || new Date(),
          updated_at: new Date()
        }]);
      }
    }
  };

  const filterRequests = () => {
    if (statusFilter === 'all') {
      setFilteredRequests(requests);
    } else {
      setFilteredRequests(requests.filter(r => r.status === statusFilter));
    }
  };

  const handleSelectRequest = (request: IAppointmentRequest) => {
    setSelectedRequest(request);
    setShowDeclineForm(false);
    setAssignedTechnicianId(request.preferred_assigned_user_id || '');

    // Handle date/time parsing safely - prefill with requested date/time.
    // requested_date/requested_time are the user's LOCAL wall-clock (in request.requester_timezone).
    // Convert to a real UTC instant so the DateTimePicker renders the correct moment
    // in the admin's browser timezone.
    try {
      if (request.requested_date && request.requested_time) {
        const rawDate = request.requested_date as unknown;
        const dateStr = rawDate instanceof Date
          ? rawDate.toISOString().split('T')[0]
          : typeof rawDate === 'string' ? rawDate.slice(0, 10) : null;

        const timeStr = typeof request.requested_time === 'string'
          ? request.requested_time.slice(0, 5)
          : null;

        if (dateStr && timeStr) {
          const tz = request.requester_timezone || 'UTC';
          // fromZonedTime interprets the naive local datetime string as being in `tz`
          // and returns a Date whose UTC equals that instant.
          const parsedDate = fromZonedTime(`${dateStr}T${timeStr}:00`, tz);
          if (!isNaN(parsedDate.getTime())) {
            setFinalDateTime(parsedDate);
          } else {
            setFinalDateTime(null);
          }
        } else {
          setFinalDateTime(null);
        }
      } else {
        setFinalDateTime(null);
      }
    } catch (error) {
      console.error('Error parsing date/time:', error);
      setFinalDateTime(null);
    }

    setInternalNotes('');
    setLinkedTicketId(request.ticket_id || '');
    setDeclineReason('');
  };

  // Auto-select highlighted request when requests are loaded
  useEffect(() => {
    if (highlightedRequestId && requests.length > 0 && !selectedRequest) {
      const requestToHighlight = requests.find(r => r.appointment_request_id === highlightedRequestId);
      if (requestToHighlight) {
        // Set status filter to show the request (switch to 'all' or the request's status)
        if (requestToHighlight.status !== statusFilter && statusFilter !== 'all') {
          setStatusFilter('all');
        }
        // Use handleSelectRequest to properly initialize all form state
        handleSelectRequest(requestToHighlight);
      }
    }
  }, [highlightedRequestId, requests, selectedRequest, statusFilter]);

  const handleOpenTicket = async (ticketId: string) => {
    try {
      const ticketData = await getSchedulingTicketById(ticketId);
      if (ticketData) {
        setSelectedTicket(ticketData);
        setIsTicketDrawerOpen(true);
      } else {
        toast.error(t('requests.errors.ticketNotFound', {
          defaultValue: 'Ticket not found',
        }));
      }
    } catch (error) {
      handleError(error, t('requests.errors.loadTicket', {
        defaultValue: 'Failed to load ticket',
      }));
    }
  };

  const handleApprove = async () => {
    if (!selectedRequest) return;

    if (!assignedTechnicianId) {
      toast.error(t('requests.errors.assignTechnicianRequired', {
        defaultValue: 'Please assign a technician',
      }));
      return;
    }

    try {
      // Use finalDateTime if set, otherwise fall back to original requested date/time
      let approvalDate: string | undefined;
      let approvalTime: string | undefined;

      if (finalDateTime && !isNaN(finalDateTime.getTime())) {
        // Convert Date object to proper string formats in UTC
        approvalDate = finalDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
        const hours = finalDateTime.getUTCHours().toString().padStart(2, '0');
        const minutes = finalDateTime.getUTCMinutes().toString().padStart(2, '0');
        approvalTime = `${hours}:${minutes}`; // HH:MM in UTC
      }
      // If finalDateTime is not set, send undefined to use the requested date/time from server

      const result = await approveRequest({
        appointment_request_id: selectedRequest.appointment_request_id,
        assigned_user_id: assignedTechnicianId,
        final_date: approvalDate,
        final_time: approvalTime,
        ticket_id: linkedTicketId || undefined
      });

      if (result.success) {
        toast.success(t('requests.feedback.approved', {
          defaultValue: 'Appointment request approved',
        }));
        setSelectedRequest(null);
        loadRequests();
        onRequestProcessed?.();
      } else {
        toast.error(result.error || t('requests.errors.approve', {
          defaultValue: 'Failed to approve request',
        }));
      }
    } catch (error) {
      handleError(error, t('requests.errors.approve', {
        defaultValue: 'Failed to approve request',
      }));
    }
  };

  const handleDecline = async () => {
    if (!selectedRequest) return;

    if (!declineReason.trim()) {
      toast.error(t('requests.errors.declineReasonRequired', {
        defaultValue: 'Please provide a reason for declining',
      }));
      return;
    }

    try {
      const result = await declineRequest({
        appointment_request_id: selectedRequest.appointment_request_id,
        decline_reason: declineReason
      });

      if (result.success) {
        toast.success(t('requests.feedback.declined', {
          defaultValue: 'Appointment request declined',
        }));
        setSelectedRequest(null);
        setShowDeclineForm(false);
        loadRequests();
        onRequestProcessed?.();
      } else {
        toast.error(result.error || t('requests.errors.decline', {
          defaultValue: 'Failed to decline request',
        }));
      }
    } catch (error) {
      handleError(error, t('requests.errors.decline', {
        defaultValue: 'Failed to decline request',
      }));
    }
  };

  const technicianOptions: SelectOption[] = useMemo(() =>
    technicians.map(tech => ({
      value: tech.user_id,
      label: `${tech.first_name} ${tech.last_name}`
    })),
    [technicians]
  );

  const statusOptions: SelectOption[] = [
    { value: 'all', label: t('requests.filters.statusOptions.all', { defaultValue: 'All' }) },
    { value: 'pending', label: t('requests.filters.statusOptions.pending', { defaultValue: 'Pending' }) },
    { value: 'approved', label: t('requests.filters.statusOptions.approved', { defaultValue: 'Approved' }) },
    { value: 'declined', label: t('requests.filters.statusOptions.declined', { defaultValue: 'Declined' }) },
    { value: 'cancelled', label: t('requests.filters.statusOptions.cancelled', { defaultValue: 'Cancelled' }) }
  ];

  const getStatusBadgeVariant = (status: string): 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' => {
    switch (status) {
      case 'pending': return 'warning';
      case 'approved': return 'success';
      case 'declined': return 'error';
      case 'cancelled': return 'secondary';
      default: return 'default';
    }
  };

  const formatDateTime = (date: unknown, time: unknown, tz?: string | null) => {
    try {
      if (!date || !time) {
        return t('requests.fallbacks.invalidDateTime', { defaultValue: 'Invalid date/time' });
      }
      // Normalize PG DATE (may be JS Date object) to YYYY-MM-DD string
      const dateStr = date instanceof Date
        ? date.toISOString().split('T')[0]
        : typeof date === 'string' ? date.slice(0, 10) : null;
      // Normalize PG TIME to HH:MM string
      const timeStr = typeof time === 'string' ? time.slice(0, 5) : null;

      if (!dateStr || !timeStr) return t('requests.fallbacks.invalidDateTime', { defaultValue: 'Invalid date/time' });

      // Treat requested_date/requested_time as naive local in requester_timezone.
      // Fallback 'UTC' keeps legacy rows (stored without tz) rendering as before.
      const dateTime = fromZonedTime(`${dateStr}T${timeStr}:00`, tz || 'UTC');
      if (isNaN(dateTime.getTime())) {
        return `${dateStr} ${timeStr}`;
      }
      return formatDate(dateTime, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return t('requests.fallbacks.invalidDateTime', { defaultValue: 'Invalid date/time' });
    }
  };

  return (
    <>
      <Drawer isOpen={isOpen} onClose={onClose} id="appointment-requests-panel">
      <div className="h-full flex flex-col max-w-2xl">
        {!selectedRequest ? (
          <>
            {/* List View */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">{t('requests.list.title', { defaultValue: 'Appointment Requests' })}</h2>
              <Badge variant="primary">
                {filteredRequests.length}{' '}
                {statusFilter === 'all'
                  ? t('requests.list.badgeTotal', { defaultValue: 'Total' })
                  : t(`requests.filters.statusOptions.${statusFilter}`, {
                      defaultValue: statusFilter,
                    })}
              </Badge>
            </div>

            {/* Filters */}
            <div className="mb-4">
              <CustomSelect
                id="status-filter"
                options={statusOptions}
                value={statusFilter}
                onValueChange={setStatusFilter}
                label={t('requests.filters.statusLabel', { defaultValue: 'Filter by Status' })}
              />
            </div>

            {/* Request List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {isLoading ? (
                <div className="text-center py-8 text-gray-500">{t('requests.list.loading', { defaultValue: 'Loading requests...' })}</div>
              ) : filteredRequests.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {t('requests.list.empty', {
                    defaultValue: 'No {{status}} requests found',
                    status: statusFilter !== 'all'
                      ? t(`requests.filters.statusOptions.${statusFilter}`, { defaultValue: statusFilter })
                      : '',
                  }).replace(/\s+/g, ' ').trim()}
                </div>
              ) : (
                filteredRequests.map(request => (
                  <Card
                    key={request.appointment_request_id}
                    className="cursor-pointer transition-all hover:shadow-md"
                    onClick={() => handleSelectRequest(request)}
                  >
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <div className="font-semibold text-lg">
                            {request.is_authenticated
                              ? (request as any).client_company_name
                              : request.company_name || t('requests.list.fallbacks.publicRequest', {
                                  defaultValue: 'Public Request',
                                })}
                          </div>
                          {(request as any).contact_name && (
                            <div className="text-sm text-gray-600">{(request as any).contact_name}</div>
                          )}
                        </div>
                        <Badge variant={getStatusBadgeVariant(request.status)}>
                          {request.status}
                        </Badge>
                      </div>

                      <div className="space-y-1 text-sm">
                        <div className="flex items-center text-gray-600">
                          <Briefcase className="h-4 w-4 mr-2" />
                          {(request as any).service_name}
                        </div>
                        <div className="flex items-center text-gray-600">
                          <Calendar className="h-4 w-4 mr-2" />
                          {formatDateTime(request.requested_date, request.requested_time, request.requester_timezone)}
                        </div>
                        <div className="flex items-center text-gray-600">
                          <Clock className="h-4 w-4 mr-2" />
                          {t('requests.list.duration', {
                            defaultValue: '{{count}} minutes',
                            count: request.requested_duration,
                          })}
                        </div>
                        {request.ticket_id && (
                          <div className="flex items-center text-blue-600">
                            <Ticket className="h-4 w-4 mr-2" />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenTicket(request.ticket_id!);
                              }}
                              className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                            >
                              {(request as any).ticket_title || t('requests.list.ticketFallback', {
                                defaultValue: 'Ticket #{{ticket}}',
                                ticket: (request as any).ticket_number || request.ticket_id.slice(0, 8),
                              })}
                            </button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {/* Detail View */}
            <div className="mb-4">
              <Button
                id="back-to-list"
                variant="ghost"
                onClick={() => setSelectedRequest(null)}
                className="mb-2"
              >
                {t('requests.detail.back', { defaultValue: '← Back to List' })}
              </Button>
              <h2 className="text-2xl font-bold">{t('requests.detail.title', { defaultValue: 'Request Details' })}</h2>
            </div>

            <div className="flex-1 overflow-y-auto">
              <Card>
            <CardHeader>
              <CardTitle>{t('requests.detail.section.requestInformation', { defaultValue: 'Request Information' })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Request Information */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="font-semibold text-gray-700">{t('requests.detail.labels.reference', { defaultValue: 'Reference' })}</div>
                  <div className="font-mono">{selectedRequest.appointment_request_id.slice(0, 8).toUpperCase()}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">{t('requests.detail.labels.client', { defaultValue: 'Client' })}</div>
                  <div>{selectedRequest.is_authenticated ? (selectedRequest as any).client_company_name : selectedRequest.company_name}</div>
                </div>
                {(selectedRequest as any).contact_name && (
                  <div>
                    <div className="font-semibold text-gray-700">{t('requests.detail.labels.contact', { defaultValue: 'Contact' })}</div>
                    <div>{(selectedRequest as any).contact_name}</div>
                  </div>
                )}
                {(selectedRequest as any).contact_email && (
                  <div>
                    <div className="font-semibold text-gray-700">{t('requests.detail.labels.email', { defaultValue: 'Email' })}</div>
                    <div>{(selectedRequest as any).contact_email}</div>
                  </div>
                )}
                {selectedRequest.requester_email && !selectedRequest.is_authenticated && (
                  <div>
                    <div className="font-semibold text-gray-700">{t('requests.detail.labels.email', { defaultValue: 'Email' })}</div>
                    <div>{selectedRequest.requester_email}</div>
                  </div>
                )}
                {selectedRequest.requester_phone && (
                  <div>
                    <div className="font-semibold text-gray-700">{t('requests.detail.labels.phone', { defaultValue: 'Phone' })}</div>
                    <div>{selectedRequest.requester_phone}</div>
                  </div>
                )}
                <div>
                  <div className="font-semibold text-gray-700">{t('requests.detail.labels.service', { defaultValue: 'Service' })}</div>
                  <div>{(selectedRequest as any).service_name}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">{t('requests.detail.labels.requestedTime', { defaultValue: 'Requested Time' })}</div>
                  <div>{formatDateTime(selectedRequest.requested_date, selectedRequest.requested_time, selectedRequest.requester_timezone)}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">{t('requests.detail.labels.duration', { defaultValue: 'Duration' })}</div>
                  <div>{t('requests.list.duration', { defaultValue: '{{count}} minutes', count: selectedRequest.requested_duration })}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">{t('requests.detail.labels.status', { defaultValue: 'Status' })}</div>
                  <Badge variant={getStatusBadgeVariant(selectedRequest.status)}>
                    {t(`requests.filters.statusOptions.${selectedRequest.status}`, { defaultValue: selectedRequest.status })}
                  </Badge>
                </div>
                {selectedRequest.ticket_id && (
                  <div className="col-span-2">
                    <div className="font-semibold text-gray-700 mb-1">{t('requests.detail.labels.linkedTicket', { defaultValue: 'Linked Ticket' })}</div>
                    <div className="flex items-center">
                      <Ticket className="h-4 w-4 mr-2 text-blue-600" />
                      <button
                        onClick={() => handleOpenTicket(selectedRequest.ticket_id!)}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                      >
                        {(selectedRequest as any).ticket_title || t('requests.list.ticketFallback', {
                          defaultValue: 'Ticket #{{ticket}}',
                          ticket: (selectedRequest as any).ticket_number || selectedRequest.ticket_id.slice(0, 8),
                        })}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {selectedRequest.description && (
                <div>
                  <div className="font-semibold text-gray-700 mb-1">{t('requests.detail.labels.description', { defaultValue: 'Description' })}</div>
                  <div className="text-sm bg-gray-50 p-3 rounded border">{selectedRequest.description}</div>
                </div>
              )}

              {/* Approval/Decline Forms - Only show for pending requests */}
              {selectedRequest.status === 'pending' && (
                <>
                  {!showDeclineForm ? (
                    <div className="space-y-4 border-t pt-4">
                      <h3 className="font-semibold text-lg">{t('requests.approval.title', { defaultValue: 'Approval Details' })}</h3>

                      <div>
                        <UserPicker
                          id="assign-technician"
                          label={t('requests.approval.fields.assignedTechnician', { defaultValue: 'Assign Technician *' })}
                          users={technicians}
                          value={assignedTechnicianId}
                          onValueChange={setAssignedTechnicianId}
                          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                          placeholder={t('requests.approval.placeholders.assignedTechnician', { defaultValue: 'Select technician' })}
                          userTypeFilter="internal"
                          buttonWidth="full"
                        />
                      </div>

                      <div>
                        <Label>{t('requests.approval.fields.finalDateTime', { defaultValue: 'Final Date & Time' })}</Label>
                        <DateTimePicker
                          id="final-datetime"
                          value={finalDateTime || undefined}
                          onChange={(date) => setFinalDateTime(date || null)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="internal-notes">{t('requests.approval.fields.internalNotes', { defaultValue: 'Internal Notes (Optional)' })}</Label>
                        <TextArea
                          id="internal-notes"
                          value={internalNotes}
                          onChange={(e) => setInternalNotes(e.target.value)}
                          placeholder={t('requests.approval.placeholders.internalNotes', { defaultValue: 'Add any internal notes...' })}
                          rows={3}
                        />
                      </div>

                      {!selectedRequest.ticket_id && (
                        <div>
                          <Label htmlFor="linked-ticket">{t('requests.approval.fields.linkedTicket', { defaultValue: 'Link to Ticket (Optional)' })}</Label>
                          <Input
                            id="linked-ticket"
                            value={linkedTicketId}
                            onChange={(e) => setLinkedTicketId(e.target.value)}
                            placeholder={t('requests.approval.placeholders.linkedTicket', { defaultValue: 'Enter ticket ID to link...' })}
                          />
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          id="approve-request"
                          onClick={handleApprove}
                          className="flex-1"
                        >
                          <Check className="h-4 w-4 mr-2" />
                          {t('requests.approval.actions.approve', { defaultValue: 'Approve' })}
                        </Button>
                        <Button
                          id="show-decline-form"
                          variant="outline"
                          onClick={() => setShowDeclineForm(true)}
                          className="flex-1"
                        >
                          <X className="h-4 w-4 mr-2" />
                          {t('requests.approval.actions.decline', { defaultValue: 'Decline' })}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 border-t pt-4">
                      <h3 className="font-semibold text-lg">{t('requests.decline.title', { defaultValue: 'Decline Request' })}</h3>

                      <div>
                        <Label htmlFor="decline-reason">{t('requests.decline.fields.reason', { defaultValue: 'Reason for Declining *' })}</Label>
                        <TextArea
                          id="decline-reason"
                          value={declineReason}
                          onChange={(e) => setDeclineReason(e.target.value)}
                          placeholder={t('requests.decline.placeholders.reason', { defaultValue: 'Please provide a reason for declining this request...' })}
                          rows={4}
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button
                          id="confirm-decline"
                          variant="destructive"
                          onClick={handleDecline}
                          className="flex-1"
                        >
                          <X className="h-4 w-4 mr-2" />
                          {t('requests.decline.actions.confirm', { defaultValue: 'Confirm Decline' })}
                        </Button>
                        <Button
                          id="cancel-decline"
                          variant="outline"
                          onClick={() => setShowDeclineForm(false)}
                          className="flex-1"
                        >
                          {t('requests.decline.actions.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
            </div>
          </>
        )}
      </div>
      </Drawer>

      {/* Ticket Drawer */}
      {selectedTicket && (
        <Drawer
          isOpen={isTicketDrawerOpen}
          onClose={() => {
            setIsTicketDrawerOpen(false);
            setSelectedTicket(null);
          }}
          id="appointment-ticket-drawer"
        >
          <SchedulingTicketDetails ticket={selectedTicket} />
        </Drawer>
      )}
    </>
  );
}
