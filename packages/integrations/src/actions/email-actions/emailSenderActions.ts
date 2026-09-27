'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { TenantEmailService } from '@alga-psa/email';
import type { OutboundMailClass } from '@alga-psa/types';

type SenderActionFailure = { success: false; error: string };

function withTypedErrors<T extends (...args: any[]) => Promise<any>>(action: T) {
  return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>> | SenderActionFailure> => {
    try {
      return await action(...args);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

type RouteInput = {
  routeType: 'default' | 'mail_class' | 'board';
  mailClass?: OutboundMailClass;
  boardId?: string;
  senderId?: string | null;
  displayName?: string | null;
  confirmUnverifiedSmtpSender?: boolean;
};

async function authorize(user: any, tenant: string, action: 'read' | 'update') {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'settings', action, knex)) throw new Error('You do not have permission to manage email sender settings.');
  if (!tenant) throw new Error('A tenant is required.');
  return { knex, db: tenantDb(knex, tenant) };
}

function routePredicate(route: RouteInput) {
  if (route.routeType === 'default') return { route_type: 'default' };
  if (route.routeType === 'mail_class') {
    if (!route.mailClass) throw new Error('A mail class is required for this route.');
    return { route_type: 'mail_class', mail_class: route.mailClass };
  }
  if (!route.boardId) throw new Error('A board is required for this route.');
  return { route_type: 'board', board_id: route.boardId };
}

export const listEmailSenders = withAuth(async (user, { tenant }) => {
  const { db } = await authorize(user, tenant, 'read');
  const [senders, routes] = await Promise.all([
    db.table('email_sender_addresses').select('*').orderBy('email_address'),
    db.tenantJoin(
      db.table('email_sender_routes as routes'),
      'boards as boards',
      'routes.board_id',
      'boards.board_id',
      { type: 'left', rootTenantColumn: 'routes.tenant' },
    )
      .select('routes.*', 'boards.board_name')
      .orderBy('routes.route_type'),
  ]);
  return { senders, routes };
});

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
    ...(input.boardId && !input.ignoreBoardRoute
      ? routes.filter((route: any) => route.route_type === 'board' && route.board_id === input.boardId)
      : []),
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
  return {
    senders,
    effectiveSenderId: routedSender?.sender_id ?? null,
    effectiveSenderAddress,
    effectiveSenderDisplayName,
    allowOverride: senders.length > 1,
  };
});

const createEmailSenderAction = withAuth(async (user, { tenant }, input: { emailAddress: string; displayName?: string | null; microsoftProviderId?: string | null }) => {
  const { knex, db } = await authorize(user, tenant, 'update');
  const emailAddress = input.emailAddress.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) throw new Error('Enter a valid sender email address.');
  const settings = await TenantEmailService.getTenantEmailSettings(tenant, knex);
  if (!settings) throw new Error('Outbound email settings are not configured.');
  let microsoftProviderId: string | null = null;
  let verificationStatus: 'unverified' | 'verified' = 'unverified';
  if (settings.emailProvider === 'resend') {
    const domain = emailAddress.split('@')[1];
    const verified = await db.table('email_domains').where({ domain_name: domain, status: 'verified' }).first();
    if (!verified) throw new Error(`Domain ${domain} is not verified for this tenant.`);
    verificationStatus = 'verified';
  } else if (settings.emailProvider === 'microsoft') {
    if (!input.microsoftProviderId) throw new Error('Choose a connected Microsoft mailbox to send through.');
    const mailbox = await db.table('email_providers').where({ id: input.microsoftProviderId, provider_type: 'microsoft', is_active: true, status: 'connected' }).first();
    if (!mailbox) throw new Error('The selected Microsoft mailbox is not connected.');
    microsoftProviderId = mailbox.id;
    verificationStatus = mailbox.mailbox.trim().toLowerCase() === emailAddress ? 'verified' : 'unverified';
  } else if (settings.emailProvider === 'smtp') {
    verificationStatus = 'unverified';
  }
  // LEVERAGE: friction tenantdb-insert — tenantDb scopes reads/updates/deletes but not inserts
  let sender: any;
  try {
    // LEVERAGE: friction tenantdb-insert — tenantDb scopes reads/updates/deletes but not inserts
    [sender] = await db.table('email_sender_addresses').insert({
      tenant,
      email_address: emailAddress,
      display_name: input.displayName?.trim() || null,
      microsoft_provider_id: microsoftProviderId,
      verification_status: verificationStatus,
      verified_at: verificationStatus === 'verified' ? new Date() : null,
    }).returning('*');
  } catch (error) {
    if ((error as any)?.code === '23505') {
      logger.error('[emailSenderActions] Duplicate sender address insert failed', error);
      throw new Error('This sender address already exists.');
    }
    throw error;
  }
  await TenantEmailService.invalidateTenantSettings(tenant);
  return sender;
});

