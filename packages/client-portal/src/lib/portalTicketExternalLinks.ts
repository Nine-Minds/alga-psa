import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IExternalEntityLink, PortalTicketExternalLink } from '@alga-psa/types';
import { renderExternalLinkUrl, resolveExternalSystem } from '@alga-psa/tickets/lib/externalSystems';

/** Call only after the portal's parent-ticket authorization succeeds. Not a server action. */
export async function loadPortalTicketExternalLinks(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
): Promise<PortalTicketExternalLink[]> {
  const db = tenantDb(trx, tenant);
  const rows: Pick<IExternalEntityLink, 'system' | 'external_id' | 'realm' | 'url'>[] = await db
    .table('external_entity_links')
    .where({ ticket_id: ticketId, entity_id: ticketId, entity_type: 'ticket', portal_visible: true })
    .select('system', 'external_id', 'realm', 'url')
    .orderBy('created_at').orderBy('link_id');
  if (rows.length === 0) return [];

  const systems = await db.table('tenant_external_systems').select('key', 'label', 'url_template');
  return rows.flatMap((row) => {
    const definition = resolveExternalSystem(systems, row.system);
    const url = renderExternalLinkUrl(definition, row);
    // Unresolvable/unsafe legacy destinations are not useful portal links.
    if (!url || !definition) return [];
    return [{ label: `${definition.label} · ${row.external_id}`, url }];
  });
}
