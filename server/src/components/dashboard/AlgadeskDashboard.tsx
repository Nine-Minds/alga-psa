import Link from 'next/link';
import type { AlgadeskDashboardSummary } from '@/lib/actions/algadeskDashboardActions';

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
  return (
    <div className="min-h-screen p-6" data-automation-id="algadesk-dashboard">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">Algadesk Dashboard</h1>
          <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
            Ticket workload and email-channel health.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Open tickets" value={summary.openTickets} href="/msp/tickets?statusId=open" />
          <MetricCard title="Awaiting customer" value={summary.awaitingCustomer} href="/msp/tickets?responseState=awaiting_client" />
          <MetricCard title="Awaiting internal" value={summary.awaitingInternal} href="/msp/tickets?responseState=awaiting_internal" />
          <MetricCard title="Active email channels" value={summary.emailHealth.activeChannels} href="/msp/settings?tab=email" />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4">
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">Ticket aging</h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <MetricCard title="Under 2 days" value={summary.aging.under2Days} />
              <MetricCard title="2 to 7 days" value={summary.aging.days2To7} />
              <MetricCard title="Over 7 days" value={summary.aging.over7Days} />
            </div>
          </div>

          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4">
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">Email channel health</h2>
            <p className="mt-2 text-sm text-[rgb(var(--color-text-500))]">
              {summary.emailHealth.healthyChannels} of {summary.emailHealth.activeChannels} active channels are connected.
            </p>
            <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
              Total configured channels: {summary.emailHealth.totalChannels}
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4">
          <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">Recently updated tickets</h2>
          <ul className="mt-3 space-y-2">
            {summary.recentTickets.map((ticket) => (
              <li key={ticket.ticketId}>
                <Link className="text-sm text-[rgb(var(--color-primary-600))] hover:underline" href={`/msp/tickets/${ticket.ticketId}`}>
                  {ticket.ticketNumber}: {ticket.title}
                </Link>
              </li>
            ))}
            {summary.recentTickets.length === 0 ? (
              <li className="text-sm text-[rgb(var(--color-text-500))]">No recent ticket activity.</li>
            ) : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
