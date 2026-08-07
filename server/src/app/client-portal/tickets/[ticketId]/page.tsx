import React from 'react';
import { cache } from 'react';
import { getClientTicketDetails } from '@alga-psa/client-portal/actions';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { TicketDetailsContainer } from '@alga-psa/client-portal/components';
import logger from '@alga-psa/core/logger';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

const getCachedTicket = cache((id: string) => getClientTicketDetails(id));
const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface TicketPageProps {
  params: Promise<{
    ticketId: string;
  }>;
}

export async function generateMetadata({ params }: TicketPageProps): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  try {
    const { ticketId } = await params;
    const ticket = await getCachedTicket(ticketId);
    if (ticket && !isReturnedActionError(ticket)) {
      return {
        title: t('clientPortal.tickets.detail.title', {
          ticketNumber: ticket.ticket_number,
          ticketTitle: ticket.title,
          defaultValue: 'Ticket #{{ticketNumber}} - {{ticketTitle}}',
        }),
      };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch ticket title:', error);
  }
  return {
    title: t('clientPortal.tickets.detail.fallbackTitle', { defaultValue: 'Ticket Details' }),
  };
}

export default async function TicketPage({ params }: TicketPageProps) {
  const resolvedParams = await params;
  const { ticketId } = resolvedParams;
  const { t } = await getServerTranslation(undefined, 'features/tickets');

  try {
    const ticketData = await getCachedTicket(ticketId);
    if (isReturnedActionError(ticketData)) {
      const message = getErrorMessage(ticketData);
      logger.warn('[ClientPortal] Ticket details returned action error', {
        ticketId,
        error: message
      });

      return (
        <Alert id="ticket-error-message" variant="destructive">
          <AlertDescription>
            {t('messages.errorWithMessage', { message, defaultValue: 'Error: {{message}}' })}
          </AlertDescription>
        </Alert>
      );
    }

    const statuses = await getTicketStatuses(ticketData.board_id);
    const productCode = await getCurrentTenantProduct();

    return (
      <div className="w-full">
        <TicketDetailsContainer
          ticketId={ticketId}
          ticketData={ticketData}
          statuses={statuses}
          productCode={productCode}
        />
      </div>
    );
  } catch (error) {
    logger.error('[ClientPortal] Failed to fetch ticket details', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return (
      <Alert id="ticket-error-message" variant="destructive">
        <AlertDescription>
          {t('messages.errorWithMessage', {
            message: error instanceof Error
              ? error.message
              : t('messages.loadError', { defaultValue: 'Failed to load ticket details' }),
            defaultValue: 'Error: {{message}}',
          })}
        </AlertDescription>
      </Alert>
    );
  }
}

export const dynamic = "force-dynamic";
