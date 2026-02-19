'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Calendar, Clock, User, FileText, AlertCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import Spinner from '@alga-psa/ui/components/Spinner';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { getAppointmentRequestDetails, cancelAppointmentRequest } from '@alga-psa/client-portal/actions';

/** Safely convert a PG DATE (may be JS Date object) or string to YYYY-MM-DD */
function normalizeDateValue(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

/** Safely convert a PG TIME (may be string like "11:00:00") to HH:MM */
function normalizeTimeValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 5);
  return null;
}

interface AppointmentRequestDetails {
  appointment_request_id: string;
  service_id: string;
  service_name: string;
  service_description?: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  preferred_technician_first_name?: string;
  preferred_technician_last_name?: string;
  description?: string;
  ticket_id?: string;
  ticket_title?: string;
  approver_first_name?: string;
  approver_last_name?: string;
  approved_at?: string;
  declined_reason?: string;
  created_at: string;
}

export function AppointmentRequestDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const appointmentRequestId = params?.appointmentRequestId as string;
  const { t } = useTranslation('features/appointments');
  const { t: tCommon } = useTranslation('common');

  const [appointment, setAppointment] = useState<AppointmentRequestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);

  const loadAppointment = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAppointmentRequestDetails(appointmentRequestId);
      if (result.success && result.data) {
        setAppointment(result.data as unknown as AppointmentRequestDetails);
      } else {
        setError(result.error || t('errors.loadFailed', 'Failed to load appointment details'));
      }
    } catch (err) {
      console.error('Error loading appointment:', err);
      setError(t('errors.loadFailed', 'Failed to load appointment details'));
    } finally {
      setLoading(false);
    }
  }, [appointmentRequestId, t]);

  useEffect(() => {
    loadAppointment();
  }, [loadAppointment]);

  const handleClose = () => {
    router.push('/client-portal/appointments');
  };

  const handleCancelAppointment = async () => {
    try {
      const result = await cancelAppointmentRequest({ appointment_request_id: appointmentRequestId });
      if (result.success) {
        toast.success(t('messages.cancelSuccess', 'Appointment request cancelled'));
        setShowCancelConfirmation(false);
        loadAppointment();
      } else {
        toast.error(result.error || t('messages.cancelFailed', 'Failed to cancel appointment'));
      }
    } catch (err) {
      console.error('Error cancelling appointment:', err);
      toast.error(t('messages.cancelFailed', 'Failed to cancel appointment'));
    }
  };

  const getStatusBadge = (status: AppointmentRequestDetails['status']) => {
    const variants: Record<AppointmentRequestDetails['status'], { variant: 'default' | 'primary' | 'success' | 'warning' | 'error'; label: string }> = {
      pending: { variant: 'warning', label: t('status.pending', 'Pending') },
      approved: { variant: 'success', label: t('status.approved', 'Approved') },
      declined: { variant: 'error', label: t('status.declined', 'Declined') },
      cancelled: { variant: 'default', label: t('status.cancelled', 'Cancelled') }
    };

    const config = variants[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatRequestedDateTime = (dateValue: unknown, timeValue: unknown) => {
    const dateStr = normalizeDateValue(dateValue);
    const timeStr = normalizeTimeValue(timeValue);
    if (!dateStr || !timeStr) return 'N/A';
    try {
      const dt = new Date(`${dateStr}T${timeStr}:00Z`);
      if (isNaN(dt.getTime())) return 'N/A';
      return dt.toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return 'N/A';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner size="sm" />
        <span className="ml-3 text-gray-600">{tCommon('common.loading', 'Loading...')}</span>
      </div>
    );
  }

  if (error || !appointment) {
    return (
      <div className="w-full">
        <Button
          id="back-to-appointments-button"
          variant="soft"
          onClick={handleClose}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('backToAppointments', 'Back to Appointments')}
        </Button>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle className="h-6 w-6" />
              <p>{error || t('errors.notFound', 'Appointment request not found')}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const preferredTechnicianName = appointment.preferred_technician_first_name && appointment.preferred_technician_last_name
    ? `${appointment.preferred_technician_first_name} ${appointment.preferred_technician_last_name}`
    : undefined;

  const approverName = appointment.approver_first_name && appointment.approver_last_name
    ? `${appointment.approver_first_name} ${appointment.approver_last_name}`
    : undefined;

  return (
    <div className="w-full space-y-4">
      <Button
        id="back-to-appointments-button"
        variant="soft"
        onClick={handleClose}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        {t('backToAppointments', 'Back to Appointments')}
      </Button>

      <Card>
        <CardContent className="p-6">
          <div className="space-y-6">
            {/* Header with status */}
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">
                {appointment.service_name}
              </h1>
              {getStatusBadge(appointment.status)}
            </div>

            {/* Status Banner */}
            <div className={`p-4 rounded-lg ${
              appointment.status === 'approved' ? 'bg-success/10 border border-success/30' :
              appointment.status === 'declined' ? 'bg-error/10 border border-error/30' :
              appointment.status === 'cancelled' ? 'bg-[rgb(var(--color-border-100))] border border-[rgb(var(--color-border-200))]' :
              'bg-warning/10 border border-warning/30'
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {appointment.status === 'approved' && t('details.statusApproved', 'Your appointment has been approved')}
                  {appointment.status === 'pending' && t('details.statusPending', 'Your appointment request is being reviewed')}
                  {appointment.status === 'declined' && t('details.statusDeclined', 'Your appointment request was declined')}
                  {appointment.status === 'cancelled' && t('details.statusCancelled', 'This appointment request was cancelled')}
                </span>
              </div>
              {appointment.status === 'declined' && appointment.declined_reason && (
                <div className="mt-2 text-sm text-red-800">
                  <strong>{t('details.reason', 'Reason')}:</strong> {appointment.declined_reason}
                </div>
              )}
            </div>

            {/* Appointment Details */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700">
                    {t('details.reference', 'Reference Number')}
                  </div>
                  <div className="text-sm font-mono text-gray-900">
                    {appointment.appointment_request_id.slice(0, 8).toUpperCase()}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-gray-500 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700">
                    {t('details.dateTime', 'Date & Time')}
                  </div>
                  <div className="text-sm text-gray-900">
                    {formatRequestedDateTime(appointment.requested_date, appointment.requested_time)}
                  </div>
                  <div className="text-sm text-gray-600 mt-1 flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {appointment.requested_duration} {t('table.minutes', 'minutes')}
                  </div>
                </div>
              </div>

              {preferredTechnicianName && (
                <div className="flex items-start gap-3">
                  <User className="h-5 w-5 text-gray-500 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-700">
                      {t('details.technician', 'Preferred Technician')}
                    </div>
                    <div className="text-sm text-gray-900">
                      {preferredTechnicianName}
                    </div>
                  </div>
                </div>
              )}

              {appointment.ticket_title && (
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-700">
                      {t('details.linkedTicket', 'Linked Ticket')}
                    </div>
                    <div className="text-sm text-gray-900">{appointment.ticket_title}</div>
                  </div>
                </div>
              )}

              {appointment.description && (
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-700">
                      {t('details.description', 'Description')}
                    </div>
                    <div className="text-sm text-gray-900 whitespace-pre-wrap">
                      {appointment.description}
                    </div>
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="pt-4 border-t border-gray-200">
                {appointment.created_at && (() => {
                  try {
                    const date = new Date(appointment.created_at);
                    if (!isNaN(date.getTime())) {
                      return (
                        <div className="text-xs text-gray-500">
                          {t('details.created', 'Requested')}: {format(date, 'MMM d, yyyy h:mm a')}
                        </div>
                      );
                    }
                  } catch {}
                  return null;
                })()}
                {appointment.approved_at && approverName && (() => {
                  try {
                    const date = new Date(appointment.approved_at);
                    if (!isNaN(date.getTime())) {
                      return (
                        <div className="text-xs text-gray-500 mt-1">
                          {t('details.approved', 'Approved')}: {format(date, 'MMM d, yyyy h:mm a')} by {approverName}
                        </div>
                      );
                    }
                  } catch {}
                  return null;
                })()}
              </div>
            </div>

            {/* Actions */}
            {appointment.status === 'pending' && (
              <div className="pt-4 border-t border-gray-200 flex justify-end">
                <Button
                  id="cancel-appointment-button"
                  variant="destructive"
                  onClick={() => setShowCancelConfirmation(true)}
                >
                  {t('details.cancelButton', 'Cancel Request')}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cancel Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showCancelConfirmation}
        onClose={() => setShowCancelConfirmation(false)}
        onConfirm={handleCancelAppointment}
        title={t('cancel.title', 'Cancel Appointment Request')}
        message={t('cancel.message', 'Are you sure you want to cancel this appointment request? This action cannot be undone.')}
        confirmLabel={t('cancel.confirm', 'Yes, Cancel')}
        cancelLabel={tCommon('common.cancel', 'Cancel')}
      />
    </div>
  );
}
