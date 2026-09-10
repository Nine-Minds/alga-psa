/**
 * Worker-side implementation of
 * @alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions.
 *
 * The real module is "use server" and drags next-auth and the realtime UI
 * stack into the graph, so the worker build maps the package here instead.
 * This used to be a throwing stub, which silently dropped every notification
 * an activity tried to deliver (e.g. Entra sync failure alerts). It now
 * creates the notification row through the shared dependency-light core; the
 * row reaches the user on their next notification poll. The after-commit
 * effects the server adds (realtime broadcast, push hooks, NOTIFICATION_SENT
 * workflow event) are UI-facing conveniences the worker cannot perform.
 */

import type { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { createNotificationRowFromTemplate } from '../../../../../../../packages/notifications/src/actions/internal-notification-actions/createNotificationCore';
import type {
  CreateInternalNotificationRequest,
  InternalNotification,
} from '../../../../../../../packages/notifications/src/types/internalNotification';

export async function createNotificationFromTemplateInternal(
  knex: Knex,
  request: CreateInternalNotificationRequest
): Promise<InternalNotification | null> {
  if (typeof (knex as unknown as { transaction?: unknown } | null)?.transaction !== 'function') {
    throw new Error('createNotificationFromTemplateInternal requires a server-side database connection');
  }
  return withTransaction(knex, (trx: Knex.Transaction) =>
    createNotificationRowFromTemplate(trx, request.tenant, request.user_id, request)
  );
}
