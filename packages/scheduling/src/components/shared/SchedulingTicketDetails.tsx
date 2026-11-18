'use client';

import React from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Flex, Heading, Text } from '@radix-ui/themes';
import type { SchedulingTicketDetailsRecord } from '../../actions/ticketLookupActions';

interface SchedulingTicketDetailsProps {
  ticket: SchedulingTicketDetailsRecord;
}

export function SchedulingTicketDetails({
  ticket,
}: SchedulingTicketDetailsProps): React.JSX.Element {
  const { t } = useTranslation('msp/schedule');
  const { formatDate } = useFormatters();

  function formatDateTime(value: Date | string | null | undefined): string {
    if (!value) return t('ticketDetails.notAvailable');
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : formatDate(date, {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  }

  return (
    <div className="h-full bg-white p-6 rounded-lg shadow-sm">
      <Flex direction="column" gap="4">
        <Heading size="6">
          {ticket.ticket_number ? t('ticketDetails.numberedTitle', { number: ticket.ticket_number }) : t('ticketDetails.title')}
        </Heading>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.title.label')}</Text>
          <Text size="2" className="block mt-1">{ticket.title || t('ticketDetails.untitled')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.description.label')}</Text>
          <Text size="2" className="block mt-1 whitespace-pre-wrap">
            {ticket.description || t('ticketDetails.noDescription')}
          </Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.status.label')}</Text>
          <Text size="2" className="block mt-1">{ticket.status || t('ticketDetails.notAvailable')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.priority.label')}</Text>
          <Text size="2" className="block mt-1">{ticket.priority || t('ticketDetails.notAvailable')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.board.label')}</Text>
          <Text size="2" className="block mt-1">{ticket.board_name || t('ticketDetails.notAvailable')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.client.label')}</Text>
          <Text size="2" className="block mt-1">{ticket.client_name || t('ticketDetails.notAvailable')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.contact.label')}</Text>
          <Text size="2" className="block mt-1">{ticket.contact_name || t('ticketDetails.notAvailable')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.assignedUser.label')}</Text>
          <Text size="2" className="block mt-1">{ticket.assigned_user_name || t('ticketDetails.unassigned')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.entered.label')}</Text>
          <Text size="2" className="block mt-1">{formatDateTime(ticket.entered_at)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.updated.label')}</Text>
          <Text size="2" className="block mt-1">{formatDateTime(ticket.updated_at)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('ticketDetails.fields.closed.label')}</Text>
          <Text size="2" className="block mt-1">{formatDateTime(ticket.closed_at)}</Text>
        </div>
      </Flex>
    </div>
  );
}
