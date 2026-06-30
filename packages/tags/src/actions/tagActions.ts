'use server'

import TagDefinition, { ITagDefinition } from '../models/tagDefinition';
import TagMapping, { ITagMapping, ITagWithDefinition } from '../models/tagMapping';
import { ITag, TaggedEntityType, PendingTag, IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import { hasPermissionAsync, throwPermissionErrorAsync } from '../lib/authHelpers';
import { generateEntityColorAsync } from '../lib/uiHelpers';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildTagAppliedPayload,
  buildTagDefinitionCreatedPayload,
  buildTagDefinitionUpdatedPayload,
  buildTagRemovedPayload,
} from '@alga-psa/workflow-streams';

/** Map tagged entity types to their permission resource equivalents */
const ENTITY_PERMISSION_MAP: Partial<Record<TaggedEntityType, string>> = {
  client: 'client',
  knowledge_base_article: 'document',
};

function getPermissionResource(taggedType: TaggedEntityType): string {
  return ENTITY_PERMISSION_MAP[taggedType] ?? taggedType;
}

type TagTextSnapshot = string[];

type CreateTagOptions = {
  suppressEntityUpdateEvent?: boolean;
};

type TagMappingDefinitionRow = {
  tag_id: string;
  board_id?: string | null;
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  background_color?: string | null;
  text_color?: string | null;
  tenant: string;
  created_by?: string | null;
  definition_tag_id?: string;
};

type TagMappingDefinitionWithDefinitionIdRow = TagMappingDefinitionRow & {
  definition_tag_id: string;
};

const projectTasksQuery = (trx: Knex.Transaction, tenant: string) =>
  tenantDb(trx, tenant).table('project_tasks as pt');

const tagMappingsWithDefinitionsQuery = (trx: Knex.Transaction, tenant: string) =>
  tenantDb(trx, tenant).table('tag_mappings as tm');

const joinProjectPhases = (query: Knex.QueryBuilder, trx: Knex.Transaction, tenant: string) =>
  tenantDb(trx, tenant).tenantJoin(query, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');

const joinTagDefinitions = (query: Knex.QueryBuilder, trx: Knex.Transaction, tenant: string) =>
  tenantDb(trx, tenant).tenantJoin(query, 'tag_definitions as td', 'tm.tag_id', 'td.tag_id');

async function getTagTextSnapshot(
  trx: Knex.Transaction,
  tenant: string,
  taggedId: string,
  taggedType: TaggedEntityType
): Promise<TagTextSnapshot> {
  const tags = await TagMapping.getByEntity(trx, tenant, taggedId, taggedType);
  return Array.from(new Set(tags.map((tag) => tag.tag_text))).sort((a, b) => a.localeCompare(b));
}

function tagTextSnapshotsEqual(previous: TagTextSnapshot, next: TagTextSnapshot): boolean {
  return previous.length === next.length && previous.every((tagText, index) => tagText === next[index]);
}

async function resolveProjectTaskTagContext(
  trx: Knex.Transaction,
  tenant: string,
  taskId: string
): Promise<{ projectId: string; phaseId: string } | null> {
  const row = await projectTasksQuery(trx, tenant)
    .modify((query) => joinProjectPhases(query, trx, tenant))
    .where({ 'pt.task_id': taskId })
    .first('pp.project_id', 'pt.phase_id') as { project_id: string; phase_id: string } | undefined;

  if (!row) {
    return null;
  }

  return {
    projectId: row.project_id,
    phaseId: row.phase_id,
  };
}

/**
 * Batched form of resolveProjectTaskTagContext: resolve project/phase context
 * for many tasks in one query so bulk callers don't pay a lookup per task.
 */
async function resolveProjectTaskTagContexts(
  trx: Knex.Transaction,
  tenant: string,
  taskIds: string[]
): Promise<Map<string, { projectId: string; phaseId: string }>> {
  const contexts = new Map<string, { projectId: string; phaseId: string }>();
  if (taskIds.length === 0) {
    return contexts;
  }

  const rows = await projectTasksQuery(trx, tenant)
    .modify((query) => joinProjectPhases(query, trx, tenant))
    .whereIn('pt.task_id', taskIds)
    .select(
      'pt.task_id',
      'pp.project_id',
      'pt.phase_id',
    ) as Array<{ task_id: string; project_id: string; phase_id: string }>;

  for (const row of rows) {
    contexts.set(row.task_id, { projectId: row.project_id, phaseId: row.phase_id });
  }
  return contexts;
}

async function publishEntityTagUpdateEvent(params: {
  trx: Knex.Transaction;
  tenant: string;
  taggedId: string;
  taggedType: TaggedEntityType;
  userId: string;
  occurredAt: string;
  previousTags: TagTextSnapshot;
  newTags: TagTextSnapshot;
  // Pre-resolved project_task context lets bulk callers batch the project/phase
  // lookup; when omitted the single-entity path resolves it on demand.
  projectTaskContext?: { projectId: string; phaseId: string } | null;
}): Promise<void> {
  if (tagTextSnapshotsEqual(params.previousTags, params.newTags)) {
    return;
  }

  const changes = {
    tags: {
      previous: params.previousTags,
      new: params.newTags,
    },
  };

  if (params.taggedType === 'project_task') {
    const context = params.projectTaskContext !== undefined
      ? params.projectTaskContext
      : await resolveProjectTaskTagContext(params.trx, params.tenant, params.taggedId);
    if (!context) {
      return;
    }

    await publishEvent({
      eventType: 'PROJECT_TASK_UPDATED',
      payload: {
        tenantId: params.tenant,
        projectId: context.projectId,
        // Canonical PROJECT_TASK_UPDATED shape (shared with search index):
        // taskId/timestamp, not projectTaskId/occurredAt.
        taskId: params.taggedId,
        phaseId: context.phaseId,
        userId: params.userId,
        timestamp: params.occurredAt,
        changes,
      },
    });
    return;
  }

  if (params.taggedType === 'ticket') {
    await publishEvent({
      eventType: 'TICKET_UPDATED',
      payload: {
        tenantId: params.tenant,
        ticketId: params.taggedId,
        userId: params.userId,
        changes,
      },
    });
  }
}

export const findTagsByEntityId = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, entityId: string, entityType: string): Promise<ITag[]> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tagsWithDefinitions = await TagMapping.getByEntity(trx, tenant, entityId, entityType as TaggedEntityType);
      return tagsWithDefinitions.map(tag => ({
        tag_id: tag.mapping_id,
        tenant,
        board_id: tag.board_id || undefined,
        tag_text: tag.tag_text,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type,
        background_color: tag.background_color,
        text_color: tag.text_color,
        created_by: tag.created_by
      }));
    });
  } catch (error) {
    console.error(`Error finding tags for ${entityType} id ${entityId}:`, error);
    throw new Error(`Failed to find tags for ${entityType} id: ${entityId}`);
  }
});

