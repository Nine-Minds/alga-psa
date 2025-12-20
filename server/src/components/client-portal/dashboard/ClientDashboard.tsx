'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { getDashboardMetrics, getRecentActivity, type RecentActivity } from 'server/src/lib/actions/client-portal-actions/dashboard';
import { getMyAppointmentRequests } from 'server/src/lib/actions/client-portal-actions/appointmentRequestActions';
import { ClientAddTicket } from 'server/src/components/client-portal/tickets/ClientAddTicket';
import { RequestAppointmentModal } from 'server/src/components/client-portal/appointments/RequestAppointmentModal';
import { useTranslation } from 'server/src/lib/i18n/client';
import { Badge } from 'server/src/components/ui/Badge';
import { Calendar, Clock } from 'lucide-react';
import { format } from 'date-fns';

// Flag to control visibility of the recent activity section
const SHOW_RECENT_ACTIVITY = false;

interface AppointmentRequest {
  appointment_request_id: string;
  service_name: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  preferred_assigned_user_name?: string;
}

export function ClientDashboard() {
  const router = useRouter();
  const { t } = useTranslation('clientPortal');
  const [isTicketDialogOpen, setIsTicketDialogOpen] = useState(false);
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRequest[]>([]);
  const [error, setError] = useState<boolean>(false);

  const fetchDashboardData = useCallback(async () => {
    setError(false);
    try {
      const [metricsData, activitiesData, appointmentsResult] = await Promise.all([
        getDashboardMetrics(),
        getRecentActivity(),
        getMyAppointmentRequests({ status: 'approved' })
      ]);
      setMetrics(metricsData);
      setActivities(activitiesData);

      if (appointmentsResult.success && appointmentsResult.data) {
        // Show only upcoming appointments (approved status)
        setUpcomingAppointments(appointmentsResult.data as any);
      } else {
        setUpcomingAppointments([]);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  if (error) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-8 pt-8">
            <div className="text-center text-[rgb(var(--color-text-700))]">
              <p>{t('dashboard.error')}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-8 pt-8">
            <div className="text-center text-[rgb(var(--color-text-700))]">
              <p>{t('dashboard.loading')}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">
          {t('dashboard.welcome')}
        </p>
      </div>

      {/* Metrics Overview */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
        <Card className="bg-white">
          <CardContent className="p-8 pt-8">
            <div className="text-lg font-medium text-[rgb(var(--color-text-600))] truncate">
              {t('dashboard.metrics.openTickets')}
            </div>
            <div className="mt-2 text-4xl font-bold text-[rgb(var(--color-primary-500))]">
              {metrics.openTickets}
            </div>
            <div className="mt-4">
              <a href="/client-portal/tickets" className="text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))] text-sm font-medium">
                {t('dashboard.viewAll', { item: t('nav.tickets').toLowerCase() })}
              </a>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardContent className="p-8 pt-8">
            <div className="text-lg font-medium text-[rgb(var(--color-text-600))] truncate">
              {t('dashboard.metrics.activeProjects')}
            </div>
            <div className="mt-2 text-4xl font-bold text-[rgb(var(--color-primary-500))]">
              {metrics.activeProjects}
            </div>
            <div className="mt-4">
              <a href="/client-portal/projects" className="text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))] text-sm font-medium">
                {t('dashboard.viewAll', { item: t('nav.projects').toLowerCase() })}
              </a>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardContent className="p-8 pt-8">
            <div className="text-lg font-medium text-[rgb(var(--color-text-600))] truncate">
              {t('dashboard.metrics.pendingInvoices')}
            </div>
            <div className="mt-2 text-4xl font-bold text-[rgb(var(--color-secondary-500))]">
              {metrics.pendingInvoices}
            </div>
            <div className="mt-4">
              <a href="/client-portal/billing" className="text-[rgb(var(--color-secondary-500))] hover:text-[rgb(var(--color-secondary-600))] text-sm font-medium">
                {t('dashboard.viewAll', { item: t('nav.billing').toLowerCase() })}
              </a>
            </div>
          </CardContent>
        </Card>

        {/*
        <Card className="bg-white">
          <CardContent className="p-8">
            <div className="text-lg font-medium text-[rgb(var(--color-text-600))] truncate">
              Active Assets
            </div>
            <div className="mt-2 text-4xl font-bold text-[rgb(var(--color-accent-500))]">
              {metrics.activeAssets}
            </div>
            <div className="mt-4">
              <a href="/client-portal/assets" className="text-[rgb(var(--color-accent-500))] hover:text-[rgb(var(--color-accent-600))] text-sm font-medium">
                View assets →
              </a>
            </div>
          </CardContent>
        </Card>
        */}
      </div>

      {/* Recent Activity */}
      {SHOW_RECENT_ACTIVITY && (
        <Card className="bg-white">
          <CardHeader>
            <CardTitle>{t('dashboard.recentActivity.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              {activities.map((activity: RecentActivity, index: number): React.JSX.Element => {
                let borderColor = 'border-[rgb(var(--color-primary-500))]';
                let bgColor = 'bg-[rgb(var(--color-primary-50))]';
                let textColor = 'text-[rgb(var(--color-primary-700))]';
                let timeColor = 'text-[rgb(var(--color-primary-500))]';

              if (activity.type === 'invoice') {
                borderColor = 'border-[rgb(var(--color-secondary-400))]';
                bgColor = 'bg-[rgb(var(--color-secondary-50))]';
                textColor = 'text-[rgb(var(--color-secondary-700))]';
                timeColor = 'text-[rgb(var(--color-secondary-500))]';
              } else if (activity.type === 'asset') {
                borderColor = 'border-[rgb(var(--color-accent-500))]';
                bgColor = 'bg-[rgb(var(--color-accent-50))]';
                textColor = 'text-[rgb(var(--color-accent-700))]';
                timeColor = 'text-[rgb(var(--color-accent-500))]';
              }

                return (
                  <div
                    key={`${activity.type}-${index}`}
                    className={`border-l-4 ${borderColor} ${bgColor} p-4 rounded-r-lg`}
                  >
                    <div className="flex">
                      <div className="ml-3">
                        <p className={`text-sm ${textColor}`}>{activity.title}</p>
                        <p className={`mt-1 text-xs ${timeColor}`}>{new Date(activity.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Appointments */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>{t('dashboard.appointments.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingAppointments.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-sm text-gray-600 mb-4">
                {t('dashboard.appointments.noUpcoming')}
              </p>
              <Button
                id="dashboard-request-appointment-button"
                variant="default"
                size="sm"
                onClick={() => setIsAppointmentModalOpen(true)}
              >
                {t('dashboard.appointments.requestButton')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingAppointments.map((appointment) => (
                <div
                  key={appointment.appointment_request_id}
                  className="p-4 border border-gray-200 rounded-lg hover:border-[rgb(var(--color-primary-300))] transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-medium text-gray-900">{appointment.service_name}</h4>
                        {appointment.status === 'approved' ? (
                          <Badge variant="success">{t('appointments.status.approved')}</Badge>
                        ) : appointment.status === 'pending' ? (
                          <Badge variant="warning">{t('appointments.status.pending')}</Badge>
                        ) : (
                          <Badge variant="default">{t(`appointments.status.${appointment.status}`)}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {(() => {
                            try {
                              if (!appointment.requested_date) return 'N/A';
                              const date = new Date(appointment.requested_date + 'T00:00:00Z');
                              if (isNaN(date.getTime())) return 'N/A';
                              return format(date, 'MMM d, yyyy');
                            } catch {
                              return 'N/A';
                            }
                          })()}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {appointment.requested_time ? `${appointment.requested_time} UTC` : 'N/A'}
                        </div>
                      </div>
                      {appointment.preferred_assigned_user_name && (
                        <div className="text-sm text-gray-500 mt-1">
                          {t('dashboard.appointments.technician')}: {appointment.preferred_assigned_user_name}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="pt-2">
                <a
                  href="/client-portal/appointments"
                  className="text-sm text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))] font-medium"
                >
                  {t('dashboard.appointments.viewAll')}
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>{t('dashboard.quickActions.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Button
              id="create-ticket-button"
              variant="default"
              onClick={() => setIsTicketDialogOpen(true)}
            >
              {t('dashboard.quickActions.createTicket')}
            </Button>
            <ClientAddTicket
              open={isTicketDialogOpen}
              onOpenChange={setIsTicketDialogOpen}
              onTicketAdded={fetchDashboardData}
            />
            <Button
              id="request-appointment-button"
              variant="default"
              onClick={() => setIsAppointmentModalOpen(true)}
            >
              {t('dashboard.quickActions.requestAppointment')}
            </Button>
            <RequestAppointmentModal
              open={isAppointmentModalOpen}
              onOpenChange={setIsAppointmentModalOpen}
              onAppointmentRequested={fetchDashboardData}
            />
            <Button
              id="view-invoice-button"
              variant="soft"
              onClick={() => router.push('/client-portal/billing')}
            >
              {t('dashboard.quickActions.viewLatestInvoice')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
