import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Called inside the client-delete transaction, before the client row is removed.
 *
 * checklist_templates.client_id FKs to clients without ON DELETE SET NULL (unsupported on Citus,
 * see docs/AI_coding_standards.md), so the scope must be released here. A template that simply lost
 * its scope would silently become available to every client, so it is deactivated in the same
 * statement and a note explains why.
 */
export async function deactivateClientScopedChecklistTemplates(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  clientName: string
): Promise<number> {
  const scoped = tenantDb(trx, tenant);
  const templates = await scoped.table('checklist_templates')
    .where({ client_id: clientId })
    .select('template_id', 'description') as Array<{ template_id: string; description: string | null }>;

  const note = `Deactivated: its client "${clientName}" was deleted. Reactivating makes it available to all clients.`;
  for (const template of templates) {
    await scoped.table('checklist_templates')
      .where({ template_id: template.template_id })
      .update({
        is_active: false,
        client_id: null,
        description: template.description ? `${template.description}\n\n${note}` : note,
        updated_at: trx.fn.now(),
      });
  }
  return templates.length;
}
