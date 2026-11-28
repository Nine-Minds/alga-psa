import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { TagModel } from '../../../../models/tagModel';
import type { TaggedEntityType } from '../../../../interfaces/tag.interfaces';
import {
  addTagsToEntity,
  removeTagsFromEntity,
} from '../../../../services/tags/applyTagChanges';
import {
  uuidSchema,
  actionProvidedKey,
  withTenantTransaction,
  admitWorkflowTagWrite,
  requirePermission,
  writeRunAudit,
  throwActionError,
  rethrowAsStandardError,
} from './shared';

// Entity type -> table + primary key (proves the entity exists before any tag row is written) and the
// RBAC resource whose 'update' permission the actor needs, matching what each entity's own workflow
// actions / UI require. Knowledge base has only a 'knowledge_base:read' grant; articles are documents, so document:update governs.
// LEVERAGE: pattern taggable-entity-registry — TaggedEntityType -> table/id column is re-derived here; tag_mappings has no FK to the entity, so nothing shared owns this mapping
const TAGGED_ENTITY_TABLES: Record<TaggedEntityType, { table: string; idColumn: string; permissionResource: string }> = {
  ticket: { table: 'tickets', idColumn: 'ticket_id', permissionResource: 'ticket' },
  client: { table: 'clients', idColumn: 'client_id', permissionResource: 'client' },
  contact: { table: 'contacts', idColumn: 'contact_name_id', permissionResource: 'contact' },
  project_task: { table: 'project_tasks', idColumn: 'task_id', permissionResource: 'project_task' },
  document: { table: 'documents', idColumn: 'document_id', permissionResource: 'document' },
  knowledge_base_article: { table: 'knowledge_base_articles', idColumn: 'article_id', permissionResource: 'document' },
  opportunity: { table: 'opportunities', idColumn: 'opportunity_id', permissionResource: 'opportunities' },
};

const entityTypeSchema = z
  .enum(Object.keys(TAGGED_ENTITY_TABLES) as [TaggedEntityType, ...TaggedEntityType[]])
  .describe('Type of entity to tag');

const tagInputSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: uuidSchema.describe('Id of the entity to tag'),
  tags: z.array(z.string()).min(1).describe('Tag texts (trimmed; matched case-insensitively against existing tags)'),
  idempotency_key: z.string().optional().describe('Optional external idempotency key'),
});

const tagTextsSchema = z.array(z.string()).describe('Tag texts on the entity after the change');

async function ensureEntityExists(
  ctx: Parameters<typeof throwActionError>[0],
  tx: Parameters<typeof admitWorkflowTagWrite>[1],
  entityType: TaggedEntityType,
  entityId: string
): Promise<void> {
  const { table, idColumn } = TAGGED_ENTITY_TABLES[entityType];
  const row = await tenantDb(tx.trx, tx.tenantId).table(table).where(idColumn, entityId).first(idColumn);
  if (!row) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: `${entityType} not found`,
      details: { entity_type: entityType, entity_id: entityId },
    });
  }
}

async function tagTextsFor(
  tx: Parameters<typeof admitWorkflowTagWrite>[1],
  entityType: TaggedEntityType,
  entityId: string
): Promise<string[]> {
  const rows = await TagModel.getTagsByEntity(entityId, entityType, tx.tenantId, tx.trx);
  return rows.map((r) => String(r.tag_text)).sort((a, b) => a.localeCompare(b));
}

export function registerTagActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'tags.add',
    version: 1,
    inputSchema: tagInputSchema,
    outputSchema: z.object({
      entity_type: entityTypeSchema,
      entity_id: uuidSchema,
      tags: tagTextsSchema,
      added_count: z.number().int().describe('Tags newly attached'),
      skipped_count: z.number().int().describe('Tags already attached'),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Tags',
      category: 'Tags',
      description: 'Attach tags to a ticket, client, contact, or other taggable entity. Missing tags are created; already-attached tags are skipped.',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await ensureEntityExists(ctx, tx, input.entity_type, input.entity_id);
        await requirePermission(ctx, tx, { resource: TAGGED_ENTITY_TABLES[input.entity_type].permissionResource, action: 'update' });
        await admitWorkflowTagWrite(ctx, tx);

        let result;
        try {
          result = await addTagsToEntity(tx.trx, tx.tenantId, {
            entityType: input.entity_type,
            entityId: input.entity_id,
            tags: input.tags,
            actorUserId: tx.actorUserId,
          });
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:tags.add',
          changedData: { entity_type: input.entity_type, entity_id: input.entity_id, ...result },
          details: { action_id: 'tags.add', action_version: 1, entity_type: input.entity_type, entity_id: input.entity_id },
        });

        return {
          entity_type: input.entity_type,
          entity_id: input.entity_id,
          tags: await tagTextsFor(tx, input.entity_type, input.entity_id),
          added_count: result.added,
          skipped_count: result.skipped,
        };
      }),
  });

  registry.register({
    id: 'tags.remove',
    version: 1,
    inputSchema: tagInputSchema,
    outputSchema: z.object({
      entity_type: entityTypeSchema,
      entity_id: uuidSchema,
      tags: tagTextsSchema,
      removed_count: z.number().int().describe('Tags detached'),
      missing_count: z.number().int().describe('Tags that were not attached'),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Remove Tags',
      category: 'Tags',
      description: 'Detach tags from a ticket, client, contact, or other taggable entity. Tags not attached are ignored; tag definitions are kept.',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await ensureEntityExists(ctx, tx, input.entity_type, input.entity_id);
        await requirePermission(ctx, tx, { resource: TAGGED_ENTITY_TABLES[input.entity_type].permissionResource, action: 'update' });
        await admitWorkflowTagWrite(ctx, tx);

        let result;
        try {
          result = await removeTagsFromEntity(tx.trx, tx.tenantId, {
            entityType: input.entity_type,
            entityId: input.entity_id,
            tags: input.tags,
          });
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:tags.remove',
          changedData: { entity_type: input.entity_type, entity_id: input.entity_id, ...result },
          details: { action_id: 'tags.remove', action_version: 1, entity_type: input.entity_type, entity_id: input.entity_id },
        });

        return {
          entity_type: input.entity_type,
          entity_id: input.entity_id,
          tags: await tagTextsFor(tx, input.entity_type, input.entity_id),
          removed_count: result.removed,
          missing_count: result.missing,
        };
      }),
  });
}