export const findTagById = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, tagId: string): Promise<ITag | undefined> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // tagId is actually mapping_id in the new system
      const tag = await tagMappingsWithDefinitionsQuery(trx, tenant)
        .modify((query) => joinTagDefinitions(query, trx, tenant))
        .where('tm.mapping_id', tagId)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant',
          'tm.created_by'
        )
        .first() as TagMappingDefinitionRow | undefined;

      if (!tag) {
        console.warn(`Tag with id ${tagId} not found`);
        return undefined;
      }

      return {
        tag_id: tag.tag_id,
        tenant: tag.tenant,
        board_id: tag.board_id || undefined,
        tag_text: tag.tag_text,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type,
        background_color: tag.background_color,
        text_color: tag.text_color,
        created_by: tag.created_by
      };
    });
  } catch (error) {
    console.error(`Error finding tag with id ${tagId}:`, error);
    throw new Error(`Failed to find tag with id: ${tagId}`);
  }
});

export const createTag = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  tag: Omit<ITag, 'tag_id' | 'tenant'>,
  options: CreateTagOptions = {}
): Promise<ITag> => {
  // Validate tag text
  if (!tag.tag_text || !tag.tag_text.trim()) {
    throw new Error('Tag text is required');
  }

  const tagText = tag.tag_text.trim();

  // Validate length
  if (tagText.length > 50) {
    throw new Error('Tag text too long (max 50 characters)');
  }

  // Validate characters - allow letters, numbers, spaces, and common punctuation
  if (!/^[a-zA-Z0-9\-_\s!@#$%^&*()+=\][{};':",./<>?]+$/.test(tagText)) {
    throw new Error('Tag text contains invalid characters');
  }

  const userId = currentUser.user_id;

  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check permissions
      const entityResource = getPermissionResource(tag.tagged_type);

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${tag.tagged_type.replace('_', ' ')}`);
      }

      const existingTags = await TagDefinition.getAllByType(trx, tenant, tag.tagged_type);
      const existingTag = existingTags.find((t: ITagDefinition) => t.tag_text === tagText);

      // Check if this is a new tag (not in existing tags) - only then require tag:create permission
      if (!existingTag && !await hasPermissionAsync(currentUser, 'tag', 'create', trx)) {
        await throwPermissionErrorAsync('create new tags', 'You can only select from existing tags');
      }

      const tagWithTenant: Omit<ITag, 'tag_id' | 'tenant'> & {
        background_color?: string | null;
        text_color?: string | null
      } = { ...tag };

      if (existingTag && (existingTag.background_color || existingTag.text_color)) {
        // Use existing colors if this text already exists
        tagWithTenant.background_color = existingTag.background_color;
        tagWithTenant.text_color = existingTag.text_color;
      } else if (!tagWithTenant.background_color || !tagWithTenant.text_color) {
        // Generate and save colors for new tags
        const colors = await generateEntityColorAsync(tagText);
        tagWithTenant.background_color = tagWithTenant.background_color || colors.backgroundColor;
        tagWithTenant.text_color = tagWithTenant.text_color || colors.textColor;
      }

      // Get or create tag definition
      const { definition, created: createdDefinition } = await TagDefinition.getOrCreateWithStatus(
        trx,
        tenant,
        tagText,
        tagWithTenant.tagged_type,
        {
          board_id: tagWithTenant.board_id,
          background_color: tagWithTenant.background_color,
          text_color: tagWithTenant.text_color
        }
      );

      const previousTags = await getTagTextSnapshot(
        trx,
        tenant,
        tagWithTenant.tagged_id,
        tagWithTenant.tagged_type
      );

      // Create mapping with user ID
      const mapping = await TagMapping.insert(trx, tenant, {
        tag_id: definition.tag_id,
        tagged_id: tagWithTenant.tagged_id,
        tagged_type: tagWithTenant.tagged_type
      }, userId);
      const newTags = await getTagTextSnapshot(
        trx,
        tenant,
        tagWithTenant.tagged_id,
        tagWithTenant.tagged_type
      );

      const occurredAt = new Date().toISOString();
      if (createdDefinition) {
        await publishWorkflowEvent({
          eventType: 'TAG_DEFINITION_CREATED',
          payload: buildTagDefinitionCreatedPayload({
            tagId: definition.tag_id,
            tagName: definition.tag_text,
            createdByUserId: userId,
            createdAt: definition.created_at ?? occurredAt,
          }),
          ctx: {
            tenantId: tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: userId },
          },
        });
      }

      await publishWorkflowEvent({
        eventType: 'TAG_APPLIED',
        payload: buildTagAppliedPayload({
          tagId: definition.tag_id,
          entityType: tagWithTenant.tagged_type,
          entityId: tagWithTenant.tagged_id,
          appliedByUserId: userId,
          appliedAt: mapping.created_at ?? occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: userId },
        },
      });

      if (!options.suppressEntityUpdateEvent) {
        await publishEntityTagUpdateEvent({
          trx,
          tenant,
          taggedId: tagWithTenant.tagged_id,
          taggedType: tagWithTenant.tagged_type,
          userId,
          occurredAt,
          previousTags,
          newTags,
        });
      }

      const createdTag: ITag = {
        ...tagWithTenant,
        tag_id: mapping.mapping_id, // Return mapping_id as tag_id for backward compatibility
        tenant
      };
      return createdTag;
    } catch (error) {
      console.error(`Error creating tag:`, error);
      // Re-throw permission errors as-is
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Failed to create tag`);
    }
  });
});

