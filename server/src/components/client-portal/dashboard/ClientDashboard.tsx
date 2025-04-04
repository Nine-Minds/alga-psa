'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { getDashboardMetrics, getRecentActivity, type RecentActivity } from 'server/src/lib/actions/client-portal-actions/dashboard';
import { ClientAddTicket } from 'server/src/components/client-portal/tickets/ClientAddTicket';

export function ClientDashboard() {
  const [isTicketDialogOpen, setIsTicketDialogOpen] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    const fetchDashboardData = async () => {
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
    };

    fetchDashboardData();
  }, []);

  if (error) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-8">
            <div className="text-center text-[rgb(var(--color-text-700))]">
              <p>There was an error loading the dashboard. Please try again later.</p>
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
          <CardContent className="p-8">
            <div className="text-center text-[rgb(var(--color-text-700))]">
              <p>Loading dashboard...</p>
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
        <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">Dashboard</h1>
        <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">
          Welcome back! Here's an overview of your account.
        </p>
      </div>

      {/* Metrics Overview */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
        <Card className="bg-white">
          <CardContent className="p-8">
            <div className="text-lg font-medium text-[rgb(var(--color-text-600))] truncate">
              Open Support Tickets
            </div>
            <div className="mt-2 text-4xl font-bold text-[rgb(var(--color-primary-500))]">
              {metrics.openTickets}
            </div>
            <div className="mt-4">
              <a href="/client-portal/tickets" className="text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))] text-sm font-medium">
                View all tickets →
              </a>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardContent className="p-8">
            <div className="text-lg font-medium text-[rgb(var(--color-text-600))] truncate">
              Open Projects
            </div>
            <div className="mt-2 text-4xl font-bold text-[rgb(var(--color-primary-500))]">
              {metrics.activeProjects}
            </div>
            <div className="mt-4">
              <a href="/client-portal/projects" className="text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))] text-sm font-medium">
                View all projects →
              </a>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardContent className="p-8">
            <div className="text-lg font-medium text-[rgb(var(--color-text-600))] truncate">
              Pending Invoices
            </div>
            <div className="mt-2 text-4xl font-bold text-[rgb(var(--color-secondary-500))]">
              {metrics.pendingInvoices}
            </div>
            <div className="mt-4">
              <a href="/client-portal/billing" className="text-[rgb(var(--color-secondary-500))] hover:text-[rgb(var(--color-secondary-600))] text-sm font-medium">
                View billing →
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
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
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
                      <p className={`text-sm ${textColor}`}>
                        {activity.title}
                      </p>
                      <p className={`mt-1 text-xs ${timeColor}`}>
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Button
              id="create-ticket-button"
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] px-6 py-3"
              onClick={() => setIsTicketDialogOpen(true)}
            >
              Create Support Ticket
            </Button>
            <ClientAddTicket 
              open={isTicketDialogOpen} 
              onOpenChange={setIsTicketDialogOpen} 
            />
            <Button
              id="view-invoice-button"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background relative bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))] hover:bg-[rgb(var(--color-primary-200))] h-10 py-2 px-4 group"
            >
              View Latest Invoice
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
