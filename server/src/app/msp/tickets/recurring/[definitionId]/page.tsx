import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { MspRecurringTicketEditor } from '@alga-psa/msp-composition/tickets/MspRecurringTickets';
import { getCurrentTenantProduct } from '@/lib/productAccess';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.recurring.title', { defaultValue: 'Recurring tickets' }),
  };
}

interface RecurringTicketRouteProps {
  params: Promise<{ definitionId: string }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `new` creates a definition; anything else must be a definition id (a malformed segment is a 404, not a failed query). */
export default async function RecurringTicketRoute({ params }: RecurringTicketRouteProps) {
  const { definitionId } = await params;
  if (definitionId !== 'new' && !UUID_PATTERN.test(definitionId)) {
    notFound();
  }
  const productCode = await getCurrentTenantProduct();
  return <MspRecurringTicketEditor definitionId={definitionId} isAlgaDeskMode={productCode === 'algadesk'} />;
}