export const updateTag = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, id: string, tag: Partial<ITag>): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get existing tag to check entity type (id is mapping_id)
      const existingTag = await tagMappingsWithDefinitionsQuery(trx, tenant)
        .modify((query) => joinTagDefinitions(query, trx, tenant))
        .where('tm.mapping_id', id)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant',
          'tm.created_by',
          'tm.tag_id as definition_tag_id'
        )
        .first() as TagMappingDefinitionWithDefinitionIdRow | undefined;

      if (!existingTag) {
        throw new Error(`Tag with id ${id} not found`);
      }

      // Check permissions
      const entityResource = getPermissionResource(existingTag.tagged_type);

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${existingTag.tagged_type.replace('_', ' ')}`);
      }

      if (!await hasPermissionAsync(currentUser, 'tag', 'update', trx)) {
        await throwPermissionErrorAsync('update tags');
      }

      const previousTagText = String(existingTag.tag_text ?? '').trim();
      const nextTagText = typeof tag.tag_text === 'string' ? tag.tag_text.trim() : previousTagText;

      // Update the definition (only certain fields can be updated)
      await TagDefinition.update(trx, tenant, existingTag.definition_tag_id, {
        tag_text: tag.tag_text,
        background_color: tag.background_color,
        text_color: tag.text_color,
        board_id: tag.board_id
      });

      const occurredAt = new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'TAG_DEFINITION_UPDATED',
        payload: buildTagDefinitionUpdatedPayload({
          tagId: existingTag.definition_tag_id,
          previousName: previousTagText,
          newName: nextTagText,
          updatedByUserId: currentUser.user_id,
          updatedAt: occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: currentUser.user_id },
        },
      });
    } catch (error) {
      console.error(`Error updating tag with id ${id}:`, error);
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Failed to update tag with id ${id}`);
    }
  });
});

export const getTagMappingUsageCount = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, mappingId: string): Promise<{ tagId: string; tagText: string; usageCount: number }> => {
  const { knex: db } = await createTenantKnex();
  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const mapping = await tagMappingsWithDefinitionsQuery(trx, tenant)
      .modify((query) => joinTagDefinitions(query, trx, tenant))
      .where('tm.mapping_id', mappingId)
      .select('td.tag_id', 'td.tag_text')
      .first() as { tag_id: string; tag_text: string } | undefined;

    if (!mapping) {
      throw new Error(`Tag mapping with id ${mappingId} not found`);
    }

    const usageCount = await TagMapping.getUsageCount(trx, tenant, mapping.tag_id);

    return {
      tagId: mapping.tag_id,
      tagText: mapping.tag_text,
      usageCount,
    };
  });
});

