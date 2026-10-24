import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  recordUrl,
  type LabelRequestContext,
  type LabelViewModel,
  type LabelViewModelProvider,
} from '@alga-psa/types';

import { authorizeTicketRecordAccess } from './ticketRecordAuthorization';

/**
 * Ticket work-tag label data. Read-only; no side effects.
 *
 * Authorization happens BEFORE any ticket field is read for output: coarse `ticket:read` RBAC, then
 * the same per-record kernel decision the ticket detail page uses (`authorizeTicketRecordAccess`).
 * A missing ticket and a ticket the caller may not read are both returned as `null`, so a caller
 * learns nothing about whether the id exists.
 *
 * Deliberately NOT included (deferred to alga-2026-0002683 C2, which owns the work tag fields): the
 * linked asset tag / serial suffix. Reading it needs the asset-side record-level check, and tickets
 * must not import assets.
 */
const NOT_VISIBLE = /^(Ticket not found|Permission denied)/;

export const ticketLabelViewModelProvider: LabelViewModelProvider = {
  entityType: 'ticket',
  labelClass: 'ticket-work-tag',

  async getLabelViewModels(context: LabelRequestContext, ids: readonly string[]) {
    if (!(await hasPermission(context.user, 'ticket', 'read'))) {
      return ids.map(() => null);
    }
    const { knex } = await createTenantKnex(context.tenant);

    return Promise.all(
      ids.map(async (ticketId): Promise<LabelViewModel | null> => {
        try {
          await authorizeTicketRecordAccess({
            trx: knex,
            tenant: context.tenant,
            user: context.user,
            ticketId,
            action: 'read',
          });
        } catch (error) {
          if (error instanceof Error && NOT_VISIBLE.test(error.message)) {
            return null;
          }
          throw error;
        }

        const facade = tenantDb(knex, context.tenant);
        const query = facade
          .table('tickets as t')
          .where('t.ticket_id', ticketId)
          .select('t.ticket_id', 't.ticket_number', 't.title', 'c.client_name');
        facade.tenantJoin(query, 'clients as c', 't.client_id', 'c.client_id', { type: 'left' });
        const row = (await query.first()) as
          | { ticket_id: string; ticket_number: string | null; title: string | null; client_name: string | null }
          | undefined;
        if (!row) {
          return null;
        }

        return {
          labelClass: 'ticket-work-tag',
          entityType: 'ticket',
          recordId: row.ticket_id,
          url: recordUrl('ticket', row.ticket_id, context.baseUrl),
          identifier: row.ticket_number ?? row.ticket_id,
          code128Value: null,
          title: row.title ?? null,
          clientName: row.client_name ?? null,
          detail: null,
          secondaryIdentifier: null,
          serialSuffix: null,
        };
      })
    );
  },
};
