import type { Knex } from 'knex';
import type { IDisplayTag, TagDisplayAudience, TagDisplayEntityType } from '@alga-psa/types';
import { displayTagsQuery } from './displayTagsQuery';

export interface DisplayTagRef {
  taggedType: TagDisplayEntityType;
  ids: readonly (string | null | undefined)[];
}

export const displayTagKey = (taggedType: TagDisplayEntityType, id: string): string => `${taggedType}:${id}`;

/**
 * Batch loader for chip tags. For each requested (entity type, ids) it returns the tags to show to
 * `audience`: the entity's tags restricted to that audience's display rules, in rule order.
 *
 * The audience is the access control. An audience with no rules for a type gets no tags for it, so a
 * client-portal caller (`displayAudienceForUser`) sees nothing until a 'client' rule exists. This
 * function never reads tags outside the rules, whatever the caller asks for.
 *
 * One query per entity type, regardless of how many ids. Reads that already select the entity can
 * compose displayTagsForEntityQuery instead to avoid an additional round trip.
 */
export async function loadDisplayTagsForEntities(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  audience: TagDisplayAudience,
  refs: readonly DisplayTagRef[],
): Promise<Map<string, IDisplayTag[]>> {
  const result = new Map<string, IDisplayTag[]>();

  for (const ref of refs) {
    const ids = Array.from(new Set(ref.ids.filter((id): id is string => !!id)));
    if (ids.length === 0) continue;

    const rows = await displayTagsQuery(knexOrTrx, tenant, audience, ref.taggedType)
      .whereIn('dtm.tagged_id', ids)
      .orderBy('dtr.position', 'asc')
      .select(
        'dtm.tagged_id',
        'dtd.tag_id',
        'dtd.tag_text',
        'dtd.background_color',
        'dtd.text_color',
      ) as Array<IDisplayTag & { tagged_id: string }>;

    const byEntity = new Map<string, IDisplayTag[]>();
    for (const row of rows) {
      const key = displayTagKey(ref.taggedType, row.tagged_id);
      const list = byEntity.get(key) ?? [];
      list.push({
        tag_id: row.tag_id,
        tag_text: row.tag_text,
        background_color: row.background_color,
        text_color: row.text_color,
      });
      byEntity.set(key, list);
    }
    for (const [key, tags] of byEntity) result.set(key, tags);
  }
  return result;
}