export const deleteTag = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, id: string, deleteDefinition?: boolean): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get existing tag to check entity type and creator (id is mapping_id)
      const existingTag = await tagMappingsWithDefinitionsQuery(trx, tenant)
        .modify((query) => joinTagDefinitions(query, trx, tenant))
        .where('tm.mapping_id', id)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant',
          'tm.created_by',
          'tm.tag_id as definition_tag_id'
        )
        .first() as TagMappingDefinitionWithDefinitionIdRow | undefined;

      if (!existingTag) {
        throw new Error(`Tag with id ${id} not found`);
      }

      // Check basic update permission for entity
      const entityResource = getPermissionResource(existingTag.tagged_type);

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${existingTag.tagged_type.replace('_', ' ')}`);
      }

      // Check tag:delete permission for tags created by others
      // Permission model:
      // - Users with tag:delete permission can delete any tag
      // - Users without tag:delete permission can only delete tags they created
      // - Legacy tags (no created_by) can be deleted by anyone with entity update permission
      if (existingTag.created_by && existingTag.created_by !== currentUser.user_id) {
        if (!await hasPermissionAsync(currentUser, 'tag', 'delete', trx)) {
          await throwPermissionErrorAsync('delete this tag', 'You can only delete tags you created');
        }
      }

      const previousTags = await getTagTextSnapshot(
        trx,
        tenant,
        existingTag.tagged_id,
        existingTag.tagged_type
      );

      // id is actually mapping_id - just delete the mapping
      await TagMapping.delete(trx, tenant, id);
      const newTags = await getTagTextSnapshot(
        trx,
        tenant,
        existingTag.tagged_id,
        existingTag.tagged_type
      );

      // If caller explicitly wants to delete the orphaned definition, do so
      if (deleteDefinition) {
        const deletedDefinitions = await TagDefinition.deleteOrphaned(trx, tenant, [existingTag.definition_tag_id]);
        if (deletedDefinitions > 0) {
          await publishEvent({
            eventType: 'TAG_DEFINITION_DELETED',
            payload: {
              tenantId: tenant,
              tagId: existingTag.definition_tag_id,
              userId: currentUser.user_id,
              timestamp: new Date().toISOString(),
            },
          });
        }
      }

      const occurredAt = new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'TAG_REMOVED',
        payload: buildTagRemovedPayload({
          tagId: existingTag.definition_tag_id,
          entityType: existingTag.tagged_type,
          entityId: existingTag.tagged_id,
          removedByUserId: currentUser.user_id,
          removedAt: occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: currentUser.user_id },
        },
      });

      await publishEntityTagUpdateEvent({
        trx,
        tenant,
        taggedId: existingTag.tagged_id,
        taggedType: existingTag.tagged_type,
        userId: currentUser.user_id,
        occurredAt,
        previousTags,
        newTags,
      });
    } catch (error) {
      console.error(`Error deleting tag with id ${id}:`, error);
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Failed to delete tag with id ${id}`);
    }
  });
});

export const findTagsByEntityIds = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, entityIds: string[], entityType: TaggedEntityType): Promise<ITag[]> => {
  const { knex: db } = await createTenantKnex();
  try {
    if (entityIds.length === 0) {
      return [];
    }
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tagsWithDefinitions = await TagMapping.getByEntities(trx, tenant, entityIds, entityType);
      return tagsWithDefinitions.map(tag => ({
        tag_id: tag.mapping_id,
        tenant,
        board_id: tag.board_id || undefined,
        tag_text: tag.tag_text,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type,
        background_color: tag.background_color,
        text_color: tag.text_color
      }));
    });
  } catch (error) {
    console.error(`Error finding tags for ${entityType} ids: ${entityIds.join(', ')}:`, error);
    throw new Error(`Failed to find tags for ${entityType} ids: ${entityIds.join(', ')}`);
  }
});

export const getAllTags = withOptionalAuth(async (user: IUserWithRoles | null, ctx: AuthContext | null): Promise<ITag[]> => {
  try {
    if (!user || !ctx) {
      // Return empty array when no tenant context (e.g., during initial client render)
      console.warn('No tenant context available for getAllTags - returning empty array');
      return [];
    }

    const { knex: db } = await createTenantKnex();
    const { tenant } = ctx;
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Join mappings with definitions to create ITag structure
      const tags = await tagMappingsWithDefinitionsQuery(trx, tenant)
        .modify((query) => joinTagDefinitions(query, trx, tenant))
        .select(
          'tm.mapping_id as tag_id', // Use mapping_id as tag_id for backward compatibility
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        ) as ITag[];

      return tags;
    });
  } catch (error) {
    console.error('Error getting all tags:', error);
    throw new Error('Failed to get all tags');
  }
});

export const findAllTagsByType = withOptionalAuth(async (user: IUserWithRoles | null, ctx: AuthContext | null, entityType: TaggedEntityType): Promise<ITag[]> => {
  try {
    if (!user || !ctx) {
      console.warn(`No tenant context available for findAllTagsByType(${entityType}) - returning empty array`);
      return [];
    }

    const { knex: db } = await createTenantKnex();
    const { tenant } = ctx;
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get tag definitions that have at least one mapping (filter out orphans)
      // Use DISTINCT ON for deduplication by tag_text (PostgreSQL-specific but works with Citus)
      const scopedDb = tenantDb(trx, tenant);
      const tagMappingsQuery = scopedDb.table('tag_mappings as tm')
        .select(trx.raw('1'))
        .whereRaw('?? = ??', ['tm.tag_id', 'td.tag_id']);
      scopedDb.tenantWhereColumn(tagMappingsQuery, 'tm.tenant', 'td.tenant');

      const definitions = await scopedDb.table('tag_definitions as td')
        .distinctOn('td.tag_text')
        .select('td.*')
        .where('td.tagged_type', entityType)
        .whereExists(tagMappingsQuery)
        .orderBy('td.tag_text', 'asc')
        .orderBy('td.created_at', 'asc');

      // Convert to ITag format (use definition ID as tag_id since these are unique)
      return definitions.map((def: any) => ({
        tag_id: def.tag_id,
        tenant,
        board_id: def.board_id || undefined,
        tag_text: def.tag_text,
        tagged_id: '', // No specific entity for unique tags
        tagged_type: def.tagged_type,
        background_color: def.background_color,
        text_color: def.text_color
      }));
    });
  } catch (error) {
    console.error(`Error finding all tags for type ${entityType}:`, error);
    throw new Error(`Failed to find all tags for type: ${entityType}`);
  }
});

/**
 * Creates multiple tags for a newly created entity.
 * Used by quick add forms to apply pending tags after entity creation.
 * Continues even if individual tags fail (logs error but doesn't throw).
 *
 * @param entityId - The ID of the newly created entity
 * @param entityType - The type of entity (client, contact, ticket, project, project_task)
 * @param pendingTags - Array of pending tags to create
 * @returns Array of successfully created tags
 */
