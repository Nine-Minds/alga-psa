import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { TaggedEntityType } from '@alga-psa/types';

import TagDefinition from '../models/tagDefinition';

import { registerAction, type InboundActionDefinition } from '@alga-psa/shared/inboundWebhooks/actions/registry';
import { lookupAlgaEntityByExternalId } from '@alga-psa/shared/inboundWebhooks/externalEntityMappings';

type SupportedInboundTagEntityType = Extract<TaggedEntityType, 'client' | 'contact' | 'ticket' | 'project' | 'project_task'>;

interface AddTagToEntityByExternalIdMappedValues extends Record<string, unknown> {
  entity_type: SupportedInboundTagEntityType;
  external_id: string;
  tag_text: string;
  background_color?: string;
  text_color?: string;
  created_by?: string;
}

const supportedEntityTypes: SupportedInboundTagEntityType[] = ['client', 'contact', 'ticket', 'project', 'project_task'];

const addTagToEntityByExternalIdAction: InboundActionDefinition<AddTagToEntityByExternalIdMappedValues> = {
  name: 'addTagToEntityByExternalId',
  entityType: 'tag',
  displayName: 'Add Tag to Entity by External ID',
  description: 'Attach a tag to a webhook-mapped entity.',
  targetFields: [
    {
      name: 'entity_type',
      type: 'enum',
      required: true,
      description: 'Mapped entity type to tag',
      enumValues: supportedEntityTypes,
    },
    { name: 'external_id', type: 'string', required: true, description: 'External entity identifier to resolve' },
    { name: 'tag_text', type: 'string', required: true, description: 'Tag text to attach' },
    { name: 'background_color', type: 'string', required: false, description: 'Optional tag background color' },
    { name: 'text_color', type: 'string', required: false, description: 'Optional tag text color' },
    { name: 'created_by', type: 'ref', required: false, refEntityType: 'user', description: 'User ID to record as tag applier' },
  ],
  async handle(ctx, mappedValues) {
    if (!supportedEntityTypes.includes(mappedValues.entity_type)) {
      throw new Error(`VALIDATION_ERROR: unsupported tag entity_type "${mappedValues.entity_type}"`);
    }

    const tagText = mappedValues.tag_text.trim();
    if (!tagText) {
      throw new Error('VALIDATION_ERROR: tag_text is required');
    }
    if (tagText.length > 50) {
      throw new Error('VALIDATION_ERROR: tag_text must be 50 characters or fewer');
    }

    const { knex } = await createTenantKnex(ctx.tenant);
    const result = await withTransaction(knex, async (trx) => {
      const lookup = await lookupAlgaEntityByExternalId(
        ctx.tenant,
        ctx.webhookSlug,
        mappedValues.entity_type,
        mappedValues.external_id,
        { knex: trx },
      );

      if (!lookup) {
        return null;
      }

      await assertTaggedEntityExists(trx, ctx.tenant, mappedValues.entity_type, lookup.algaEntityId);
      await assertCreatedByExistsIfProvided(trx, ctx.tenant, mappedValues.created_by);

      const { definition } = await TagDefinition.getOrCreateWithStatus(
        trx,
        ctx.tenant,
        tagText,
        mappedValues.entity_type,
        {
          background_color: mappedValues.background_color ?? null,
          text_color: mappedValues.text_color ?? null,
        },
      );

      const existingMapping = await trx('tag_mappings')
        .where({
          tenant: ctx.tenant,
          tag_id: definition.tag_id,
          tagged_id: lookup.algaEntityId,
          tagged_type: mappedValues.entity_type,
        })
        .first('mapping_id');

      if (existingMapping) {
        return {
          mappingId: existingMapping.mapping_id,
          entityId: lookup.algaEntityId,
          tagId: definition.tag_id,
          created: false,
        };
      }

      const [mapping] = await trx('tag_mappings')
        .insert({
          tenant: ctx.tenant,
          tag_id: definition.tag_id,
          tagged_id: lookup.algaEntityId,
          tagged_type: mappedValues.entity_type,
          created_by: mappedValues.created_by ?? null,
          created_at: trx.fn.now(),
        })
        .returning(['mapping_id']);

      return {
        mappingId: mapping.mapping_id,
        entityId: lookup.algaEntityId,
        tagId: definition.tag_id,
        created: true,
      };
    });

    if (!result) {
      return {
        success: false,
        entityType: mappedValues.entity_type,
        externalId: mappedValues.external_id,
        message: `lookup_miss: ${mappedValues.entity_type} external_id "${mappedValues.external_id}" is not mapped for webhook "${ctx.webhookSlug}"`,
      };
    }

    return {
      success: true,
      entityType: mappedValues.entity_type,
      entityId: result.entityId,
      externalId: mappedValues.external_id,
      metadata: {
        tag_id: result.tagId,
        tag_mapping_id: result.mappingId,
        tag_text: tagText,
        created: result.created,
      },
    };
  },
};

registerAction(addTagToEntityByExternalIdAction);

export const tagInboundActions = [addTagToEntityByExternalIdAction];

async function assertTaggedEntityExists(
  trx: any,
  tenant: string,
  entityType: SupportedInboundTagEntityType,
  entityId: string,
): Promise<void> {
  const table = taggedEntityTable(entityType);
  const entity = await trx(table.table).where({ tenant, [table.idColumn]: entityId }).first(table.idColumn);
  if (!entity) {
    throw new Error(`lookup_miss: mapped ${entityType} "${entityId}" no longer exists`);
  }
}

async function assertCreatedByExistsIfProvided(trx: any, tenant: string, userId?: string): Promise<void> {
  if (!userId) {
    return;
  }

  const user = await trx('users').where({ tenant, user_id: userId }).first('user_id');
  if (!user) {
    throw new Error(`VALIDATION_ERROR: created_by user "${userId}" does not exist`);
  }
}

function taggedEntityTable(entityType: SupportedInboundTagEntityType): { table: string; idColumn: string } {
  switch (entityType) {
    case 'client':
      return { table: 'clients', idColumn: 'client_id' };
    case 'contact':
      return { table: 'contacts', idColumn: 'contact_name_id' };
    case 'ticket':
      return { table: 'tickets', idColumn: 'ticket_id' };
    case 'project':
      return { table: 'projects', idColumn: 'project_id' };
    case 'project_task':
      return { table: 'project_tasks', idColumn: 'task_id' };
    default:
      throw new Error(`VALIDATION_ERROR: unsupported tag entity_type "${entityType}"`);
  }
}
