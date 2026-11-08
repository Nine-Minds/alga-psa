import type { TaggedEntityType } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

export interface ITagDefinition {
  tenant: string;
  tag_id: string;
  tag_text: string;
  tagged_type: TaggedEntityType;
  board_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_at?: Date;
}

const tagDefinitionsQuery = (knexOrTrx: Knex | Knex.Transaction, tenant: string) =>
  tenantDb(knexOrTrx, tenant).table('tag_definitions');

const tagMappingsQuery = (knexOrTrx: Knex | Knex.Transaction, tenant: string) =>
  tenantDb(knexOrTrx, tenant).table('tag_mappings');

const tagReferencesQuery = (knexOrTrx: Knex | Knex.Transaction, tenant: string) =>
  tenantDb(knexOrTrx, tenant).table('tag_references');

const TagDefinition = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITagDefinition[]> => {
    const definitions = await tagDefinitionsQuery(knexOrTrx, tenant)
      .orderBy('tag_text', 'asc') as ITagDefinition[];
    return definitions;
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tag_id: string): Promise<ITagDefinition | undefined> => {
    const definition = await tagDefinitionsQuery(knexOrTrx, tenant)
      .where('tag_id', tag_id)
      .first() as ITagDefinition | undefined;
    return definition;
  },

  findByTextAndType: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_text: string,
    tagged_type: TaggedEntityType
  ): Promise<ITagDefinition | undefined> => {
    const definition = await tagDefinitionsQuery(knexOrTrx, tenant)
      .where('tag_text', tag_text.trim())
      .where('tagged_type', tagged_type)
      .first() as ITagDefinition | undefined;
    return definition;
  },

  getAllByType: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagged_type: TaggedEntityType
  ): Promise<ITagDefinition[]> => {
    const definitions = await tagDefinitionsQuery(knexOrTrx, tenant)
      .where('tagged_type', tagged_type)
      .orderBy('tag_text', 'asc') as ITagDefinition[];
    return definitions;
  },

  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    definition: Omit<ITagDefinition, 'tag_id' | 'tenant' | 'created_at'>
  ): Promise<ITagDefinition> => {
    const normalizedDefinition = {
      ...definition,
      tag_text: definition.tag_text.trim(),
      tag_id: uuidv4(),
      tenant
    };

    const [inserted] = await tenantDb(knexOrTrx, tenant).table<ITagDefinition>('tag_definitions')
      .insert(normalizedDefinition)
      .returning('*');
    return inserted;
  },

  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_id: string,
    updates: Partial<Omit<ITagDefinition, 'tag_id' | 'tenant' | 'tagged_type'>>
  ): Promise<void> => {
    if (updates.tag_text) {
      updates.tag_text = updates.tag_text.trim();
    }

    await tagDefinitionsQuery(knexOrTrx, tenant)
      .where('tag_id', tag_id)
      .update(updates);
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tag_id: string): Promise<void> => {
    // On Citus the tag_references -> tag_definitions FK (and its ON DELETE CASCADE) may be skipped,
    // so delete the references explicitly. Callers pass a transaction so both deletes commit together.
    // Referrers' own rows (e.g. a display rule) are not touched here: this package does not know who
    // refers to a tag. A referrer row whose tag is gone is dangling, and every reader skips it.
    await tagReferencesQuery(knexOrTrx, tenant)
      .where('tag_id', tag_id)
      .del();
    await tagDefinitionsQuery(knexOrTrx, tenant)
      .where('tag_id', tag_id)
      .del();
  },

  deleteOrphaned: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tagIds: string[]): Promise<number> => {
    if (tagIds.length === 0) return 0;

    return await tagDefinitionsQuery(knexOrTrx, tenant)
      .whereIn('tag_id', tagIds)
      .whereNotExists(
        tagMappingsQuery(knexOrTrx, tenant)
          .select(knexOrTrx.raw('1'))
          .whereRaw('tag_mappings.tag_id = tag_definitions.tag_id')
      )
      // A definition something refers to (tag_references, written by any referrer) is configuration,
      // not litter: it stays while unmapped.
      .whereNotExists(
        tagReferencesQuery(knexOrTrx, tenant)
          .select(knexOrTrx.raw('1'))
          .whereRaw('tag_references.tag_id = tag_definitions.tag_id')
      )
      .del();
  },

  getOrCreate: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_text: string,
    tagged_type: TaggedEntityType,
    defaults: Partial<Omit<ITagDefinition, 'tag_id' | 'tenant' | 'tag_text' | 'tagged_type'>> = {}
  ): Promise<ITagDefinition> => {
    const { definition } = await TagDefinition.getOrCreateWithStatus(
      knexOrTrx,
      tenant,
      tag_text,
      tagged_type,
      defaults
    );
    return definition;
  },

  getOrCreateWithStatus: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_text: string,
    tagged_type: TaggedEntityType,
    defaults: Partial<Omit<ITagDefinition, 'tag_id' | 'tenant' | 'tag_text' | 'tagged_type'>> = {}
  ): Promise<{ definition: ITagDefinition; created: boolean }> => {
    let definition = await TagDefinition.findByTextAndType(knexOrTrx, tenant, tag_text, tagged_type);

    if (definition) {
      return { definition, created: false };
    }

    try {
      definition = await TagDefinition.insert(knexOrTrx, tenant, {
        tag_text,
        tagged_type,
        ...defaults
      });
      return { definition, created: true };
    } catch (insertError: unknown) {
      const errorCode =
        typeof insertError === 'object' && insertError !== null && 'code' in insertError
          ? String((insertError as { code?: unknown }).code)
          : undefined;
      const errorMessage = insertError instanceof Error ? insertError.message : undefined;

      if (errorCode === '23505' || errorMessage?.includes('duplicate')) {
        definition = await TagDefinition.findByTextAndType(knexOrTrx, tenant, tag_text, tagged_type);
        if (!definition) {
          throw insertError;
        }
        return { definition, created: false };
      }
      throw insertError;
    }
  }
};

export default TagDefinition;