export async function createTagsForEntity(
  entityId: string,
  entityType: TaggedEntityType,
  pendingTags: PendingTag[]
): Promise<ITag[]> {
  const createdTags: ITag[] = [];

  for (const tag of pendingTags) {
    try {
      const newTag = await createTag({
        tag_text: tag.tag_text,
        tagged_id: entityId,
        tagged_type: entityType,
        background_color: tag.background_color,
        text_color: tag.text_color,
      }, { suppressEntityUpdateEvent: true });
      createdTags.push(newTag);
    } catch (error) {
      console.error(`Failed to create tag "${tag.tag_text}" for ${entityType}:`, error);
      // Continue with other tags - don't fail the entire operation
    }
  }

  return createdTags;
}

/**
 * Creates multiple tags for an entity within an existing transaction.
 * Use this when creating tags as part of a larger transactional operation
 * to ensure atomicity (e.g., during imports where rollback should remove all data).
 *
 * @param trx - The Knex transaction to use
 * @param entityId - The ID of the entity to tag
 * @param entityType - The type of entity (client, contact, ticket, project, project_task)
 * @param pendingTags - Array of pending tags to create
 * @returns Array of successfully created tags
 */
export const createTagsForEntityWithTransaction = withAuth(async (
  currentUser: IUserWithRoles,
  _ctx: AuthContext,
  trx: Knex.Transaction,
  tenant: string,
  entityId: string,
  entityType: TaggedEntityType,
  pendingTags: PendingTag[]
): Promise<ITag[]> => {
  const userId = currentUser.user_id;

  // Mirror createTag's gate: minting a brand-new tag definition requires
  // tag:create permission. Resolved once per call since pendingTags is small.
  const userHasTagCreate = await hasPermissionAsync(currentUser, 'tag', 'create', trx);

  const createdTags: ITag[] = [];

  for (const tag of pendingTags) {
    try {
      const tagText = tag.tag_text?.trim();
      if (!tagText) continue;

      // Validate length
      if (tagText.length > 50) {
        console.warn(`Tag text "${tagText}" too long, skipping`);
        continue;
      }

      if (!userHasTagCreate) {
        const existingDefinition = await TagDefinition.findByTextAndType(
          trx,
          tenant,
          tagText,
          entityType,
        );
        if (!existingDefinition) {
          throw new Error(`Permission denied: cannot create new tag "${tagText}"`);
        }
      }

      // Determine colors
      let backgroundColor = tag.background_color;
      let textColor = tag.text_color;

      if (!backgroundColor || !textColor) {
        const colors = await generateEntityColorAsync(tagText);
        backgroundColor = backgroundColor || colors.backgroundColor;
        textColor = textColor || colors.textColor;
      }

      // Get or create tag definition
      const { definition, created: createdDefinition } = await TagDefinition.getOrCreateWithStatus(
        trx,
        tenant,
        tagText,
        entityType,
        {
          background_color: backgroundColor,
          text_color: textColor
        }
      );
      
      // Create mapping
      const mapping = await TagMapping.insert(trx, tenant, {
        tag_id: definition.tag_id,
        tagged_id: entityId,
        tagged_type: entityType
      }, userId);

      const occurredAt = new Date().toISOString();
      if (createdDefinition) {
        await publishWorkflowEvent({
          eventType: 'TAG_DEFINITION_CREATED',
          payload: buildTagDefinitionCreatedPayload({
            tagId: definition.tag_id,
            tagName: definition.tag_text,
            createdByUserId: userId,
            createdAt: definition.created_at ?? occurredAt,
          }),
          ctx: {
            tenantId: tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: userId },
          },
        });
      }

      await publishWorkflowEvent({
        eventType: 'TAG_APPLIED',
        payload: buildTagAppliedPayload({
          tagId: definition.tag_id,
          entityType,
          entityId,
          appliedByUserId: userId,
          appliedAt: mapping.created_at ?? occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: userId },
        },
      });

      createdTags.push({
        tag_id: mapping.mapping_id,
        tenant,
        tag_text: tagText,
        tagged_id: entityId,
        tagged_type: entityType,
        background_color: backgroundColor,
        text_color: textColor
      });
    } catch (error) {
      console.error(`Failed to create tag "${tag.tag_text}" for ${entityType}:`, error);
      // Re-throw permission errors so the caller can attribute the failure
      // to the right cause; other errors are swallowed so a single bad tag
      // doesn't drop the rest.
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
    }
  }

  return createdTags;
});

/**
 * Apply a set of tag texts to many entities of one type in a single pass.
 *
 * Calling createTagsForEntityWithTransaction in a loop re-resolves the same tag
 * definitions, re-checks tag:create, and re-reads tag-set snapshots once per
 * entity — an N×(entities) query storm for what is otherwise identical work.
 * This resolves the tag:create permission and the (shared) tag definitions once,
 * then performs a single multi-row tag_mappings insert.
 *
 * The mapping insert uses ON CONFLICT DO NOTHING so a stale dedupe read or a
 * concurrent add can't roll back the whole batch on the unique mapping
 * constraint. Events match the per-entity path but fire only for rows actually
 * inserted: TAG_DEFINITION_CREATED once per newly minted definition, TAG_APPLIED
 * once per inserted (entity, tag) mapping, and one entity-update event
 * (PROJECT_TASK_UPDATED / TICKET_UPDATED) per entity that actually gained a tag
 * (project-task context is batch-resolved).
 *
 * @param applications  Per-entity tags to add. `existingTexts` is the entity's
 *   current tag set (drives the before/after update-event snapshot and skips
 *   duplicates); `newTexts` are the texts to apply.
 * @returns appliedByEntity — entityId -> tag texts that are present after the
 *   call (newly inserted or already there via a conflict). Requested texts
 *   absent from the result were dropped because they'd require minting a new
 *   definition and the user lacks tag:create.
 */
