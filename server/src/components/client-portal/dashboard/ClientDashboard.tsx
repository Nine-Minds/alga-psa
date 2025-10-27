'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { getDashboardMetrics, getRecentActivity, type RecentActivity } from '@product/actions/client-portal-actions/dashboard';
import { ClientAddTicket } from 'server/src/components/client-portal/tickets/ClientAddTicket';
import { useTranslation } from 'server/src/lib/i18n/client';

// Flag to control visibility of the recent activity section
const SHOW_RECENT_ACTIVITY = false;

export function ClientDashboard() {
  const router = useRouter();
  const { t } = useTranslation('clientPortal');
  const [isTicketDialogOpen, setIsTicketDialogOpen] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [error, setError] = useState<boolean>(false);

  const fetchDashboardData = useCallback(async () => {
    setError(false);
    try {
      const [metricsData, activitiesData] = await Promise.all([
        getDashboardMetrics(),
          getRecentActivity()
        ]);
        setMetrics(metricsData);
      setActivities(activitiesData);
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
              {activities.map((activity: RecentActivity, index: number): JSX.Element => {
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
