import type { Knex } from 'knex';

/** A receipt or marker identifies qualified work even when cached fields are
 * damaged. Older customer task notices have no durable source receipt, so they
 * must also enter verification (and be omitted), never native cached delivery. */
export function coManagedNotificationPredicate(db: Knex) {
  return db.raw(`(jsonb_exists(COALESCE(internal_notifications.metadata::jsonb, '{}'::jsonb), 'coManaged') OR EXISTS (
    SELECT 1 FROM co_management_in_app_receipts cir WHERE cir.tenant = internal_notifications.tenant
      AND cir.notification_id = internal_notifications.internal_notification_id) OR EXISTS (
    SELECT 1 FROM ticket_conversation_notification_receipts ncr WHERE ncr.tenant = internal_notifications.tenant
      AND ncr.notification_id = internal_notifications.internal_notification_id) OR (
    (internal_notifications.template_name = 'task-comment-added' OR
      (internal_notifications.template_name = 'user-mentioned' AND (
        internal_notifications.metadata->>'contextType' = 'task' OR
        jsonb_exists(COALESCE(internal_notifications.metadata::jsonb, '{}'::jsonb), 'taskId') OR
        internal_notifications.link LIKE '/msp/projects/%'))) AND (
      EXISTS (SELECT 1 FROM tenants ct WHERE ct.tenant = internal_notifications.tenant AND ct.product_code = 'co_managed') OR
      EXISTS (SELECT 1 FROM co_management_relationships cr WHERE cr.tenant = internal_notifications.tenant))))`);
}
