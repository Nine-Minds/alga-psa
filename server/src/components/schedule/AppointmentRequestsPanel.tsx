'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Drawer from 'server/src/components/ui/Drawer';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { DateTimePicker } from 'server/src/components/ui/DateTimePicker';
import { TextArea } from 'server/src/components/ui/TextArea';
import toast from 'react-hot-toast';
import { Check, X, Calendar, Clock, User, FileText, Briefcase } from 'lucide-react';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import {
  getAppointmentRequests,
  approveAppointmentRequest as approveRequest,
  declineAppointmentRequest as declineRequest,
  IAppointmentRequest
} from 'server/src/lib/actions/appointmentRequestManagementActions';

interface AppointmentRequestsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestProcessed?: () => void;
}

export default function AppointmentRequestsPanel({
  isOpen,
  onClose,
  onRequestProcessed
}: AppointmentRequestsPanelProps) {
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

  // Users for technician assignment
  const [technicians, setTechnicians] = useState<Omit<IUserWithRoles, 'tenant'>[]>([]);

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
        toast.error(result.error || 'Failed to load appointment requests');
      }
    } catch (error) {
      console.error('Failed to load appointment requests:', error);
      toast.error('Failed to load appointment requests');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTechnicians = async () => {
    try {
      const users = await getAllUsers(false, 'internal');
      setTechnicians(users);
    } catch (error) {
      console.error('Failed to load technicians:', error);
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

    // Handle date/time parsing safely - prefill with requested date/time
    try {
      if (request.requested_date && request.requested_time) {
        // Database stores time in HH:MM or HH:MM:SS format
        const timeStr = request.requested_time.slice(0, 5); // Get HH:MM only

        // Parse time components
        const [hours, minutes] = timeStr.split(':').map(Number);

        // Create date object from the requested date
        const parsedDate = new Date(request.requested_date);

        // Set the time components
        if (!isNaN(parsedDate.getTime()) && !isNaN(hours) && !isNaN(minutes)) {
          parsedDate.setHours(hours, minutes, 0, 0);

          console.log('Prefilling date/time:', {
            date: request.requested_date,
            time: request.requested_time,
            parsed: parsedDate.toISOString()
          });

          setFinalDateTime(parsedDate);
        } else {
          console.error('Invalid date/time components:', { date: request.requested_date, time: timeStr });
          setFinalDateTime(null);
        }
      } else {
        console.error('Missing date or time:', { date: request.requested_date, time: request.requested_time });
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

  const handleApprove = async () => {
    if (!selectedRequest) return;

    if (!assignedTechnicianId) {
      toast.error('Please assign a technician');
      return;
    }

    try {
      // Use finalDateTime if set, otherwise fall back to original requested date/time
      let approvalDate: string | undefined;
      let approvalTime: string | undefined;

      if (finalDateTime && !isNaN(finalDateTime.getTime())) {
        // Convert Date object to proper string formats
        approvalDate = finalDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
        const hours = finalDateTime.getHours().toString().padStart(2, '0');
        const minutes = finalDateTime.getMinutes().toString().padStart(2, '0');
        approvalTime = `${hours}:${minutes}`; // HH:MM
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
        toast.success('Appointment request approved');
        setSelectedRequest(null);
        loadRequests();
        onRequestProcessed?.();
      } else {
        toast.error(result.error || 'Failed to approve request');
      }
    } catch (error) {
      console.error('Failed to approve request:', error);
      toast.error('Failed to approve request');
    }
  };

  const handleDecline = async () => {
    if (!selectedRequest) return;

    if (!declineReason.trim()) {
      toast.error('Please provide a reason for declining');
      return;
    }

    try {
      const result = await declineRequest({
        appointment_request_id: selectedRequest.appointment_request_id,
        decline_reason: declineReason
      });

      if (result.success) {
        toast.success('Appointment request declined');
        setSelectedRequest(null);
        setShowDeclineForm(false);
        loadRequests();
        onRequestProcessed?.();
      } else {
        toast.error(result.error || 'Failed to decline request');
      }
    } catch (error) {
      console.error('Failed to decline request:', error);
      toast.error('Failed to decline request');
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
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'declined', label: 'Declined' },
    { value: 'cancelled', label: 'Cancelled' }
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

  const formatDateTime = (date: string, time: string) => {
    try {
      if (!date || !time) {
        return 'Invalid date/time';
      }
      const dateTime = new Date(`${date}T${time}`);
      if (isNaN(dateTime.getTime())) {
        return `${date} ${time}`;
      }
      return dateTime.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return `${date} ${time}`;
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} id="appointment-requests-panel">
      <div className="h-full flex flex-col max-w-2xl">
        {!selectedRequest ? (
          <>
            {/* List View */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Appointment Requests</h2>
              <Badge variant="primary">{filteredRequests.length} {statusFilter === 'all' ? 'Total' : statusFilter}</Badge>
            </div>

            {/* Filters */}
            <div className="mb-4">
              <CustomSelect
                id="status-filter"
                options={statusOptions}
                value={statusFilter}
                onValueChange={setStatusFilter}
                label="Filter by Status"
              />
            </div>

            {/* Request List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading requests...</div>
              ) : filteredRequests.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No {statusFilter !== 'all' ? statusFilter : ''} requests found
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
                            {request.is_authenticated ? (request as any).client_company_name : request.company_name || 'Public Request'}
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
                          {formatDateTime(request.requested_date, request.requested_time)}
                        </div>
                        <div className="flex items-center text-gray-600">
                          <Clock className="h-4 w-4 mr-2" />
                          {request.requested_duration} minutes
                        </div>
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
                ← Back to List
              </Button>
              <h2 className="text-2xl font-bold">Request Details</h2>
            </div>

            <div className="flex-1 overflow-y-auto">
              <Card>
            <CardHeader>
              <CardTitle>Request Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Request Information */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="font-semibold text-gray-700">Client</div>
                  <div>{selectedRequest.is_authenticated ? (selectedRequest as any).client_company_name : selectedRequest.company_name}</div>
                </div>
                {(selectedRequest as any).contact_name && (
                  <div>
                    <div className="font-semibold text-gray-700">Contact</div>
                    <div>{(selectedRequest as any).contact_name}</div>
                  </div>
                )}
                {(selectedRequest as any).contact_email && (
                  <div>
                    <div className="font-semibold text-gray-700">Email</div>
                    <div>{(selectedRequest as any).contact_email}</div>
                  </div>
                )}
                {selectedRequest.requester_email && !selectedRequest.is_authenticated && (
                  <div>
                    <div className="font-semibold text-gray-700">Email</div>
                    <div>{selectedRequest.requester_email}</div>
                  </div>
                )}
                {selectedRequest.requester_phone && (
                  <div>
                    <div className="font-semibold text-gray-700">Phone</div>
                    <div>{selectedRequest.requester_phone}</div>
                  </div>
                )}
                <div>
                  <div className="font-semibold text-gray-700">Service</div>
                  <div>{(selectedRequest as any).service_name}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">Requested Time</div>
                  <div>{formatDateTime(selectedRequest.requested_date, selectedRequest.requested_time)}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">Duration</div>
                  <div>{selectedRequest.requested_duration} minutes</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">Status</div>
                  <Badge variant={getStatusBadgeVariant(selectedRequest.status)}>
                    {selectedRequest.status}
                  </Badge>
                </div>
              </div>

              {selectedRequest.description && (
                <div>
                  <div className="font-semibold text-gray-700 mb-1">Description</div>
                  <div className="text-sm bg-gray-50 p-3 rounded border">{selectedRequest.description}</div>
                </div>
              )}

              {/* Approval/Decline Forms - Only show for pending requests */}
              {selectedRequest.status === 'pending' && (
                <>
                  {!showDeclineForm ? (
                    <div className="space-y-4 border-t pt-4">
                      <h3 className="font-semibold text-lg">Approval Details</h3>

                      <div>
                        <Label>Assign Technician *</Label>
                        <CustomSelect
                          id="assign-technician"
                          options={technicianOptions}
                          value={assignedTechnicianId}
                          onValueChange={setAssignedTechnicianId}
                          placeholder="Select technician"
                        />
                      </div>

                      <div>
                        <Label>Final Date & Time</Label>
                        <DateTimePicker
                          id="final-datetime"
                          value={finalDateTime || undefined}
                          onChange={(date) => setFinalDateTime(date || null)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="internal-notes">Internal Notes (Optional)</Label>
                        <TextArea
                          id="internal-notes"
                          value={internalNotes}
                          onChange={(e) => setInternalNotes(e.target.value)}
                          placeholder="Add any internal notes..."
                          rows={3}
                        />
                      </div>

                      <div>
                        <Label htmlFor="linked-ticket">Link to Ticket (Optional)</Label>
                        <Input
                          id="linked-ticket"
                          value={linkedTicketId}
                          onChange={(e) => setLinkedTicketId(e.target.value)}
                          placeholder="Ticket ID"
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button
                          id="approve-request"
                          onClick={handleApprove}
                          className="flex-1"
                        >
                          <Check className="h-4 w-4 mr-2" />
                          Approve
                        </Button>
                        <Button
                          id="show-decline-form"
                          variant="outline"
                          onClick={() => setShowDeclineForm(true)}
                          className="flex-1"
                        >
                          <X className="h-4 w-4 mr-2" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 border-t pt-4">
                      <h3 className="font-semibold text-lg">Decline Request</h3>

                      <div>
                        <Label htmlFor="decline-reason">Reason for Declining *</Label>
                        <TextArea
                          id="decline-reason"
                          value={declineReason}
                          onChange={(e) => setDeclineReason(e.target.value)}
                          placeholder="Please provide a reason for declining this request..."
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
                          Confirm Decline
                        </Button>
                        <Button
                          id="cancel-decline"
                          variant="outline"
                          onClick={() => setShowDeclineForm(false)}
                          className="flex-1"
                        >
                          Cancel
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
  );
}
