'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import {
  getDashboardMetrics,
  getMyAppointmentRequests,
  getRecentActivity,
  getClientAssets,
  type RecentActivity,
} from '@alga-psa/client-portal/actions';
import type { Asset } from '@alga-psa/types';
import { RequestAppointmentModal } from '../appointments/RequestAppointmentModal';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  Calendar,
  Clock,
  MessageSquare,
  Layers,
  Monitor,
  ArrowRight,
  Receipt,
  Wrench,
  Server,
  Smartphone,
  Printer,
  Network,
  HardDrive,
  Activity as ActivityIcon,
} from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

function normalizeDateValue(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

function normalizeTimeValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 5);
  return null;
}

interface AppointmentRequest {
  appointment_request_id: string;
  service_name: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  requester_timezone?: string | null;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  preferred_assigned_user_name?: string;
}

function activityVisuals(type: RecentActivity['type']): {
  Icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconText: string;
} {
  switch (type) {
    case 'invoice':
      return {
        Icon: Receipt,
        iconBg: 'bg-amber-50',
        iconText: 'text-amber-600',
      };
    case 'asset':
      return {
        Icon: Wrench,
        iconBg: 'bg-emerald-50',
        iconText: 'text-emerald-600',
      };
    case 'ticket':
    default:
      return {
        Icon: MessageSquare,
        iconBg: 'bg-[rgb(var(--color-primary-50))]',
        iconText: 'text-[rgb(var(--color-primary-600))]',
      };
  }
}

function deviceIcon(type: Asset['asset_type']): React.ComponentType<{ className?: string }> {
  switch (type) {
    case 'workstation':
      return Monitor;
    case 'server':
      return Server;
    case 'mobile_device':
      return Smartphone;
    case 'printer':
      return Printer;
    case 'network_device':
      return Network;
    default:
      return HardDrive;
  }
}

function getGreeting(t: any): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('dashboard.greeting.morning', 'Good morning');
  if (hour < 18) return t('dashboard.greeting.afternoon', 'Good afternoon');
  return t('dashboard.greeting.evening', 'Good evening');
}

function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  const diff = Date.now() - dt.getTime();
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return dt.toLocaleDateString();
}

