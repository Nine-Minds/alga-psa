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
  type DashboardMetrics,
} from '@alga-psa/client-portal/actions';
import type { Asset } from '@alga-psa/types';
import { RequestAppointmentModal } from '../appointments/RequestAppointmentModal';
import { ClientAddTicket } from '../tickets/ClientAddTicket';
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
  PlusCircle,
  LayoutTemplate,
} from 'lucide-react';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { toBrowserDate } from '../appointments/dateUtils';
import type { AppointmentSummary } from '../appointments/types';

type TranslateFn = ReturnType<typeof useTranslation>['t'];

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

function getGreeting(t: TranslateFn): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('dashboard.greeting.morning', 'Good morning');
  if (hour < 18) return t('dashboard.greeting.afternoon', 'Good afternoon');
  return t('dashboard.greeting.evening', 'Good evening');
}

function timeAgo(value: string | Date | null | undefined, t: TranslateFn, locale?: string): string {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  if (isNaN(dt.getTime())) return '';
  const diff = Date.now() - dt.getTime();
  if (diff < 60_000) return t('dashboard.timeAgo.justNow', 'just now');
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t('dashboard.timeAgo.minutes', { defaultValue: '{{count}} min ago', count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('dashboard.timeAgo.hours', { defaultValue: '{{count}} h ago', count: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 7) return t('dashboard.timeAgo.days', { defaultValue: '{{count}}d ago', count: days });
  return dt.toLocaleDateString(locale);
}

const DASHBOARD_PREVIEW_DEVICES = 4;
const DASHBOARD_PREVIEW_APPOINTMENTS = 3;

export function ClientDashboard() {
  const { t, i18n } = useTranslation('client-portal');
  const locale = i18n.language || undefined;
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentSummary[]>([]);
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
        // Action returns IAppointmentRequest joined with service_name (joined column
        // not on the typed return).
        setUpcomingAppointments(appointmentsResult.data as unknown as AppointmentSummary[]);
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
    const dt = toBrowserDate(next.requested_date, next.requested_time, next.requester_timezone);
    if (!dt) return null;
    const today = new Date();
    const sameDay = dt.toDateString() === today.toDateString();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const isTomorrow = dt.toDateString() === tomorrow.toDateString();
    if (sameDay) return t('dashboard.nextToday', 'Today');
    if (isTomorrow) return t('dashboard.nextTomorrow', 'Tomorrow');
    return dt.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }, [upcomingAppointments, t, locale]);

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

  interface KpiCard {
    id: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
    hint: string;
    description: string;
    action?: {
      id: string;
      label: string;
      onClick: () => void;
    };
  }

  const kpiCards: KpiCard[] = [
    {
      id: 'open-tickets',
      label: t('dashboard.metrics.openTickets'),
      value: metrics.openTickets ?? 0,
      icon: MessageSquare,
      href: '/client-portal/tickets',
      hint: t('dashboard.metrics.openTicketsHint', 'Active support'),
      description: t(
        'dashboard.metrics.openTicketsDescription',
        'Support tickets we are still working on.',
      ),
      action: {
        id: 'kpi-open-tickets-create',
        label: t('dashboard.quickActions.createTicket', 'Create ticket'),
        onClick: () => setIsTicketModalOpen(true),
      },
    },
    {
      id: 'active-projects',
      label: t('dashboard.metrics.activeProjects'),
      value: metrics.activeProjects ?? 0,
      icon: Layers,
      href: '/client-portal/projects',
      hint: t('dashboard.metrics.activeProjectsHint', 'In progress'),
      description: t(
        'dashboard.metrics.activeProjectsDescription',
        'Projects we are delivering for your team.',
      ),
    },
    {
      id: 'service-requests',
      label: t('dashboard.metrics.serviceRequests', 'Service requests'),
      value: metrics.serviceRequests ?? 0,
      icon: LayoutTemplate,
      href: '/client-portal/request-services',
      hint: t('dashboard.metrics.serviceRequestsHint', 'Total submissions'),
      description: t(
        'dashboard.metrics.serviceRequestsDescription',
        'Structured requests you have submitted from the catalog.',
      ),
    },
    {
      id: 'upcoming-visits',
      label: t('dashboard.metrics.upcomingVisits', 'Upcoming visits'),
      value: upcomingAppointments.length,
      icon: Calendar,
      href: '/client-portal/appointments',
      hint: nextAppointmentLabel
        ? t('dashboard.metrics.nextLabel', { defaultValue: 'Next: {{when}}', when: nextAppointmentLabel })
        : t('dashboard.metrics.noneScheduled', 'None scheduled'),
      description: t(
        'dashboard.metrics.upcomingVisitsDescription',
        'Scheduled appointments with our technicians.',
      ),
      action: {
        id: 'kpi-upcoming-visits-request',
        label: t('dashboard.quickActions.requestAppointment', 'Request appointment'),
        onClick: () => setIsAppointmentModalOpen(true),
      },
    },
    {
      id: 'active-devices',
      label: t('dashboard.metrics.activeDevices', 'Active devices'),
      value: metrics.activeAssets ?? 0,
      icon: Monitor,
      href: '/client-portal/devices',
      hint: t('dashboard.metrics.deviceStatusHint', 'Managed endpoints'),
      description: t(
        'dashboard.metrics.activeDevicesDescription',
        'Endpoints we currently manage and monitor.',
      ),
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.id}
              className="group flex flex-col rounded-xl border border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-card))] p-5 transition-shadow hover:shadow-md"
            >
              {/* Link wraps just the metric area so clicks on the action Button below
                  don't bubble up and trigger the card's navigation. */}
              <Link href={card.href} className="flex-1 block">
                <div className="flex items-start justify-between">
                  <div className="text-sm font-medium text-[rgb(var(--color-text-600))]">
                    {card.label}
                  </div>
                  <Icon className="h-4 w-4 text-[rgb(var(--color-text-500))] group-hover:text-[rgb(var(--color-primary-500))]" />
                </div>
                <div className="mt-3 text-3xl font-semibold text-[rgb(var(--color-text-900))]">
                  {card.value}
                </div>
                <div className="mt-2 text-xs font-medium text-[rgb(var(--color-text-500))]">
                  {card.hint}
                </div>
                <p className="mt-1 text-xs leading-snug text-[rgb(var(--color-text-500))]">
                  {card.description}
                </p>
              </Link>

              {card.action && (
                <div className="mt-4 pt-3 border-t border-[rgb(var(--color-border-100))]">
                  <Button
                    id={card.action.id}
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={card.action.onClick}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {card.action.label}
                  </Button>
                </div>
              )}
            </div>
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
                          <div className="text-xs text-[rgb(var(--color-text-500))] flex-shrink-0">
                            {timeAgo(activity.timestamp, t, locale)}
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
                ? t('dashboard.appointments.countLabel', { defaultValue: '{{count}} upcoming', count: upcomingAppointments.length })
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
                {upcomingAppointments.slice(0, DASHBOARD_PREVIEW_APPOINTMENTS).map((appointment) => {
                  const dt = toBrowserDate(
                    appointment.requested_date,
                    appointment.requested_time,
                    appointment.requester_timezone,
                  );
                  return (
                    <div
                      key={appointment.appointment_request_id}
                      className="flex gap-2 rounded-md border border-[rgb(var(--color-border-100))] p-2 hover:border-[rgb(var(--color-primary-300))] transition-colors"
                    >
                      <div className="flex w-12 flex-col items-center justify-center rounded bg-[rgb(var(--color-primary-50))] py-1.5 text-[rgb(var(--color-primary-700))]">
                        <div className="text-[11px] font-semibold uppercase tracking-wider">
                          {dt ? dt.toLocaleDateString(locale, { month: 'short' }) : '—'}
                        </div>
                        <div className="text-lg font-semibold leading-none">
                          {dt ? dt.getDate() : '—'}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[rgb(var(--color-text-900))]">
                          {appointment.service_name}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-[rgb(var(--color-text-600))]">
                          <Clock className="h-3 w-3" />
                          {dt
                            ? dt.toLocaleTimeString(locale, {
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

            {upcomingAppointments.length > 0 && (
              <div className="mt-3">
                <Link
                  href="/client-portal/appointments"
                  className="block text-center text-xs font-medium text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))]"
                >
                  {t('dashboard.appointments.viewAll')}
                </Link>
              </div>
            )}
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
                ? t('dashboard.devices.countLabel', { defaultValue: '{{count}} managed', count: devices.length })
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
                {devices.slice(0, DASHBOARD_PREVIEW_DEVICES).map((d) => {
                  const Icon = deviceIcon(d.asset_type);
                  const isActive = d.status !== 'inactive';
                  return (
                    <li
                      key={d.asset_id}
                      className="flex items-center gap-2 rounded-md border border-[rgb(var(--color-border-100))] p-2"
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 text-[rgb(var(--color-text-500))]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[rgb(var(--color-text-900))]">
                          {d.name}
                        </div>
                        {d.serial_number && (
                          <div className="truncate text-xs text-[rgb(var(--color-text-500))]">
                            {d.serial_number}
                          </div>
                        )}
                      </div>
                      <span
                        className={[
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-gray-100 text-gray-600',
                        ].join(' ')}
                      >
                        {isActive
                          ? t('dashboard.devices.active', 'Active')
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

      <ClientAddTicket
        open={isTicketModalOpen}
        onOpenChange={setIsTicketModalOpen}
        onTicketAdded={fetchDashboardData}
      />
    </div>
  );
}
