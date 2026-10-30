import type { Knex } from 'knex';
import type { IDisplayTag, TagDisplayEntityType } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { loadDisplayTagsForEntities, displayTagKey } from '@alga-psa/tags/lib/loadDisplayTags';
import { displayAudienceForUser } from '@alga-psa/tags/lib/tagDisplayRules';

/**
 * Adds `displayTags` (the chip tags the viewer's audience may see, in display-rule order) to picker
 * and list rows. One batched read per entity type for the whole page; rows with no displayed tags
 * get an empty array so pickers never have to distinguish "not loaded" from "none".
 */
export async function attachDisplayTags<T extends object>(
  db: Knex,
  tenant: string,
  user: { user_type?: string | null },
  taggedType: TagDisplayEntityType,
  rows: readonly T[],
  idOf: (row: T) => string | null | undefined,
): Promise<Array<T & { displayTags: IDisplayTag[] }>> {
  if (rows.length === 0) return [];
  const tagsByKey = await withTransaction(db, (trx: Knex.Transaction) =>
    loadDisplayTagsForEntities(trx, tenant, displayAudienceForUser(user as never), [
      { taggedType, ids: rows.map(idOf) },
    ]),
  );
  return rows.map((row) => {
    const id = idOf(row);
    return { ...row, displayTags: (id ? tagsByKey.get(displayTagKey(taggedType, id)) : undefined) ?? [] };
  });
}