export function ClientDashboard() {
  const { t } = useTranslation('client-portal');
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRequest[]>([]);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [devices, setDevices] = useState<Asset[]>([]);
  const [firstName, setFirstName] = useState<string>('');
  const [error, setError] = useState<boolean>(false);

  const fetchDashboardData = useCallback(async () => {
    setError(false);
    try {
      const [user, metricsData, appointmentsResult, activityData, devicesData] = await Promise.all([
        getCurrentUser(),
        getDashboardMetrics(),
        getMyAppointmentRequests({ status: 'approved' }),
        getRecentActivity().catch(() => [] as RecentActivity[]),
        getClientAssets().catch(() => [] as Asset[]),
      ]);
      setFirstName(user?.first_name || '');
      setMetrics(metricsData);

      if (appointmentsResult.success && appointmentsResult.data) {
        setUpcomingAppointments(appointmentsResult.data as any);
      } else {
        setUpcomingAppointments([]);
      }

      setActivities(activityData || []);
      setDevices(devicesData || []);
    } catch (err) {
      console.error('Error loading dashboard:', err);
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const nextAppointmentLabel = useMemo(() => {
    const next = upcomingAppointments[0];
    if (!next) return null;
    const dateStr = normalizeDateValue(next.requested_date);
    const timeStr = normalizeTimeValue(next.requested_time);
    if (!dateStr || !timeStr) return null;
    try {
      const tz = next.requester_timezone || 'UTC';
      const dt = fromZonedTime(`${dateStr}T${timeStr}:00`, tz);
      if (isNaN(dt.getTime())) return null;
      const today = new Date();
      const sameDay = dt.toDateString() === today.toDateString();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const isTomorrow = dt.toDateString() === tomorrow.toDateString();
      if (sameDay) return t('dashboard.nextToday', 'Today');
      if (isTomorrow) return t('dashboard.nextTomorrow', 'Tomorrow');
      return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return null;
    }
  }, [upcomingAppointments, t]);

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

  const greeting = getGreeting(t);

  const kpiCards = [
    {
      id: 'open-tickets',
      label: t('dashboard.metrics.openTickets'),
      value: metrics.openTickets ?? 0,
      icon: MessageSquare,
      href: '/client-portal/tickets',
      hint: t('dashboard.metrics.openTicketsHint', 'Active support'),
    },
    {
      id: 'active-projects',
      label: t('dashboard.metrics.activeProjects'),
      value: metrics.activeProjects ?? 0,
      icon: Layers,
      href: '/client-portal/projects',
      hint: t('dashboard.metrics.activeProjectsHint', 'In progress'),
    },
    {
      id: 'upcoming-visits',
      label: t('dashboard.metrics.upcomingVisits', 'Upcoming visits'),
      value: upcomingAppointments.length,
      icon: Calendar,
      href: '/client-portal/appointments',
      hint: nextAppointmentLabel
        ? t('dashboard.metrics.nextLabel', 'Next: {{when}}').replace('{{when}}', nextAppointmentLabel)
        : t('dashboard.metrics.noneScheduled', 'None scheduled'),
    },
    {
      id: 'active-devices',
      label: t('dashboard.metrics.activeDevices', 'Active devices'),
      value: metrics.activeAssets ?? 0,
      icon: Monitor,
      href: '/client-portal/devices',
      hint: t('dashboard.metrics.deviceStatusHint', 'Managed endpoints'),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[rgb(var(--color-primary-500))] to-[rgb(var(--color-primary-700))] px-8 py-7 text-white shadow-sm">
        <div className="relative z-10 max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-wider text-white/80">
            {t('dashboard.welcomeBack', 'Welcome back')}
          </div>
          <h2 className="mt-1 text-2xl font-semibold">
            {greeting}{firstName ? `, ${firstName}` : ''}! <span aria-hidden>👋</span>
          </h2>
          <p className="mt-2 text-sm text-white/85">
            {t('dashboard.heroSubtitle', "Here's a snapshot of your IT support activity. Our team is standing by to help you stay productive.")}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.id}
              href={card.href}
              className="group rounded-xl border border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-card))] p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="text-sm font-medium text-[rgb(var(--color-text-600))]">
                  {card.label}
                </div>
                <Icon className="h-4 w-4 text-[rgb(var(--color-text-500))] group-hover:text-[rgb(var(--color-primary-500))]" />
              </div>
              <div className="mt-3 text-3xl font-semibold text-[rgb(var(--color-text-900))]">
                {card.value}
              </div>
              <div className="mt-2 text-xs text-[rgb(var(--color-text-500))]">
                {card.hint}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Activity + side rail (Schedule + Devices) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {/* Recent activity timeline */}
        <Card className="bg-[rgb(var(--color-card))] lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ActivityIcon className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
                  <CardTitle>{t('dashboard.activity.title', 'Recent activity')}</CardTitle>
                </div>
                <div className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
                  {activities.length > 0
                    ? t('dashboard.activity.subtitle', 'Latest updates across your account')
                    : t('dashboard.activity.empty', 'No recent activity yet')}
                </div>
              </div>
              <Link
                href="/client-portal/tickets"
                className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))]"
              >
                {t('dashboard.activity.viewTickets', 'View all tickets')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {activities.length === 0 ? (
              <div className="px-6 pb-6 text-sm text-[rgb(var(--color-text-500))]">
                {t('dashboard.activity.emptyHint', 'When tickets are updated or invoices arrive, you will see them here.')}
              </div>
            ) : (
              <ol className="relative space-y-0">
                {activities.map((activity, idx) => {
                  const visuals = activityVisuals(activity.type);
                  const Icon = visuals.Icon;
                  return (
                    <li
                      key={`${activity.type}-${idx}`}
                      className="flex gap-3 px-6 py-3 border-b border-[rgb(var(--color-border-100))] last:border-0"
                    >
                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${visuals.iconBg}`}>
                        <Icon className={`h-4 w-4 ${visuals.iconText}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="text-sm font-medium text-[rgb(var(--color-text-900))] truncate">
                            {activity.title}
                          </div>
                          <div className="text-[11px] text-[rgb(var(--color-text-500))] flex-shrink-0">
                            {timeAgo(activity.timestamp)}
                          </div>
                        </div>
                        {activity.description && (
                          <div className="mt-0.5 text-xs text-[rgb(var(--color-text-600))] line-clamp-2">
                            {activity.description}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Side rail: Schedule + Devices stacked */}
        <div className="lg:col-span-1 space-y-4">
        <Card className="bg-[rgb(var(--color-card))]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
              <CardTitle>{t('dashboard.appointments.title')}</CardTitle>
            </div>
            <div className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
              {upcomingAppointments.length > 0
                ? t('dashboard.appointments.countLabel', '{{count}} upcoming').replace('{{count}}', String(upcomingAppointments.length))
                : t('dashboard.appointments.noUpcomingShort', 'Nothing on the calendar')}
            </div>
          </CardHeader>
          <CardContent>
            {upcomingAppointments.length === 0 ? (
              <p className="text-xs text-[rgb(var(--color-text-600))]">
                {t('dashboard.appointments.noUpcoming')}
              </p>
            ) : (
              <div className="space-y-2">
                {upcomingAppointments.slice(0, 3).map((appointment) => {
                  const dateStr = normalizeDateValue(appointment.requested_date);
                  const timeStr = normalizeTimeValue(appointment.requested_time);
                  let dt: Date | null = null;
                  if (dateStr && timeStr) {
                    try {
                      const tz = appointment.requester_timezone || 'UTC';
                      const parsed = fromZonedTime(`${dateStr}T${timeStr}:00`, tz);
                      if (!isNaN(parsed.getTime())) dt = parsed;
                    } catch {
                      /* noop */
                    }
                  }
                  return (
                    <div
                      key={appointment.appointment_request_id}
                      className="flex gap-2 rounded-md border border-[rgb(var(--color-border-100))] p-2 hover:border-[rgb(var(--color-primary-300))] transition-colors"
                    >
                      <div className="flex w-10 flex-col items-center justify-center rounded bg-[rgb(var(--color-primary-50))] py-1 text-[rgb(var(--color-primary-700))]">
                        <div className="text-[9px] font-semibold uppercase tracking-wider">
                          {dt ? dt.toLocaleDateString(undefined, { month: 'short' }) : '—'}
                        </div>
                        <div className="text-base font-semibold leading-none">
                          {dt ? dt.getDate() : '—'}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-[rgb(var(--color-text-900))]">
                          {appointment.service_name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[rgb(var(--color-text-600))]">
                          <Clock className="h-2.5 w-2.5" />
                          {dt
                            ? dt.toLocaleTimeString(undefined, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'N/A'}
                          <span>· {appointment.requested_duration}m</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3 space-y-1.5">
              <Button
                id="dashboard-request-appointment-quick"
                variant="default"
                size="sm"
                className="w-full"
                onClick={() => setIsAppointmentModalOpen(true)}
              >
                {t('dashboard.appointments.requestButton')}
              </Button>
              {upcomingAppointments.length > 0 && (
                <Link
                  href="/client-portal/appointments"
                  className="block text-center text-xs font-medium text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))]"
                >
                  {t('dashboard.appointments.viewAll')}
                </Link>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Devices preview */}
        <Card className="bg-[rgb(var(--color-card))]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                <CardTitle>{t('dashboard.devices.title', 'Your devices')}</CardTitle>
              </div>
              <Link
                href="/client-portal/devices"
                className="text-xs font-medium text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))]"
              >
                {t('dashboard.devices.viewAll', 'View all')}
              </Link>
            </div>
            <div className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
              {devices.length > 0
                ? t('dashboard.devices.countLabel', '{{count}} managed').replace('{{count}}', String(devices.length))
                : t('dashboard.devices.emptyShort', 'No devices yet')}
            </div>
          </CardHeader>
          <CardContent>
            {devices.length === 0 ? (
              <p className="text-xs text-[rgb(var(--color-text-600))]">
                {t('dashboard.devices.emptyBody', 'Devices your provider manages will appear here.')}
              </p>
            ) : (
              <ul className="space-y-2">
                {devices.slice(0, 4).map((d) => {
                  const Icon = deviceIcon(d.asset_type);
                  const healthy = d.status !== 'inactive';
                  return (
                    <li
                      key={d.asset_id}
                      className="flex items-center gap-2 rounded-md border border-[rgb(var(--color-border-100))] p-2"
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 text-[rgb(var(--color-text-500))]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-[rgb(var(--color-text-900))]">
                          {d.name}
                        </div>
                        {d.serial_number && (
                          <div className="truncate text-[10px] text-[rgb(var(--color-text-500))]">
                            {d.serial_number}
                          </div>
                        )}
                      </div>
                      <span
                        className={[
                          'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          healthy
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-gray-100 text-gray-600',
                        ].join(' ')}
                      >
                        {healthy
                          ? t('dashboard.devices.healthy', 'Healthy')
                          : t('dashboard.devices.inactive', 'Inactive')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        </div>
      </div>

      <RequestAppointmentModal
        open={isAppointmentModalOpen}
        onOpenChange={setIsAppointmentModalOpen}
        onAppointmentRequested={fetchDashboardData}
      />
    </div>
  );
}
