'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { OutboundMailClass } from '@alga-psa/types';
import { TenantEmailService } from './TenantEmailService';

export const listSelectableSenders = withAuth(async (_user, { tenant }, input: { mailClass: OutboundMailClass; boardId?: string; ignoreBoardRoute?: boolean; boardName?: string }) => {
  if (!tenant) throw new Error('A tenant is required.');
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const settings = await TenantEmailService.getTenantEmailSettings(tenant, knex);
  if (!settings) throw new Error('Outbound email settings are not configured.');
  const senderQuery = db.table('email_sender_addresses');
  const senders = await (settings.emailProvider === 'smtp'
    ? senderQuery.select('sender_id', 'email_address', 'display_name')
    : senderQuery.where({ verification_status: 'verified' }).select('sender_id', 'email_address', 'display_name'));
  const routes = await db.table('email_sender_routes').select('*');
  const matchingRoutes = [
    ...(input.boardId && !input.ignoreBoardRoute ? routes.filter((route: any) => route.route_type === 'board' && route.board_id === input.boardId) : []),
    ...routes.filter((route: any) => route.route_type === 'mail_class' && route.mail_class === input.mailClass),
    ...routes.filter((route: any) => route.route_type === 'default'),
  ];
  const route = matchingRoutes.find((item: any) => item.sender_id || item.display_name);
  const routedSender = matchingRoutes.reduce((found: any, item: any) => found ?? (item.sender_id
    ? senders.find((sender: any) => sender.sender_id === item.sender_id)
    : null), null);
  const defaultFrom = TenantEmailService.getDefaultFromAddress(settings);
  const effectiveSenderAddress = routedSender?.email_address ?? defaultFrom.email;
  const effectiveSenderDisplayName = route?.display_name?.trim()
    || routedSender?.display_name?.trim()
    || (input.mailClass === 'ticket' ? input.boardName?.trim() : undefined)
    || defaultFrom.name;
  return { senders, effectiveSenderId: routedSender?.sender_id ?? null, effectiveSenderAddress, effectiveSenderDisplayName, allowOverride: senders.length > 1 };
});