export const bulkApplyTagsToEntities = withAuth(async (
  currentUser: IUserWithRoles,
  _ctx: AuthContext,
  trx: Knex.Transaction,
  tenant: string,
  taggedType: TaggedEntityType,
  applications: Array<{ entityId: string; newTexts: string[]; existingTexts: string[] }>
): Promise<{ appliedByEntity: Record<string, string[]> }> => {
  const userId = currentUser.user_id;
  const appliedByEntity: Record<string, string[]> = {};

  // Dedupe each entity's requested texts against what it already has (and
  // against itself), and drop entities left with nothing to do.
  const normalized = applications
    .map((app) => {
      const existingLower = new Set(app.existingTexts.map((t) => t.toLowerCase()));
      const seen = new Set<string>();
      const newTexts: string[] = [];
      for (const raw of app.newTexts) {
        const text = raw.trim();
        if (!text) continue;
        const lower = text.toLowerCase();
        if (existingLower.has(lower) || seen.has(lower)) continue;
        seen.add(lower);
        newTexts.push(text);
      }
      return { entityId: app.entityId, existingTexts: app.existingTexts, newTexts };
    })
    .filter((app) => app.newTexts.length > 0);

  if (normalized.length === 0) {
    return { appliedByEntity };
  }

  // tag:create gate (mints brand-new definitions) resolved once for the batch.
  const userHasTagCreate = await hasPermissionAsync(currentUser, 'tag', 'create', trx);

  // Definitions are shared across entities — resolve each unique text once,
  // keyed by lowercased text while preserving the first-seen casing.
  const uniqueTexts = new Map<string, string>();
  for (const app of normalized) {
    for (const text of app.newTexts) {
      const lower = text.toLowerCase();
      if (!uniqueTexts.has(lower)) uniqueTexts.set(lower, text);
    }
  }

  const definitionByLowerText = new Map<string, ITagDefinition>();
  const createdDefinitions: ITagDefinition[] = [];
  for (const [lower, text] of uniqueTexts) {
    if (text.length > 50) {
      console.warn(`Tag text "${text}" too long, skipping`);
      continue;
    }
    if (!userHasTagCreate) {
      // Can only apply texts whose definition already exists.
      const existingDefinition = await TagDefinition.findByTextAndType(trx, tenant, text, taggedType);
      if (existingDefinition) {
        definitionByLowerText.set(lower, existingDefinition);
      }
      continue;
    }
    const colors = await generateEntityColorAsync(text);
    const { definition, created } = await TagDefinition.getOrCreateWithStatus(
      trx,
      tenant,
      text,
      taggedType,
      { background_color: colors.backgroundColor, text_color: colors.textColor },
    );
    definitionByLowerText.set(lower, definition);
    if (created) createdDefinitions.push(definition);
  }

  // Build every mapping row, then insert them in one statement.
  const rows: Array<{
    mapping_id: string;
    tenant: string;
    tag_id: string;
    tagged_id: string;
    tagged_type: TaggedEntityType;
    created_by: string;
  }> = [];
  for (const app of normalized) {
    // "applied" = texts that resolved to a definition, so the mapping will be
    // present after this call (whether we insert it or it already existed via a
    // conflict). The caller treats these as success; texts dropped here (no
    // permission to mint / too long) are surfaced as failures.
    const applied: string[] = [];
    for (const text of app.newTexts) {
      const definition = definitionByLowerText.get(text.toLowerCase());
      if (!definition) continue; // dropped: forbidden new tag or too long
      rows.push({
        mapping_id: uuidv4(),
        tenant,
        tag_id: definition.tag_id,
        tagged_id: app.entityId,
        tagged_type: taggedType,
        created_by: userId,
      });
      applied.push(text);
    }
    if (applied.length > 0) {
      appliedByEntity[app.entityId] = applied;
    }
  }

  if (rows.length === 0) {
    return { appliedByEntity };
  }

  // ON CONFLICT DO NOTHING: existing tags are read before the transaction, so a
  // stale read or a concurrent add could otherwise hit
  // unique(tenant, tag_id, tagged_id) and roll back the entire batch. RETURNING
  // yields only the rows we actually inserted, so events fire for real changes
  // only; a skipped row just means the tag is already present.
  const insertedRows = await tenantDb(trx, tenant).table('tag_mappings')
    .insert(rows)
    .onConflict(['tenant', 'tag_id', 'tagged_id'])
    .ignore()
    .returning(['tag_id', 'tagged_id']) as Array<{ tag_id: string; tagged_id: string }>;

  const occurredAt = new Date().toISOString();

  for (const definition of createdDefinitions) {
    await publishWorkflowEvent({
      eventType: 'TAG_DEFINITION_CREATED',
      payload: buildTagDefinitionCreatedPayload({
        tagId: definition.tag_id,
        tagName: definition.tag_text,
        createdByUserId: userId,
        createdAt: definition.created_at ?? occurredAt,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt,
        actor: { actorType: 'USER', actorUserId: userId },
      },
    });
  }

  // TAG_APPLIED per actually-inserted mapping; track which entities changed.
  const changedEntities = new Set<string>();
  for (const row of insertedRows) {
    await publishWorkflowEvent({
      eventType: 'TAG_APPLIED',
      payload: buildTagAppliedPayload({
        tagId: row.tag_id,
        entityType: taggedType,
        entityId: row.tagged_id,
        appliedByUserId: userId,
        appliedAt: occurredAt,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt,
        actor: { actorType: 'USER', actorUserId: userId },
      },
    });
    changedEntities.add(row.tagged_id);
  }

  // One entity-update event per entity that actually gained a tag. Re-read the
  // authoritative post-insert tag set in a single batched query rather than
  // computing existing ∪ inserted: a concurrent add could leave the entity with
  // tags beyond what we saw or inserted, and webhook consumers treat
  // changes.tags.new as the source of truth.
  const changedEntityIds = Array.from(changedEntities);
  const finalTagsByEntity = new Map<string, string[]>();
  for (const row of await TagMapping.getByEntities(trx, tenant, changedEntityIds, taggedType)) {
    const list = finalTagsByEntity.get(row.tagged_id) ?? [];
    list.push(row.tag_text);
    finalTagsByEntity.set(row.tagged_id, list);
  }
  const projectTaskContexts = taggedType === 'project_task'
    ? await resolveProjectTaskTagContexts(trx, tenant, changedEntityIds)
    : null;
  for (const app of normalized) {
    if (!changedEntities.has(app.entityId)) continue;
    const previousTags = Array.from(new Set(app.existingTexts)).sort((a, b) => a.localeCompare(b));
    const newTags = Array.from(new Set(finalTagsByEntity.get(app.entityId) ?? [])).sort((a, b) => a.localeCompare(b));
    await publishEntityTagUpdateEvent({
      trx,
      tenant,
      taggedId: app.entityId,
      taggedType,
      userId,
      occurredAt,
      previousTags,
      newTags,
      projectTaskContext: projectTaskContexts
        ? (projectTaskContexts.get(app.entityId) ?? null)
        : undefined,
    });
  }

  return { appliedByEntity };
});

export const updateTagColor = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, tagId: string, backgroundColor: string | null, textColor: string | null): Promise<{ tag_text: string; background_color: string | null; text_color: string | null; }> => {
  const { knex: db } = await createTenantKnex();

  // Validate hex color codes if provided
  const hexColorRegex = /^#[0-9A-F]{6}$/i;
  if (backgroundColor && !hexColorRegex.test(backgroundColor)) {
    throw new Error('Invalid background color format. Must be a valid hex color code (e.g., #FF0000)');
  }
  if (textColor && !hexColorRegex.test(textColor)) {
    throw new Error('Invalid text color format. Must be a valid hex color code (e.g., #FFFFFF)');
  }

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // tagId is actually mapping_id in the new system
      const tag = await tagMappingsWithDefinitionsQuery(trx, tenant)
        .modify((query) => joinTagDefinitions(query, trx, tenant))
        .where('tm.mapping_id', tagId)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        )
        .first() as TagMappingDefinitionRow | undefined;

      if (!tag) {
        throw new Error(`Tag with id ${tagId} not found`);
      }

      // Check permissions
      const entityResource = getPermissionResource(tag.tagged_type);

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${tag.tagged_type.replace('_', ' ')}`);
      }

      if (!await hasPermissionAsync(currentUser, 'tag', 'update', trx)) {
        await throwPermissionErrorAsync('update tag colors');
      }

      // Find the definition and update it
      const definition = await TagDefinition.findByTextAndType(trx, tenant, tag.tag_text, tag.tagged_type);
      if (definition) {
        await TagDefinition.update(trx, tenant, definition.tag_id, {
          background_color: backgroundColor,
          text_color: textColor
        });

        const occurredAt = new Date().toISOString();
        await publishWorkflowEvent({
          eventType: 'TAG_DEFINITION_UPDATED',
          payload: buildTagDefinitionUpdatedPayload({
            tagId: definition.tag_id,
            previousName: tag.tag_text,
            newName: tag.tag_text,
            updatedByUserId: currentUser.user_id,
            updatedAt: occurredAt,
          }),
          ctx: {
            tenantId: tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: currentUser.user_id },
          },
        });
      }
      return {
        tag_text: tag.tag_text,
        background_color: backgroundColor,
        text_color: textColor,
      };
    });
  } catch (error) {
    console.error(`Error updating tag color for tag id ${tagId}:`, error);
    if (error instanceof Error && error.message.includes('Permission denied')) {
      throw error;
    }
    throw new Error(`Failed to update tag color for tag id ${tagId}`);
  }
});

export const updateTagText = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, tagId: string, newTagText: string): Promise<{ old_tag_text: string; new_tag_text: string; tagged_type: TaggedEntityType; updated_count: number; }> => {
  const { knex: db } = await createTenantKnex();

  // Validate tag text
  if (!newTagText || !newTagText.trim()) {
    throw new Error('Tag text cannot be empty');
  }

  const trimmedNewText = newTagText.trim();

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // tagId is actually mapping_id in the new system
      const tag = await tagMappingsWithDefinitionsQuery(trx, tenant)
        .modify((query) => joinTagDefinitions(query, trx, tenant))
        .where('tm.mapping_id', tagId)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        )
        .first() as TagMappingDefinitionRow | undefined;

      if (!tag) {
        throw new Error(`Tag with id ${tagId} not found`);
      }

      // Check permissions
      const entityResource = getPermissionResource(tag.tagged_type);

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${tag.tagged_type.replace('_', ' ')}`);
      }

      if (!await hasPermissionAsync(currentUser, 'tag', 'update', trx)) {
        await throwPermissionErrorAsync('update tag text');
      }

      // Don't update if text is the same
      if (tag.tag_text === trimmedNewText) {
        return {
          old_tag_text: tag.tag_text,
          new_tag_text: trimmedNewText,
          tagged_type: tag.tagged_type,
          updated_count: 0,
        };
      }

      // Find the old definition
      const oldDefinition = await TagDefinition.findByTextAndType(trx, tenant, tag.tag_text, tag.tagged_type);

      if (!oldDefinition) {
        return {
          old_tag_text: tag.tag_text,
          new_tag_text: trimmedNewText,
          tagged_type: tag.tagged_type,
          updated_count: 0,
        };
      }

      // Check if new tag text already exists
      const newDefinition = await TagDefinition.findByTextAndType(trx, tenant, trimmedNewText, tag.tagged_type);

      if (newDefinition) {
        throw new Error(`Tag "${trimmedNewText}" already exists for ${tag.tagged_type} entities`);
      }

      // Update the definition
      await TagDefinition.update(trx, tenant, oldDefinition.tag_id, {
        tag_text: trimmedNewText
      });

      const occurredAt = new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'TAG_DEFINITION_UPDATED',
        payload: buildTagDefinitionUpdatedPayload({
          tagId: oldDefinition.tag_id,
          previousName: tag.tag_text,
          newName: trimmedNewText,
          updatedByUserId: currentUser.user_id,
          updatedAt: occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: currentUser.user_id },
        },
      });


      // Return count of affected mappings
      const updatedCount = await TagMapping.getUsageCount(trx, tenant, oldDefinition.tag_id);

      return {
        old_tag_text: tag.tag_text,
        new_tag_text: trimmedNewText,
        tagged_type: tag.tagged_type,
        updated_count: updatedCount,
      };
    });
  } catch (error) {
    console.error(`Error updating tag text for tag id ${tagId}:`, error);
    if (error instanceof Error && (error.message.includes('already exists') || error.message.includes('Permission denied'))) {
      throw error;
    }
    throw new Error(`Failed to update tag text for tag id ${tagId}`);
  }
});

