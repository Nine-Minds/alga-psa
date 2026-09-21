import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { CoManagedSharedWorkError, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from '@alga-psa/co-managed';
import type { InternalNotification } from '../types/internalNotification';
import { getNotificationTemplate, renderTemplate } from '../actions/internal-notification-actions/createNotificationCore';
import { withCoManagedStoredPresentation } from './coManagedStoredPresentation';
import { coManagedNotificationPredicate as qualifiedNotification } from './coManagedNotificationClassification';

/** Qualify the shared subset once, then use the same visibility set for SQL
 * pagination and every count. Ordinary notifications keep native semantics.
 * Retained outer-transaction locks keep source/policy changes from racing the
 * counts and rendered response; the final clock check covers later SQL waits. */
export async function coManagedInboxScope(trx: Knex.Transaction, user: { user_id: string; user_type?: string }, tenant: string, options: { id?: string; forUpdate?: boolean } = {}) {
  const home = tenantDb(trx, tenant);
  const query = home.table('internal_notifications').where('user_id', user.user_id).whereNull('deleted_at')
    .whereRaw('?', [qualifiedNotification(trx)]).select('internal_notifications.internal_notification_id');
  home.tenantJoin(query, 'co_management_in_app_receipts as scope_receipt', 'internal_notifications.internal_notification_id', 'scope_receipt.notification_id', { type: 'left' });
  query.orderByRaw('CASE WHEN scope_receipt.customer_tenant = ?::uuid THEN 1 ELSE 0 END', [tenant]).orderBy('scope_receipt.customer_tenant').orderBy('scope_receipt.resource_type').orderBy('scope_receipt.resource_id').orderBy('internal_notifications.internal_notification_id');
  if (options.id) query.where('internal_notification_id', options.id);
  const candidates = await query;
  const classified = new Set<string>(candidates.map(row => row.internal_notification_id));
  const presentations = new Map<string, Partial<InternalNotification>>();
  let actor: CoManagedSessionActor | null = null;
  if (candidates.length && user.user_type === 'internal' && !getApiKeyUserOverride()) {
    // LEVERAGE: pattern co-managed-browser-identity — browser adapters must reject API overrides and bind the tracked home session.
    const session = await getSession();
    if (session?.session_id && session.user?.tenant === tenant && session.user.id === user.user_id && session.user.user_type === 'internal') {
      actor = { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id };
    }
  }
  if (actor) for (const candidate of candidates) {
    try {
      await withCoManagedStoredPresentation(trx, actor, candidate.internal_notification_id, async current => {
        const template = await getNotificationTemplate(trx, tenant, current.templateName, current.languageCode);
        if (!template) return;
        const presentation = current.presentation;
        presentations.set(candidate.internal_notification_id, { title: renderTemplate(template.title, presentation.data),
          message: renderTemplate(template.message, presentation.data), metadata: presentation.metadata, link: presentation.link,
          template_name: template.name, language_code: template.language_code });
      }, { notificationLock: options.forUpdate ? 'update' : 'share' });
    } catch (error) {
      if (!(error instanceof CoManagedSharedWorkError)) throw error;
    }
  }
  const ids = [...presentations.keys()];
  return {
    apply(query: Knex.QueryBuilder) {
      query.whereRaw('((NOT (?) AND internal_notifications.internal_notification_id <> ALL(?::uuid[])) OR internal_notifications.internal_notification_id = ANY(?::uuid[]))', [qualifiedNotification(trx), [...classified], ids]);
    },
    render(row: InternalNotification): InternalNotification | null {
      if (!classified.has(row.internal_notification_id)) return row;
      const presentation = presentations.get(row.internal_notification_id);
      return presentation ? { ...row, ...presentation } : null;
    },
    async assertCurrent() {
      if (actor && presentations.size) await assertCoManagedSessionUnexpired(trx, actor);
    },
  };
}
