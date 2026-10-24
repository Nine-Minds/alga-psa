/**
 * Ticket Auto-Close Warning Subscriber
 *
 * Handles TICKET_AUTO_CLOSE_WARNING events emitted by the auto-close engine
 * (autoCloseTicketsHandler, running in the Temporal worker). The handler can
 * only publish events — it has no access to @alga-psa/notifications — so the
 * actual warning email is resolved and sent here on the server side.
 *
 * Resolves the warning notification subtype, the ticket contact's email, and
 * the portal user, then sends the 'ticket-auto-close-warning' notification.
 * The handler already marks warning_sent_at and writes the ticket activity, so
 * this subscriber is send-only.
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { createTenantKnex, runWithTenant, buildTenantPortalSlug, tenantDb } from '@alga-psa/db';
import { getEmailNotificationService } from '@alga-psa/notifications';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { buildTenantPortalUrl } from '@alga-psa/tenancy/server';

const WARNING_SUBTYPE_NAME = 'Ticket Auto-Close Warning';
const WARNING_TEMPLATE_NAME = 'ticket-auto-close-warning';

let isRegistered = false;

export async function registerTicketAutoCloseWarningSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('TICKET_AUTO_CLOSE_WARNING', handleTicketAutoCloseWarningEvent);

  isRegistered = true;
  logger.info('[TicketAutoCloseWarningSubscriber] Registered');
}

export async function unregisterTicketAutoCloseWarningSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('TICKET_AUTO_CLOSE_WARNING', handleTicketAutoCloseWarningEvent);

  isRegistered = false;
  logger.info('[TicketAutoCloseWarningSubscriber] Unregistered');
}

// The close time is a timestamp (an instant), so it is formatted as a datetime
// value in the recipient's locale rather than as a date-only calendar field.
function formatCloseDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
}

async function buildPortalTicketUrl(tenant: string, ticketId: string): Promise<string> {
  // Tenant portal origin (active custom domain, else the public base URL). With
  // no origin the URL stays relative, as it did when APP_URL was unset.
  return (
    (await buildTenantPortalUrl(tenant, `/client-portal/tickets/${ticketId}`, {
      tenant: buildTenantPortalSlug(tenant),
    })) ?? `/client-portal/tickets/${ticketId}?tenant=${buildTenantPortalSlug(tenant)}`
  );
}

async function handleTicketAutoCloseWarningEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.TICKET_AUTO_CLOSE_WARNING.parse(event);
    const {
      tenantId,
      ticketId,
      ticketNumber,
      title,
      scheduledCloseAt,
      contactNameId,
      assignedTo,
      enteredBy,
    } = validated.payload;

    logger.info('[TicketAutoCloseWarningSubscriber] Handling TICKET_AUTO_CLOSE_WARNING', {
      tenantId,
      ticketId,
    });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();
      const scopedDb = tenantDb(knex, tenantId);
      const ticket = await scopedDb.table('tickets').where({ ticket_id: ticketId }).first('board_id');

      const subtype = await scopedDb.table('notification_subtypes')
        .where({ name: WARNING_SUBTYPE_NAME })
        .first();
      if (!subtype) {
        logger.warn(
          `[TicketAutoCloseWarningSubscriber] Notification subtype '${WARNING_SUBTYPE_NAME}' not found; skipping warning`,
          { ticketId }
        );
        return;
      }

      const contact = contactNameId
        ? await scopedDb.table('contacts').where({ contact_name_id: contactNameId }).first()
        : null;

      if (!contact?.email) {
        logger.info('[TicketAutoCloseWarningSubscriber] No contact email; nothing to send', {
          ticketId,
        });
        return;
      }

      const portalUser = await scopedDb.table('users')
        .where({ contact_id: contactNameId })
        .first('user_id');
      // Recipient is the contact; the user id only anchors preference lookup
      // and the notification log, so fall back to an MSP-side user when the
      // contact has no portal account.
      const userIdForLog = portalUser?.user_id ?? assignedTo ?? enteredBy;

      const recipientLocale = await resolveEmailLocale(tenantId, {
        email: contact.email,
        userType: 'client',
        ...(contact.client_id ? { clientId: contact.client_id } : {}),
      });

      await getEmailNotificationService().sendNotification({
        mailClass: 'ticket',
        boardId: ticket?.board_id,
        tenant: tenantId,
        userId: userIdForLog,
        subtypeId: subtype.id,
        emailAddress: contact.email,
        templateName: WARNING_TEMPLATE_NAME,
        data: {
          ticket: {
            id: ticketNumber,
            title,
            metaLine: `Ticket #${ticketNumber}`,
            scheduledCloseDate: formatCloseDate(new Date(scheduledCloseAt), recipientLocale),
            url: await buildPortalTicketUrl(tenantId, ticketId),
          },
        },
      });

      logger.info('[TicketAutoCloseWarningSubscriber] Warning notification sent', {
        ticketId,
      });
    });
  } catch (error) {
    logger.error('[TicketAutoCloseWarningSubscriber] Failed to handle event', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Rethrow so the event bus redelivers. The handler already set
    // warning_sent_at (so the scan won't re-publish), so swallowing here would
    // drop the warning permanently; redelivery retries the send until it lands.
    throw error;
  }
}
