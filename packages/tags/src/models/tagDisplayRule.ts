import type { Knex } from 'knex';
import type { ITagDisplayRule, TagDisplayAudience, TagDisplayEntityType } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';

const rulesQuery = (knexOrTrx: Knex | Knex.Transaction, tenant: string) =>
  tenantDb(knexOrTrx, tenant).table('tag_display_rules');

const TagDisplayRule = {
  /** Rules ordered by position, optionally narrowed to one entity type and/or audience. */
  list: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    filter: { taggedType?: TagDisplayEntityType; audience?: TagDisplayAudience } = {},
  ): Promise<ITagDisplayRule[]> => {
    const query = rulesQuery(knexOrTrx, tenant);
    if (filter.taggedType) query.where('tagged_type', filter.taggedType);
    if (filter.audience) query.where('audience', filter.audience);
    return (await query
      .orderBy('tagged_type', 'asc')
      .orderBy('audience', 'asc')
      .orderBy('position', 'asc')) as ITagDisplayRule[];
  },

  /**
   * Replaces the ordered list for one (entity type, audience). `tagIds` are definition ids; ids that
   * are not definitions of that entity type are rejected so a rule can never point at the wrong kind
   * of tag. Duplicates collapse to their first position.
   */
  replace: async (
    trx: Knex.Transaction,
    tenant: string,
    taggedType: TagDisplayEntityType,
    audience: TagDisplayAudience,
    tagIds: string[],
    userId: string | null,
  ): Promise<ITagDisplayRule[]> => {
    const ordered = Array.from(new Set(tagIds));
    if (ordered.length > 0) {
      const found = await tenantDb(trx, tenant)
        .table('tag_definitions')
        .where('tagged_type', taggedType)
        .whereIn('tag_id', ordered)
        .select('tag_id') as Array<{ tag_id: string }>;
      const valid = new Set(found.map((row) => row.tag_id));
      const unknown = ordered.filter((id) => !valid.has(id));
      if (unknown.length > 0) {
        throw new Error(`Unknown ${taggedType} tag definition(s): ${unknown.join(', ')}`);
      }
    }

    await rulesQuery(trx, tenant).where({ tagged_type: taggedType, audience }).del();
    if (ordered.length > 0) {
      await rulesQuery(trx, tenant).insert(
        ordered.map((tag_id, position) => ({
          tenant,
          tagged_type: taggedType,
          audience,
          tag_id,
          position,
          created_by: userId,
        })),
      );
    }
    return TagDisplayRule.list(trx, tenant, { taggedType, audience });
  },
};

export default TagDisplayRule;
