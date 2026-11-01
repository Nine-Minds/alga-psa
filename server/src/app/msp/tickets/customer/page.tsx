import type { Metadata } from 'next';
import {
  parseTicketListPresentation,
  parseTicketListScope,
  isQualifiedTicketListScope,
} from '@alga-psa/tickets/lib';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import QualifiedTicketList from '@/components/co-managed/QualifiedTicketList';
import CustomerTicketsUnavailable from '@/components/co-managed/CustomerTicketsUnavailable';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.customerTickets.title', { defaultValue: 'Customer Tickets' }) };
}

type CustomerTicketsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Customer Tickets: the qualified co-managed working/oversight list on its own
 * route, beside All Tickets. Entirely behind the release boundary (presentation
 * only; every read and write is authorized by the actions). Nothing here is
 * gated by assignment: a user with no staff assignment gets the ordinary empty
 * state from the reader, not an error.
 */
export default async function CustomerTicketsPage({ searchParams }: CustomerTicketsPageProps) {
  const params = await searchParams;
  const search = new URLSearchParams(
    Object.entries(params ?? {}).flatMap(([key, value]): [string, string][] => {
      if (value === undefined) return [];
      return Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]];
    }),
  ).toString();
  const parsed = parseTicketListScope(search);
  const scope = isQualifiedTicketListScope(parsed)
    ? parsed
    : { kind: 'qualified' as const, view: 'working' as const, workspace: 'all' as const };
  const presentation = parseTicketListPresentation(search);

  return (
    <div id="customer-tickets-page-container" className="bg-[rgb(var(--color-app-ground))]">
      <CoManagedFeatureBoundary mode="serves" fallback={<CustomerTicketsUnavailable />}>
        <QualifiedTicketList
          key={search}
          scope={scope}
          presentation={presentation}
          idPrefix="customer-tickets"
        />
      </CoManagedFeatureBoundary>
    </div>
  );
}
