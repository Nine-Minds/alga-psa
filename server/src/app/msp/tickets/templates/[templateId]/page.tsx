import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { MspTicketTemplateEditor } from '@alga-psa/msp-composition/tickets/MspTicketTemplates';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.templates.title', { defaultValue: 'Ticket templates' }),
  };
}

interface TicketTemplateRouteProps {
  params: Promise<{ templateId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `new` creates a template (optionally prefilled `?fromTicket=<id>`); anything else must be a template
 * id, so a malformed segment is a 404 rather than a failed query.
 */
export default async function TicketTemplateRoute({ params, searchParams }: TicketTemplateRouteProps) {
  const { templateId } = await params;
  if (templateId !== 'new' && !UUID_PATTERN.test(templateId)) {
    notFound();
  }
  const resolved = (await searchParams) ?? {};
  const rawFromTicket = Array.isArray(resolved.fromTicket) ? resolved.fromTicket[0] : resolved.fromTicket;
  const fromTicketId = templateId === 'new' && rawFromTicket && UUID_PATTERN.test(rawFromTicket) ? rawFromTicket : undefined;
  return <MspTicketTemplateEditor templateId={templateId} fromTicketId={fromTicketId} />;
}
