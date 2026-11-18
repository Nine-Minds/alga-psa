import type { Knex } from 'knex';
import type { ITagDisplayRule, TagDisplayAudience, TagDisplayEntityType } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { deleteTagReferences, replaceTagReferences } from '../lib/tagReferences';

/** The referrer type this model registers in tag_references. Owned here: tag_references itself is type-agnostic. */
const REFERRER_TYPE = 'tag_display_rule';

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

    // Rules are recreated wholesale, so the removed rules' references go and the new rules' arrive in
    // the same transaction. This also drops any dangling rule (tag deleted) in this list.
    const removed = await rulesQuery(trx, tenant)
      .where({ tagged_type: taggedType, audience })
      .del()
      .returning('rule_id') as Array<{ rule_id: string }>;
    for (const { rule_id } of removed) {
      await deleteTagReferences(trx, tenant, REFERRER_TYPE, rule_id);
    }
    if (ordered.length > 0) {
      const inserted = await rulesQuery(trx, tenant).insert(
        ordered.map((tag_id, position) => ({
          tenant,
          tagged_type: taggedType,
          audience,
          tag_id,
          position,
          created_by: userId,
        })),
      ).returning(['rule_id', 'tag_id']) as Array<{ rule_id: string; tag_id: string }>;
      for (const { rule_id, tag_id } of inserted) {
        await replaceTagReferences(trx, tenant, REFERRER_TYPE, rule_id, [tag_id]);
      }
    }
    return TagDisplayRule.list(trx, tenant, { taggedType, audience });
  },
};

export default TagDisplayRule;
