import type { Knex } from 'knex';
import type { IDisplayTag, TagDisplayAudience, TagDisplayEntityType } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { resolveDisplayedTags } from './tagDisplayRules';

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
 * One query for the rules and one per entity type for the mappings, regardless of how many ids.
 */
export async function loadDisplayTagsForEntities(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  audience: TagDisplayAudience,
  refs: readonly DisplayTagRef[],
): Promise<Map<string, IDisplayTag[]>> {
  const result = new Map<string, IDisplayTag[]>();
  const db = tenantDb(knexOrTrx, tenant);

  for (const ref of refs) {
    const ids = Array.from(new Set(ref.ids.filter((id): id is string => !!id)));
    if (ids.length === 0) continue;

    const rules = await db
      .table('tag_display_rules')
      .where({ tagged_type: ref.taggedType, audience })
      .orderBy('position', 'asc')
      .select('tag_id', 'position') as Array<{ tag_id: string; position: number }>;
    if (rules.length === 0) continue;

    const rows = await db
      .table('tag_mappings as tm')
      .join('tag_definitions as td', function joinDefinitions() {
        this.on('td.tenant', '=', 'tm.tenant').andOn('td.tag_id', '=', 'tm.tag_id');
      })
      .where('tm.tagged_type', ref.taggedType)
      .whereIn('tm.tagged_id', ids)
      .whereIn('tm.tag_id', rules.map((rule) => rule.tag_id))
      .select(
        'tm.tagged_id',
        'td.tag_id',
        'td.tag_text',
        'td.background_color',
        'td.text_color',
      ) as Array<IDisplayTag & { tagged_id: string }>;

    const byEntity = new Map<string, IDisplayTag[]>();
    for (const row of rows) {
      const list = byEntity.get(row.tagged_id) ?? [];
      list.push({
        tag_id: row.tag_id,
        tag_text: row.tag_text,
        background_color: row.background_color,
        text_color: row.text_color,
      });
      byEntity.set(row.tagged_id, list);
    }
    for (const [entityId, tags] of byEntity) {
      const shown = resolveDisplayedTags(rules, tags);
      if (shown.length > 0) result.set(displayTagKey(ref.taggedType, entityId), shown);
    }
  }
  return result;
}
