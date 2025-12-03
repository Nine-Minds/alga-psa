'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { Calendar, Clock, User, Briefcase } from 'lucide-react';
import { getAppointmentRequestsByTicketId as getMspAppointmentRequests } from 'server/src/lib/actions/appointmentRequestManagementActions';
import { getAppointmentRequestsByTicketId as getClientAppointmentRequests } from 'server/src/lib/actions/client-portal-actions/appointmentRequestActions';
import type { IAppointmentRequest } from 'server/src/lib/actions/appointmentRequestManagementActions';
import toast from 'react-hot-toast';
import { useTranslation } from 'server/src/lib/i18n/client';

interface TicketAppointmentRequestsProps {
  ticketId: string;
  id?: string;
}

export default function TicketAppointmentRequests({
  ticketId,
  id = 'ticket-appointment-requests'
}: TicketAppointmentRequestsProps) {
  const { t } = useTranslation('clientPortal');
  const [requests, setRequests] = useState<IAppointmentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    loadAppointmentRequests();
  }, [ticketId]);

  const loadAppointmentRequests = async () => {
    setIsLoading(true);
    try {
      // Try MSP action first
      let result = await getMspAppointmentRequests(ticketId);

      // If MSP action fails due to permissions, try client portal action
      if (!result.success && result.error?.includes('permissions')) {
        result = await getClientAppointmentRequests(ticketId);
      }

      if (result.success && result.data) {
        setRequests(result.data);
      } else if (result.error && !result.error.includes('permissions')) {
        // Only show error if it's not a permission issue (which is expected in one context or the other)
        toast.error(result.error || 'Failed to load appointment requests');
      }
    } catch (error) {
      console.error('Failed to load appointment requests:', error);
      // Don't show toast for expected permission errors
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  };

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
        return t('appointments.ticketSection.invalidDateTime');
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

  // Don't render anything until we've loaded and confirmed there are requests
  if (!hasLoaded || requests.length === 0) {
    return null;
  }

  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle>{t('appointments.ticketSection.title')} ({requests.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {requests.map((request) => (
            <div
              key={request.appointment_request_id}
              className="p-4 border rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <div className="font-semibold text-base">
                    {(request as any).service_name || t('appointments.ticketSection.service')}
                  </div>
                  {request.is_authenticated && (request as any).client_company_name && (
                    <div className="text-sm text-gray-600">
                      {(request as any).client_company_name}
                    </div>
                  )}
                  {!request.is_authenticated && request.company_name && (
                    <div className="text-sm text-gray-600">
                      {request.company_name} ({t('appointments.ticketSection.publicRequest')})
                    </div>
                  )}
                </div>
                <Badge variant={getStatusBadgeVariant(request.status)}>
                  {t(`appointments.status.${request.status}`)}
                </Badge>
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex items-center text-gray-600">
                  <Calendar className="h-4 w-4 mr-2" />
                  {formatDateTime(request.requested_date, request.requested_time)}
                </div>
                <div className="flex items-center text-gray-600">
                  <Clock className="h-4 w-4 mr-2" />
                  {request.requested_duration} {t('appointments.ticketSection.minutes')}
                </div>
                {(request as any).preferred_technician_first_name && (
                  <div className="flex items-center text-gray-600">
                    <User className="h-4 w-4 mr-2" />
                    {t('appointments.ticketSection.preferred')} {(request as any).preferred_technician_first_name} {(request as any).preferred_technician_last_name}
                  </div>
                )}
                {request.status === 'approved' && (request as any).approver_first_name && (
                  <div className="text-xs text-green-600 mt-2">
                    {t('appointments.ticketSection.approvedBy')} {(request as any).approver_first_name} {(request as any).approver_last_name}
                    {request.approved_at && ` ${t('appointments.ticketSection.on')} ${new Date(request.approved_at).toLocaleDateString()}`}
                  </div>
                )}
                {request.status === 'declined' && request.declined_reason && (
                  <div className="text-xs text-red-600 mt-2">
                    {t('appointments.ticketSection.declined')} {request.declined_reason}
                  </div>
                )}
              </div>

              {request.description && (
                <div className="mt-2 text-sm text-gray-700 bg-white p-2 rounded border">
                  {request.description}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
