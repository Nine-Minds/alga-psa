'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { RequestAppointmentModal } from './RequestAppointmentModal';
import Spinner from '@alga-psa/ui/components/Spinner';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import { Calendar, Clock, User, FileText, AlertCircle, X } from 'lucide-react';
import { format } from 'date-fns';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import toast from 'react-hot-toast';
import { getMyAppointmentRequests, cancelAppointmentRequest } from '@alga-psa/client-portal/actions';

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

interface AppointmentRequest {
  appointment_request_id: string;
  service_id: string;
  service_name: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  preferred_assigned_user_name?: string;
  description?: string;
  ticket_id?: string;
  ticket_number?: string;
  approved_at?: string;
  declined_reason?: string;
  created_at: string;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'declined' | 'cancelled';

export default function AppointmentsPage() {
  const { t } = useTranslation('features/appointments');
  const { t: tCommon } = useTranslation('common');

  const [appointments, setAppointments] = useState<AppointmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentRequest | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentRequest | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [appointmentToCancel, setAppointmentToCancel] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      // Don't send 'all' as a filter - it means no status filter
      const filters = filterStatus && filterStatus !== 'all' ? { status: filterStatus } : undefined;
      const result = await getMyAppointmentRequests(filters);
      if (result.success && result.data) {
        setAppointments(result.data as any);
      } else {
        setAppointments([]);
        if (result.error) {
          toast.error(result.error);
        }
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
      toast.error(t('errors.loadFailed'));
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, t]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const handleCancelAppointment = async () => {
    if (!appointmentToCancel) return;

    try {
      const result = await cancelAppointmentRequest({ appointment_request_id: appointmentToCancel });
      if (!result.success) {
        throw new Error(result.error || t('messages.cancelFailed'));
      }

      toast.success(t('messages.cancelSuccess'));
      setAppointmentToCancel(null);
      loadAppointments();
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      toast.error(t('messages.cancelFailed'));
    }
  };

  const filteredAppointments = useMemo(() => {
    if (filterStatus === 'all') {
      return appointments;
    }
    return appointments.filter(apt => apt.status === filterStatus);
  }, [appointments, filterStatus]);

  const getStatusBadge = (status: AppointmentRequest['status']) => {
    const variants: Record<AppointmentRequest['status'], { variant: 'default' | 'primary' | 'success' | 'warning' | 'error'; label: string }> = {
      pending: { variant: 'warning', label: t('status.pending') },
      approved: { variant: 'success', label: t('status.approved') },
      declined: { variant: 'error', label: t('status.declined') },
      cancelled: { variant: 'default', label: t('status.cancelled') }
    };

    const config = variants[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const columns: ColumnDefinition<AppointmentRequest>[] = [
    {
      title: t('table.service'),
      dataIndex: 'service_name',
      width: '25%',
      render: (value: string, record: AppointmentRequest) => (
        <div
          className="font-medium cursor-pointer hover:text-[rgb(var(--color-primary-600))]"
          onClick={() => setSelectedAppointment(record)}
        >
          {value}
        </div>
      )
    },
    {
      title: t('table.dateTime'),
      dataIndex: 'requested_date',
      width: '20%',
      render: (value: unknown, record: AppointmentRequest) => {
        const dateStr = normalizeDateValue(value);
        const timeStr = normalizeTimeValue(record.requested_time);

        let display = 'N/A';
        if (dateStr && timeStr) {
          try {
            const dt = new Date(`${dateStr}T${timeStr}:00Z`);
            if (!isNaN(dt.getTime())) {
              display = dt.toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
              });
            }
          } catch { /* fallback */ }
        }

        return (
          <div className="text-sm">
            <div className="flex items-center gap-1 text-gray-900">
              <Calendar className="h-3 w-3" />
              {display}
            </div>
            <div className="flex items-center gap-1 text-gray-600 mt-1">
              <Clock className="h-3 w-3" />
              {record.requested_duration} {t('table.minutes')}
            </div>
          </div>
        );
      }
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      width: '15%',
      render: (value: AppointmentRequest['status']) => getStatusBadge(value)
    },
    {
      title: t('table.technician'),
      dataIndex: 'preferred_assigned_user_name',
      width: '20%',
      render: (value: string) => (
        <div className="text-sm">
          {value || <span className="text-gray-400">{t('table.notAssigned')}</span>}
        </div>
      )
    },
    {
      title: t('table.actions'),
      dataIndex: 'appointment_request_id',
      width: '20%',
      render: (value: string, record: AppointmentRequest) => (
        <div className="flex items-center gap-2">
          <Button
            id={`view-appointment-${value}`}
            variant="soft"
            size="sm"
            onClick={() => setSelectedAppointment(record)}
          >
            {t('table.viewDetails')}
          </Button>
          {record.status === 'pending' && (
            <>
              <Button
                id={`edit-appointment-${value}`}
                variant="default"
                size="sm"
                onClick={() => {
                  setEditingAppointment(record);
                  setIsRequestModalOpen(true);
                }}
              >
                {t('table.edit')}
              </Button>
              <Button
                id={`cancel-appointment-${value}`}
                variant="outline"
                size="sm"
                onClick={() => setAppointmentToCancel(value)}
              >
                {t('table.cancel')}
              </Button>
            </>
          )}
        </div>
      )
    }
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner size="sm" />
        <span className="ml-3 text-gray-600">{tCommon('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">
            {t('page.title')}
          </h1>
          <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">
            {t('page.subtitle')}
          </p>
        </div>
        <Button
          id="request-appointment-button"
          variant="default"
          onClick={() => setIsRequestModalOpen(true)}
        >
          {t('page.requestButton')}
        </Button>
      </div>

      {/* Appointments Table with Filter Tabs */}
      <Card>
        <CardContent className="p-0">
          {/* Filter Tabs */}
          <div className="flex gap-2 border-b border-gray-200 px-6 pt-4">
            {(['all', 'pending', 'approved', 'declined'] as FilterStatus[]).map((status) => (
              <button
                key={status}
                id={`filter-${status}-button`}
                onClick={() => setFilterStatus(status)}
                className={`
                  px-4 py-2 text-sm font-medium border-b-2 transition-colors
                  ${filterStatus === status
                    ? 'border-[rgb(var(--color-primary-500))] text-[rgb(var(--color-primary-600))]'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }
                `}
              >
                {t(`filters.${status}`)}
                {status !== 'all' && (
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-xs">
                    {appointments.filter(apt => apt.status === status).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Table Content */}
          <div className="p-6">
            {filteredAppointments.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {t('page.noAppointments')}
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  {t('page.noAppointmentsDescription')}
                </p>
                <Button
                  id="request-first-appointment-button"
                  variant="default"
                  onClick={() => setIsRequestModalOpen(true)}
                >
                  {t('page.requestButton')}
                </Button>
              </div>
            ) : (
              <DataTable
                id="appointments-table"
                data={filteredAppointments}
                columns={columns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={setPageSize}
                rowClassName={() => ""}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Request Appointment Modal */}
      <RequestAppointmentModal
        open={isRequestModalOpen}
        onOpenChange={(open) => {
          setIsRequestModalOpen(open);
          if (!open) {
            setEditingAppointment(null);
          }
        }}
        onAppointmentRequested={loadAppointments}
        editingAppointment={editingAppointment}
      />

      {/* Appointment Details Modal */}
      {selectedAppointment && (
        <Dialog
          isOpen={!!selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          title={t('details.title')}
          className="max-w-2xl"
        >
          <DialogContent>
            <div className="space-y-6">
              {/* Status Banner */}
              <div className={`p-4 rounded-lg ${
                selectedAppointment.status === 'approved' ? 'bg-green-50 border border-green-200' :
                selectedAppointment.status === 'declined' ? 'bg-red-50 border border-red-200' :
                selectedAppointment.status === 'cancelled' ? 'bg-gray-50 border border-gray-200' :
                'bg-yellow-50 border border-yellow-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(selectedAppointment.status)}
                    <span className="text-sm font-medium">
                      {selectedAppointment.status === 'approved' && t('details.statusApproved')}
                      {selectedAppointment.status === 'pending' && t('details.statusPending')}
                      {selectedAppointment.status === 'declined' && t('details.statusDeclined')}
                      {selectedAppointment.status === 'cancelled' && t('details.statusCancelled')}
                    </span>
                  </div>
                </div>
                {selectedAppointment.status === 'declined' && selectedAppointment.declined_reason && (
                  <div className="mt-2 text-sm text-red-800">
                    <strong>{t('details.reason')}:</strong> {selectedAppointment.declined_reason}
                  </div>
                )}
              </div>

              {/* Appointment Details */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-700">
                      {t('details.reference')}
                    </div>
                    <div className="text-sm font-mono text-gray-900">{selectedAppointment.appointment_request_id.slice(0, 8).toUpperCase()}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-700">
                      {t('details.service')}
                    </div>
                    <div className="text-sm text-gray-900">{selectedAppointment.service_name}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-gray-500 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-700">
                      {t('details.dateTime')}
                    </div>
                    <div className="text-sm text-gray-900">
                      {(() => {
                        const dateStr = normalizeDateValue(selectedAppointment.requested_date);
                        const timeStr = normalizeTimeValue(selectedAppointment.requested_time);
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
                      })()}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {selectedAppointment.requested_duration} {t('table.minutes')}
                    </div>
                  </div>
                </div>

                {selectedAppointment.preferred_assigned_user_name && (
                  <div className="flex items-start gap-3">
                    <User className="h-5 w-5 text-gray-500 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-700">
                        {t('details.technician')}
                      </div>
                      <div className="text-sm text-gray-900">
                        {selectedAppointment.preferred_assigned_user_name}
                      </div>
                    </div>
                  </div>
                )}

                {selectedAppointment.ticket_number && (
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-700">
                        {t('details.linkedTicket')}
                      </div>
                      <div className="text-sm text-gray-900">{selectedAppointment.ticket_number}</div>
                    </div>
                  </div>
                )}

                {selectedAppointment.description && (
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-700">
                        {t('details.description')}
                      </div>
                      <div className="text-sm text-gray-900 whitespace-pre-wrap">
                        {selectedAppointment.description}
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-gray-200">
                  {selectedAppointment.created_at && (() => {
                    try {
                      const date = new Date(selectedAppointment.created_at);
                      if (!isNaN(date.getTime())) {
                        return (
                          <div className="text-xs text-gray-500">
                            {t('details.created')}: {format(date, 'MMM d, yyyy h:mm a')}
                          </div>
                        );
                      }
                    } catch {}
                    return null;
                  })()}
                  {selectedAppointment.approved_at && (() => {
                    try {
                      const date = new Date(selectedAppointment.approved_at);
                      if (!isNaN(date.getTime())) {
                        return (
                          <div className="text-xs text-gray-500 mt-1">
                            {t('details.approved')}: {format(date, 'MMM d, yyyy h:mm a')}
                          </div>
                        );
                      }
                    } catch {}
                    return null;
                  })()}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-6">
              {selectedAppointment.status === 'pending' && (
                <Button
                  id="cancel-appointment-details-button"
                  variant="destructive"
                  onClick={() => {
                    setAppointmentToCancel(selectedAppointment.appointment_request_id);
                    setSelectedAppointment(null);
                  }}
                >
                  {t('details.cancelButton')}
                </Button>
              )}
              <Button
                id="close-details-button"
                variant="outline"
                onClick={() => setSelectedAppointment(null)}
              >
                {tCommon('common.close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Cancel Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={!!appointmentToCancel}
        onClose={() => setAppointmentToCancel(null)}
        onConfirm={handleCancelAppointment}
        title={t('cancel.title')}
        message={t('cancel.message')}
        confirmLabel={t('cancel.confirm')}
        cancelLabel={tCommon('common.cancel')}
      />
    </div>
  );
}