const updateEmailSenderAction = withAuth(async (user, { tenant }, input: { senderId: string; displayName?: string | null; emailAddress?: string }) => {
  const { knex, db } = await authorize(user, tenant, 'update');
  const update: Record<string, unknown> = { updated_at: new Date() };
  if (input.displayName !== undefined) update.display_name = input.displayName?.trim() || null;
  if (input.emailAddress !== undefined) {
    const address = input.emailAddress.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter a valid sender email address.');
    const settings = await TenantEmailService.getTenantEmailSettings(tenant, knex);
    if (!settings) throw new Error('Outbound email settings are not configured.');
    if (settings.emailProvider === 'resend') {
      const domain = address.split('@')[1];
      const verified = await db.table('email_domains').where({ domain_name: domain, status: 'verified' }).first();
      if (!verified) throw new Error(`Domain ${domain} is not verified for this tenant.`);
      update.verification_status = 'verified';
      update.verified_at = new Date();
    } else if (settings.emailProvider === 'microsoft') {
      const current = await db.table('email_sender_addresses').where({ sender_id: input.senderId }).first();
      if (!current?.microsoft_provider_id) throw new Error('The sender is not linked to a connected Microsoft mailbox.');
      const mailbox = await db.table('email_providers').where({ id: current.microsoft_provider_id, provider_type: 'microsoft', is_active: true, status: 'connected' }).first();
      if (!mailbox) throw new Error('The linked Microsoft mailbox is not connected.');
      update.verification_status = mailbox.mailbox.trim().toLowerCase() === address ? 'verified' : 'unverified';
      update.verified_at = update.verification_status === 'verified' ? new Date() : null;
    } else {
      update.verification_status = 'unverified';
      update.verified_at = null;
    }
    update.last_verification_error = null;
    update.email_address = address;
  }
  const [sender] = await db.table('email_sender_addresses').where({ sender_id: input.senderId }).update(update).returning('*');
  if (!sender) throw new Error('Sender address was not found.');
  await TenantEmailService.invalidateTenantSettings(tenant);
  return sender;
});

const deleteEmailSenderAction = withAuth(async (user, { tenant }, senderId: string) => {
  const { db } = await authorize(user, tenant, 'update');
  const routes = await db.tenantJoin(
    db.table('email_sender_routes as routes'),
    'boards as boards',
    'routes.board_id',
    'boards.board_id',
    { type: 'left', rootTenantColumn: 'routes.tenant' },
  )
    .where('routes.sender_id', senderId)
    .select('routes.route_type', 'routes.mail_class', 'boards.board_name');
  if (routes.length) {
    const mailClassNames: Record<string, string> = { ticket: 'ticket email', project: 'project email', billing: 'billing email', sales: 'sales email', scheduling: 'scheduling email', survey: 'survey email', account: 'account email', general: 'general email' };
    throw new Error(`This sender is still used by ${routes.map((route: any) => route.route_type === 'board' ? `board "${route.board_name ?? 'Unknown board'}"` : route.mail_class ? (mailClassNames[route.mail_class] ?? route.mail_class) : 'the default route').join(', ')}.`);
  }
  const deleted = await db.table('email_sender_addresses').where({ sender_id: senderId }).del();
  if (!deleted) throw new Error('Sender address was not found.');
  await TenantEmailService.invalidateTenantSettings(tenant);
  return { success: true };
});

