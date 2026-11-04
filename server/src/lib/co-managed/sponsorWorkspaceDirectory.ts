import { getCoManagedClientOverview, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

/** One selectable sponsor-side workspace, named the way the overview names it. */
export interface CoManagedSponsorWorkspace { operationId: string; clientId: string; name: string }

/** What a sponsor-side management route should do when the caller did not say
 * which co-managed workspace it meant. `directory` asks for a choice; `operation`
 * means the sponsor has exactly one live workspace, so there is nothing to ask. */
export type CoManagedSponsorEntry =
  | { side: 'directory'; workspaces: CoManagedSponsorWorkspace[] }
  | { side: 'operation'; operationId: string };

/** The overview caps a page at 100 rows, so a sponsor with more live customers
 * than that needs every page walked before the directory is complete. */
const PAGE_SIZE = 100;

/**
 * Resolve how an unqualified sponsor-side route should proceed.
 *
 * Returns `undefined` for a non-sponsor tenant, whose identity comes from its
 * own home relationship and who therefore never chooses. For a sponsor the
 * choice is drawn from `getCoManagedClientOverview` — the same authorized,
 * record-policy-projected listing `/msp/co-managed` already renders — so a
 * workspace that is hidden from this actor there is hidden here too.
 *
 * A sponsor with one live workspace is resolved rather than prompted, matching
 * `resolveSponsorClient`, which auto-selects a lone current relationship.
 */
export async function coManagedSponsorEntry(db: Knex, actor: CoManagedSessionActor): Promise<CoManagedSponsorEntry | undefined> {
  const home = await tenantDb(db, actor.tenant).table('tenants').first('product_code');
  if (home?.product_code !== 'psa') return undefined;
  const workspaces: CoManagedSponsorWorkspace[] = [];
  for (let page = 1; ; page += 1) {
    const { rows, totalCount } = await getCoManagedClientOverview(db, actor, { page, pageSize: PAGE_SIZE });
    for (const row of rows) {
      if (row.ended) continue;
      workspaces.push({ operationId: row.operationId, clientId: row.clientId,
        name: row.workspaceName || row.clientName || row.operationId });
    }
    if (!rows.length || page * PAGE_SIZE >= totalCount) break;
  }
  if (workspaces.length === 1) return { side: 'operation', operationId: workspaces[0].operationId };
  return { side: 'directory', workspaces };
}