export const checkTagPermissions = withOptionalAuth(async (currentUser: IUserWithRoles | null, _ctx: AuthContext | null, taggedType: TaggedEntityType): Promise<{
  canAddExisting: boolean;
  canCreateNew: boolean;
  canEditColors: boolean;
  canEditText: boolean;
  canDelete: boolean;
  canDeleteAll: boolean;
}> => {
  try {
    if (!currentUser) {
      return {
        canAddExisting: false,
        canCreateNew: false,
        canEditColors: false,
        canEditText: false,
        canDelete: false,
        canDeleteAll: false
      };
    }

    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Map tagged entity types to their permission resource equivalents
      const permissionEntity = getPermissionResource(taggedType);

      // Check all permissions in parallel
      const [entityUpdate, tagCreate, tagUpdate, tagDelete] = await Promise.all([
        hasPermissionAsync(currentUser, permissionEntity, 'update', trx),
        hasPermissionAsync(currentUser, 'tag', 'create', trx),
        hasPermissionAsync(currentUser, 'tag', 'update', trx),
        hasPermissionAsync(currentUser, 'tag', 'delete', trx)
      ]);

      return {
        canAddExisting: entityUpdate,
        canCreateNew: entityUpdate && tagCreate,
        canEditColors: entityUpdate && tagUpdate,
        canEditText: entityUpdate && tagUpdate,
        canDelete: entityUpdate,
        canDeleteAll: entityUpdate && tagDelete
      };
    });
  } catch (error) {
    console.error('Error checking tag permissions:', error);
    // Return no permissions on error
    return {
      canAddExisting: false,
      canCreateNew: false,
      canEditColors: false,
      canEditText: false,
      canDelete: false,
      canDeleteAll: false
    };
  }
});

