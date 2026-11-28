import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { flattenBlockContentToPlainText, getMeaningfulBlockContentMarkdown } from '@alga-psa/formatting/blocknoteUtils';
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

interface TicketLabelRow {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  contact_name_id: string | null;
  client_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  attributes?: { description?: unknown } | null;
}

export const ticketLabelViewModelProvider: LabelViewModelProvider = {
  entityType: 'ticket',
  labelClass: 'ticket-work-tag',

  async getLabelViewModels(context: LabelRequestContext, ids: readonly string[]) {
    if (!(await hasPermission(context.user, 'ticket', 'read'))) {
      return ids.map(() => null);
    }
    const { knex } = await createTenantKnex(context.tenant);
    const facade = tenantDb(knex, context.tenant);

    const rows = await Promise.all(
      ids.map(async (ticketId): Promise<TicketLabelRow | null> => {
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

        const query = facade
          .table('tickets as t')
          .where('t.ticket_id', ticketId)
          .select(
            't.ticket_id',
            't.ticket_number',
            't.title',
            't.contact_name_id',
            'c.client_name',
            'ct.full_name as contact_name',
            'ct.email as contact_email',
            'cat.category_name',
            'sub.category_name as subcategory_name'
          );
        if (context.includeWorksheetDetails) {
          query.select('t.attributes');
        }
        facade.tenantJoin(query, 'clients as c', 't.client_id', 'c.client_id', { type: 'left' });
        facade.tenantJoin(query, 'contacts as ct', 't.contact_name_id', 'ct.contact_name_id', { type: 'left' });
        facade.tenantJoin(query, 'categories as cat', 't.category_id', 'cat.category_id', { type: 'left' });
        facade.tenantJoin(query, 'categories as sub', 't.subcategory_id', 'sub.category_id', { type: 'left' });
        return ((await query.first()) as TicketLabelRow | undefined) ?? null;
      })
    );

    // One phone query for the whole batch; the first row per contact is its preferred number.
    const contactIds = Array.from(
      new Set(rows.map((row) => row?.contact_name_id).filter((id): id is string => Boolean(id)))
    );
    const phoneByContact = new Map<string, string>();
    if (contactIds.length > 0) {
      const phones = (await facade
        .table('contact_phone_numbers')
        .whereIn('contact_name_id', contactIds)
        .select('contact_name_id', 'phone_number')
        .orderBy([
          { column: 'contact_name_id', order: 'asc' },
          { column: 'is_default', order: 'desc' },
          { column: 'display_order', order: 'asc' },
        ])) as Array<{ contact_name_id: string; phone_number: string }>;
      for (const phone of phones) {
        if (!phoneByContact.has(phone.contact_name_id)) {
          phoneByContact.set(phone.contact_name_id, phone.phone_number);
        }
      }
    }

    return rows.map((row): LabelViewModel | null => {
        if (!row) {
          return null;
        }
        const description = row.attributes?.description;
        const ticketDescription = flattenBlockContentToPlainText(description).trim() || null;

        return {
          labelClass: 'ticket-work-tag',
          entityType: 'ticket',
          recordId: row.ticket_id,
          url: recordUrl('ticket', row.ticket_id, context.baseUrl),
          identifier: row.ticket_number ?? row.ticket_id,
          code128Value: null,
          title: row.title ?? null,
          clientName: row.client_name ?? null,
          contactName: row.contact_name ?? null,
          contactPhone: (row.contact_name_id && phoneByContact.get(row.contact_name_id)) || null,
          contactEmail: row.contact_email ?? null,
          detail: deriveWorkReason(row.subcategory_name, row.category_name),
          ...(context.includeWorksheetDetails
            ? {
                ticketDescription,
                ticketDescriptionRichText:
                  ticketDescription || getMeaningfulBlockContentMarkdown(description) ? description : null,
              }
            : {}),
          secondaryIdentifier: null,
          serialSuffix: null,
          custodyLocation: null,
          nextAction: null,
        };
    });
  },
};
