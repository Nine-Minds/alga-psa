'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import MspTicketDetailsContainerClient from '@alga-psa/msp-composition/tickets/MspTicketDetailsContainerClient';
import { composeTicketDataSource, type TicketRefreshMode } from '@alga-psa/tickets/lib/ticketDataSource';
import { TicketDataSourceProvider } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getSharedTicketDetailsAction } from '@/lib/actions/coManagedSharedWorkActions';
import { getCoManagedTicketConversationScreenAction } from '@/lib/actions/coManagedTicketConversationActions';
import { loadSharedConversation, type SharedConversationSnapshot } from '@/lib/co-managed/loadSharedConversation';
import { buildSharedTicketScreenData, mapConversationItem } from '@/lib/co-managed/sharedTicketMapping';
import type { SharedTicketDetailsResult } from '@/lib/co-managed/sharedTicketDataTypes';
import CoManagedThreadDisclosure from './CoManagedThreadDisclosure';
import { createSharedTicketDataSource } from './sharedTicketDataSource';
import { useCoManagedSharedTimeConfig } from './useCoManagedSharedTimeConfig';
import { DEFAULT_CUSTOMER_TICKETS_HREF } from '@/lib/co-managed/ticketListReturn';

export const CO_MANAGED_TICKETS_HREF = DEFAULT_CUSTOMER_TICKETS_HREF;

type Disclosure = {
  thread: { storeTenant: string; threadId: string }; actor: { tenant: string; userId: string }; audiences: CommentAudience[];
  settle: () => void; cancel: () => void;
};

/**
 * The native ticket screen for a shared (customer-tenant) ticket, composed
 * from the MSP ticket details container over a shared TicketDataSource.
 * `initialDetails` is null when the server could not load the ticket (not
 * shared with this user, revoked, or unavailable).
 */
export default function SharedTicketScreen({ resource, initialDetails, backHref = CO_MANAGED_TICKETS_HREF }: {
  resource: CoManagedSharedResource;
  initialDetails: SharedTicketDetailsResult | null;
  backHref?: string;
}) {
  const { t } = useTranslation('msp/licensing');
  const { data: session } = useSession();
  const [details, setDetails] = useState(initialDetails);
  const [conversation, setConversation] = useState<SharedConversationSnapshot | null>(null);
  const [failed, setFailed] = useState(initialDetails === null);
  const [version, setVersion] = useState(0);
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);

  const load = useCallback(async (refetchDetails: boolean) => {
    try {
      const [nextDetails, nextConversation] = await Promise.all([
        refetchDetails ? getSharedTicketDetailsAction(resource) : Promise.resolve(null),
        loadSharedConversation(before => getCoManagedTicketConversationScreenAction(resource, before)),
      ]);
      if (nextDetails) setDetails(nextDetails);
      setConversation(nextConversation);
      setFailed(false);
      setVersion(value => value + 1);
    } catch {
      setFailed(true);
    }
  }, [resource]);

  useEffect(() => { if (initialDetails) void load(false); }, [initialDetails, load]);

  const canWrite = Boolean(details?.screen.canWrite);
  const time = useCoManagedSharedTimeConfig(initialDetails ? resource : null, canWrite);
  const refresh = useCallback((_mode: TicketRefreshMode) => load(true), [load]);
  const requestDisclosure = useCallback((request: Omit<Disclosure, 'settle' | 'cancel'>) =>
    new Promise<void>((resolve, reject) => {
      setDisclosure({ ...request, settle: () => { setDisclosure(null); resolve(); }, cancel: () => { setDisclosure(null); reject(new Error('cancelled')); } });
    }), []);

  const source = useMemo(() => details && conversation
    ? createSharedTicketDataSource(resource, { details, conversation }, { t, refresh, backHref, requestDisclosure })
    : null, [resource, details, conversation, t, refresh, backHref, requestDisclosure]);
  const dataSource = useMemo(() => source ? composeTicketDataSource(source, { time }) : null, [source, time]);

  if (failed || !details) {
    return (
      <div role="alert" className="mx-auto max-w-xl space-y-3 p-6">
        <p className="font-semibold">{t('coManaged.ticket.loadError')}</p>
        <p className="text-sm text-muted-foreground">{t('coManaged.ticket.restricted')}</p>
        <div className="flex gap-2">
          {initialDetails && <Button id="co-shared-ticket-reload" variant="outline" onClick={() => void load(true)}>{t('coManaged.ticket.reload')}</Button>}
        </div>
      </div>
    );
  }
  if (!dataSource || !conversation) return <p role="status" className="p-6 text-sm text-muted-foreground">{t('coManaged.ticket.loading')}</p>;

  const viewerId = conversation.actor.userId;
  const [first = '', ...rest] = (session?.user?.name ?? '').split(' ');
  const comments = [...conversation.items]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.commentId.localeCompare(b.commentId))
    .map(item => mapConversationItem(item, {
      ticketId: resource.id, actor: conversation.actor, writeAudiences: conversation.writeAudiences,
      resourceTenant: resource.tenant, customerName: details.screen.customerName,
    }));
  const ticketData = buildSharedTicketScreenData(details, comments,
    { user_id: viewerId, first_name: first, last_name: rest.join(' '), email: session?.user?.email ?? undefined, user_type: 'internal' });

  return (
    <TicketDataSourceProvider dataSource={dataSource}>
      <MspTicketDetailsContainerClient key={version} ticketData={ticketData as never} />
      {disclosure && (
        <CoManagedThreadDisclosure resource={resource} thread={disclosure.thread} actor={disclosure.actor} audiences={disclosure.audiences}
          onClosed={disclosure.cancel} onSaved={() => { disclosure.settle(); void load(true); }} />
      )}
    </TicketDataSourceProvider>
  );
}