export const deleteAllTagsByText = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, tagText: string, taggedType: TaggedEntityType): Promise<{ deleted_count: number }> => {
  const { knex: db } = await createTenantKnex();

  // Validate tag text
  if (!tagText || !tagText.trim()) {
    throw new Error('Tag text cannot be empty');
  }

  const trimmedText = tagText.trim();

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check permissions
      const entityResource = getPermissionResource(taggedType);

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${taggedType.replace('_', ' ')}`);
      }

      if (!await hasPermissionAsync(currentUser, 'tag', 'delete', trx)) {
        await throwPermissionErrorAsync('delete all instances of tags');
      }

      // Find the definition and delete it (mappings will cascade delete)
      const definition = await TagDefinition.findByTextAndType(trx, tenant, trimmedText, taggedType);

      if (!definition) {
        return {
          deleted_count: 0,
        };
      }

      // Get count before deletion
      const deletedCount = await TagMapping.getUsageCount(trx, tenant, definition.tag_id);

      // Delete the definition (mappings will cascade delete)
      await TagDefinition.delete(trx, tenant, definition.tag_id);

      return {
        deleted_count: deletedCount,
      };
    });
  } catch (error) {
    console.error(`Error deleting tags with text "${tagText}" and type ${taggedType}:`, error);
    if (error instanceof Error && error.message.includes('Permission denied')) {
      throw error;
    }
    throw new Error(`Failed to delete tags with text "${tagText}"`);
  }
});