const setEmailSenderRouteAction = withAuth(async (user, { tenant }, input: RouteInput) => {
  const { knex, db } = await authorize(user, tenant, 'update');
  if (!input.senderId && !input.displayName?.trim()) throw new Error('Choose a sender or provide a display name.');
  if (input.senderId) {
    const sender = await db.table('email_sender_addresses').where({ sender_id: input.senderId }).first();
    if (!sender) throw new Error('Sender address was not found.');
    if (sender.verification_status !== 'verified') {
      const settings = await TenantEmailService.getTenantEmailSettings(tenant, knex);
      if (settings?.emailProvider !== 'smtp' || !input.confirmUnverifiedSmtpSender) {
        throw new Error('Routes can use only verified senders. For SMTP, explicitly confirm that the relay accepts this sender address.');
      }
    }
  }
  const key = routePredicate(input);
  try {
    await knex.transaction(async (trx) => {
      const trxDb = tenantDb(trx, tenant);
      await trxDb.table('email_sender_routes').where(key).del();
      // LEVERAGE: friction tenantdb-insert — tenantDb scopes reads/updates/deletes but not inserts
      await trxDb.table('email_sender_routes').insert({
        tenant,
        ...key,
        sender_id: input.senderId ?? null,
        display_name: input.displayName?.trim() || null,
        updated_at: new Date(),
      });
    });
  } catch (error) {
    if ((error as any)?.code === '23505') {
      logger.error('[emailSenderActions] Duplicate sender route insert failed', error);
      throw new Error('That sender route already exists.');
    }
    throw error;
  }
  await TenantEmailService.invalidateTenantSettings(tenant);
  return { success: true };
});

const clearEmailSenderRouteAction = withAuth(async (user, { tenant }, input: RouteInput) => {
  const { db } = await authorize(user, tenant, 'update');
  await db.table('email_sender_routes').where(routePredicate(input)).del();
  await TenantEmailService.invalidateTenantSettings(tenant);
  return { success: true };
});

const verifyEmailSenderAction = withAuth(async (user, { tenant }, senderId: string) => {
  const { db } = await authorize(user, tenant, 'update');
  const sender = await db.table('email_sender_addresses').where({ sender_id: senderId }).first();
  if (!sender) throw new Error('Sender address was not found.');
  const recipient = (user as any)?.email;
  if (!recipient) throw new Error('The current user has no email address for verification.');
  try {
    const result = await TenantEmailService.getInstance(tenant).sendEmail({
      tenantId: tenant,
      to: recipient,
      mailClass: 'general',
      senderId,
      allowUnverifiedSender: true,
      subject: 'Outbound sender verification',
      html: `Test message from ${sender.email_address}`,
    });
    if (!result.success) throw new Error(result.error || 'The provider did not accept the verification message.');
    await db.table('email_sender_addresses').where({ sender_id: senderId }).update({ verification_status: 'verified', verified_at: new Date(), last_verification_error: null });
    await TenantEmailService.invalidateTenantSettings(tenant);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.table('email_sender_addresses').where({ sender_id: senderId }).update({ verification_status: 'failed', last_verification_error: message });
    await TenantEmailService.invalidateTenantSettings(tenant);
    throw error;
  }
});

export const createEmailSender = withTypedErrors(createEmailSenderAction);
export const updateEmailSender = withTypedErrors(updateEmailSenderAction);
export const deleteEmailSender = withTypedErrors(deleteEmailSenderAction);
export const setEmailSenderRoute = withTypedErrors(setEmailSenderRouteAction);
export const clearEmailSenderRoute = withTypedErrors(clearEmailSenderRouteAction);
export const verifyEmailSender = withTypedErrors(verifyEmailSenderAction);
