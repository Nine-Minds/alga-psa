'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Calendar, Clock, User, Loader2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { format, parseISO } from 'date-fns';
import type { BadgeVariant } from '@alga-psa/ui/components/Badge';

export interface ITicketAppointmentRequest {
  appointment_request_id: string;
  service_name?: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  preferred_assigned_user_name?: string;
  approved_at?: string;
  approver_first_name?: string;
  approver_last_name?: string;
  declined_reason?: string;
  is_authenticated: boolean;
}

interface TicketAppointmentRequestsProps {
  ticketId: string;
  appointments?: ITicketAppointmentRequest[];
  isLoading?: boolean;
}

export default function TicketAppointmentRequests({
  ticketId,
  appointments = [],
  isLoading = false
}: TicketAppointmentRequestsProps) {
  const { t } = useTranslation('clientPortal');

  const getStatusBadgeVariant = (status: string): BadgeVariant => {
    switch (status) {
      case 'approved':
        return 'success';
      case 'pending':
        return 'warning';
      case 'declined':
      case 'cancelled':
        return 'error';
      default:
        return 'outline';
    }
  };

  const formatDateTime = (dateStr: string, timeStr: string): string => {
    try {
      const date = parseISO(dateStr);
      const formattedDate = format(date, 'MMM d, yyyy');
      // Format time from HH:MM to 12-hour format
      const [hours, minutes] = timeStr.split(':');
      const hour = parseInt(hours, 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      const formattedTime = `${hour12}:${minutes} ${ampm}`;
      return `${formattedDate} ${t('appointments.step4.at')} ${formattedTime}`;
    } catch {
      return t('appointments.ticketSection.invalidDateTime');
    }
  };

  // Don't render anything if loading
  if (isLoading) {
    return (
      <div className="mt-4 flex items-center justify-center py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        {t('common.loading')}
      </div>
    );
  }

  // Don't show section if no appointments
  if (appointments.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium mb-3">{t('appointments.ticketSection.title')}</h3>
      <div className="space-y-3">
        {appointments.map((appointment) => (
          <div
            key={appointment.appointment_request_id}
            className="border rounded-lg p-3 bg-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                {/* Service name */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm truncate">
                    {appointment.service_name || t('appointments.ticketSection.service')}
                  </span>
                  <Badge variant={getStatusBadgeVariant(appointment.status)}>
                    {t(`appointments.status.${appointment.status}`)}
                  </Badge>
                </div>

                {/* Date/Time */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <Calendar className="h-3 w-3" />
                  <span>
                    {formatDateTime(appointment.requested_date, appointment.requested_time)}
                  </span>
                </div>

                {/* Duration */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" />
                  <span>
                    {appointment.requested_duration} {t('appointments.ticketSection.minutes')}
                  </span>
                </div>

                {/* Preferred technician if set */}
                {appointment.preferred_assigned_user_name && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <User className="h-3 w-3" />
                    <span>
                      {t('appointments.ticketSection.preferred')} {appointment.preferred_assigned_user_name}
                    </span>
                  </div>
                )}

                {/* Approval info for approved */}
                {appointment.status === 'approved' && appointment.approved_at && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {appointment.approver_first_name && (
                      <span>
                        {t('appointments.ticketSection.approvedBy')} {appointment.approver_first_name} {appointment.approver_last_name} {t('appointments.ticketSection.on')}{' '}
                        {format(parseISO(appointment.approved_at), 'MMM d, yyyy')}
                      </span>
                    )}
                  </div>
                )}

                {/* Declined reason */}
                {appointment.status === 'declined' && appointment.declined_reason && (
                  <div className="text-xs text-destructive mt-1">
                    {t('appointments.ticketSection.declined')} {appointment.declined_reason}
                  </div>
                )}

                {/* Public request indicator */}
                {!appointment.is_authenticated && (
                  <div className="text-xs text-muted-foreground mt-1 italic">
                    {t('appointments.ticketSection.publicRequest')}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
