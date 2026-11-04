import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Must run inside every client-delete transaction, before the client row is removed (the shared
 * cleanup chains of deleteClient, ClientService.delete and the workflow client-delete action all
 * call it).
 *
 * ticket_templates.client_id FKs to clients without ON DELETE SET NULL (unsupported on Citus, see
 * docs/AI_coding_standards.md), so the scope is released here. A template that simply lost its scope
 * would become available to every client, so it is deactivated in the same step and a note explains
 * why. Deactivating rather than blocking: this is deliberately NOT a deletion dependency. Mirrors
 * deactivateClientScopedChecklistTemplates.
 */
export async function deactivateClientScopedTicketTemplates(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<number> {
  const scoped = tenantDb(trx, tenant);
  const client = await scoped.table('clients').where({ client_id: clientId }).first('client_name') as
    | { client_name: string }
    | undefined;
  const templates = await scoped.table('ticket_templates')
    .where({ client_id: clientId })
    .select('template_id', 'notes') as Array<{ template_id: string; notes: string | null }>;

  const note = `Deactivated: its client "${client?.client_name ?? clientId}" was deleted. Reactivating makes it available to all clients.`;
  for (const template of templates) {
    await scoped.table('ticket_templates')
      .where({ template_id: template.template_id })
      .update({
        is_active: false,
        client_id: null,
        notes: template.notes ? `${template.notes}\n\n${note}` : note,
        updated_at: trx.fn.now(),
      });
  }
  return templates.length;
}
