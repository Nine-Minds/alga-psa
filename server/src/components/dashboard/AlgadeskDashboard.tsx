'use client';

import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { AlgadeskDashboardSummary } from '@/lib/actions/algadeskDashboardActions';
import WelcomeBanner from '@/components/dashboard/WelcomeBanner';
import { useTier } from '@/context/TierContext';

interface AlgadeskDashboardProps {
  summary: AlgadeskDashboardSummary;
}

function MetricCard({ title, value, href }: { title: string; value: number; href?: string }) {
  const content = (
    <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4">
      <p className="text-sm text-[rgb(var(--color-text-500))]">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-[rgb(var(--color-text-900))]">{value}</p>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

export default function AlgadeskDashboard({ summary }: AlgadeskDashboardProps) {
  const { t } = useTranslation('msp/dashboard');
  const { eeEnabled } = useTier();

  return (
    <div className="min-h-screen p-6" data-automation-id="algadesk-dashboard">
      <div className="mx-auto max-w-7xl space-y-6">
        <WelcomeBanner
          variant={eeEnabled ? 'gradient' : 'plain'}
          title={t('algadesk.welcome.title', { defaultValue: 'Welcome to AlgaDesk' })}
          description={t('algadesk.welcome.description', {
            defaultValue:
              'Track ticket workload, monitor email-channel health, and stay on top of every conversation.',
          })}
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title={t('algadesk.metrics.openTickets', { defaultValue: 'Open tickets' })}
            value={summary.openTickets}
            href="/msp/tickets?statusId=open"
          />
          <MetricCard
            title={t('algadesk.metrics.awaitingCustomer', { defaultValue: 'Awaiting customer' })}
            value={summary.awaitingCustomer}
            href="/msp/tickets?responseState=awaiting_client"
          />
          <MetricCard
            title={t('algadesk.metrics.awaitingInternal', { defaultValue: 'Awaiting internal' })}
            value={summary.awaitingInternal}
            href="/msp/tickets?responseState=awaiting_internal"
          />
          <MetricCard
            title={t('algadesk.metrics.activeEmailChannels', { defaultValue: 'Active email channels' })}
            value={summary.emailHealth.activeChannels}
            href="/msp/settings?tab=email"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4">
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
              {t('algadesk.aging.title', { defaultValue: 'Ticket aging' })}
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <MetricCard
                title={t('algadesk.aging.under2Days', { defaultValue: 'Under 2 days' })}
                value={summary.aging.under2Days}
              />
              <MetricCard
                title={t('algadesk.aging.days2To7', { defaultValue: '2 to 7 days' })}
                value={summary.aging.days2To7}
              />
              <MetricCard
                title={t('algadesk.aging.over7Days', { defaultValue: 'Over 7 days' })}
                value={summary.aging.over7Days}
              />
            </div>
          </div>

          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4">
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
              {t('algadesk.emailHealth.title', { defaultValue: 'Email channel health' })}
            </h2>
            <p className="mt-2 text-sm text-[rgb(var(--color-text-500))]">
              {t('algadesk.emailHealth.summary', {
                defaultValue: '{{healthy}} of {{active}} active channels are connected.',
                healthy: summary.emailHealth.healthyChannels,
                active: summary.emailHealth.activeChannels,
              })}
            </p>
            <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
              {t('algadesk.emailHealth.totalConfigured', {
                defaultValue: 'Total configured channels: {{total}}',
                total: summary.emailHealth.totalChannels,
              })}
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4">
          <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
            {t('algadesk.recentTickets.title', { defaultValue: 'Recently updated tickets' })}
          </h2>
          <ul className="mt-3 space-y-2">
            {summary.recentTickets.map((ticket) => (
              <li key={ticket.ticketId}>
                <Link className="text-sm text-[rgb(var(--color-primary-600))] hover:underline" href={`/msp/tickets/${ticket.ticketId}`}>
                  {ticket.ticketNumber}: {ticket.title}
                </Link>
              </li>
            ))}
            {summary.recentTickets.length === 0 ? (
              <li className="text-sm text-[rgb(var(--color-text-500))]">
                {t('algadesk.recentTickets.empty', { defaultValue: 'No recent ticket activity.' })}
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
