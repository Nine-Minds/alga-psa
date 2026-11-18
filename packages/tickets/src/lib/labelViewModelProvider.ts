import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  recordUrl,
  type LabelRequestContext,
  type LabelViewModel,
  type LabelViewModelProvider,
} from '@alga-psa/types';

import { deriveWorkReason } from './deriveWorkReason';
import { authorizeTicketRecordAccess } from './ticketRecordAuthorization';

/**
 * Ticket work-tag label data. Read-only; no side effects.
 *
 * Authorization happens BEFORE any ticket field is read for output: coarse `ticket:read` RBAC, then
 * the same per-record kernel decision the ticket detail page uses (`authorizeTicketRecordAccess`).
 * A missing ticket and a ticket the caller may not read are both returned as `null`, so a caller
 * learns nothing about whether the id exists.
 *
 * Work reason (`detail`): the subcategory name if the ticket has one, else the category name, else null
 * (alga-2026-0002683 C2 design). Both are ticket-owned data.
 *
 * Deliberately NOT included: the linked asset tag / serial suffix. Reading it needs the asset-side
 * record-level check, and tickets must not import assets; the composition root merges those parts.
 */

export { deriveWorkReason };

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
          .select('t.ticket_id', 't.ticket_number', 't.title', 'c.client_name', 'cat.category_name', 'sub.category_name as subcategory_name');
        facade.tenantJoin(query, 'clients as c', 't.client_id', 'c.client_id', { type: 'left' });
        facade.tenantJoin(query, 'categories as cat', 't.category_id', 'cat.category_id', { type: 'left' });
        facade.tenantJoin(query, 'categories as sub', 't.subcategory_id', 'sub.category_id', { type: 'left' });
        const row = (await query.first()) as
          | {
              ticket_id: string;
              ticket_number: string | null;
              title: string | null;
              client_name: string | null;
              category_name: string | null;
              subcategory_name: string | null;
            }
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
          detail: deriveWorkReason(row.subcategory_name, row.category_name),
          secondaryIdentifier: null,
          serialSuffix: null,
          custodyLocation: null,
          nextAction: null,
        };
      })
    );
  },
};
