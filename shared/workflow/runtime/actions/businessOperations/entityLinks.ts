import { z } from 'zod';
import WorkflowEntityLinkModel, { type WorkflowEntityRef } from '../../../persistence/workflowEntityLinkModel';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  actionProvidedKey,
  requirePermission,
  throwActionError,
  withTenantTransaction,
  writeRunAudit,
} from './shared';

const MAX_LABEL_LENGTH = 256;
const workflowPermission = {
  read: { resource: 'workflow', action: 'read' },
  manage: { resource: 'workflow', action: 'manage' },
} as const;

const softEnumText = (description: string, hint: string): z.ZodString =>
  withWorkflowJsonSchemaMetadata(z.string().trim().min(1).max(MAX_LABEL_LENGTH), description, {
    'x-workflow-editor': {
      kind: 'custom',
      allowsDynamicReference: true,
      fixedValueHint: hint,
    },
  });

const namespaceSchema = softEnumText('Entity-link namespace', 'Namespace');
const entityTypeSchema = softEnumText('Entity type', 'Entity type');
const relationSchema = softEnumText('Entity-link relation', 'Relation');
const entityIdSchema = withWorkflowJsonSchemaMetadata(z.string().trim().min(1).max(MAX_LABEL_LENGTH), 'Entity id', {
  'x-workflow-editor': {
    kind: 'text',
    allowsDynamicReference: true,
    fixedValueHint: 'Entity id',
  },
});

const idempotencyKeySchema = z.string().trim().min(1).max(MAX_LABEL_LENGTH).optional();
const cursorSchema = z.union([z.number().int().nonnegative(), z.string().trim().min(1)]).optional();

const entityRefSchema = z.object({
  type: entityTypeSchema,
  id: entityIdSchema,
});

const linkItemOutputSchema = z.object({
  link_id: z.string().uuid(),
  namespace: z.string(),
  left: z.object({ type: z.string(), id: z.string() }),
  right: z.object({ type: z.string(), id: z.string() }),
  relation: z.string(),
  attributes: z.record(z.unknown()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const upsertInputSchema = z.object({
  namespace: namespaceSchema,
  left: entityRefSchema,
  right: entityRefSchema,
  relation: relationSchema.default('related'),
  attributes: z.record(z.unknown()).default({}),
  idempotency_key: idempotencyKeySchema,
});

const upsertOutputSchema = z.object({
  link_id: z.string().uuid(),
  created: z.boolean(),
});

const lookupInputSchema = z.object({
  namespace: namespaceSchema,
  from: entityRefSchema,
  direction: z.enum(['forward', 'reverse', 'either']).default('forward'),
  relation: relationSchema.optional(),
  right_type: entityTypeSchema.optional(),
  limit: z.number().int().positive().max(200).default(100),
});

const lookupOutputSchema = z.object({
  matches: z.array(z.object({
    link_id: z.string().uuid(),
    type: z.string(),
    id: z.string(),
    relation: z.string(),
    attributes: z.record(z.unknown()),
  })),
});

const deleteInputSchema = z.object({
  namespace: namespaceSchema,
  left: entityRefSchema.optional(),
  right: entityRefSchema.optional(),
  relation: relationSchema.optional(),
  idempotency_key: idempotencyKeySchema,
}).refine((input) => Boolean(input.left || input.right), {
  message: 'left or right is required',
  path: ['left'],
});

const deleteOutputSchema = z.object({
  deleted_count: z.number(),
});

const listInputSchema = z.object({
  namespace: namespaceSchema,
  left_type: entityTypeSchema.optional(),
  right_type: entityTypeSchema.optional(),
  relation: relationSchema.optional(),
  limit: z.number().int().positive().max(200).default(100),
  cursor: cursorSchema,
});

const listOutputSchema = z.object({
  items: z.array(linkItemOutputSchema),
  next_cursor: z.number().nullable(),
});

const listNamespacesInputSchema = z.object({});
const listNamespacesOutputSchema = z.object({
  namespaces: z.array(z.object({
    namespace: z.string(),
    link_count: z.number(),
  })),
});

const toLinkItem = (item: Awaited<ReturnType<typeof WorkflowEntityLinkModel.list>>['items'][number]) => ({
  link_id: item.link_id,
  namespace: item.namespace,
  left: { type: item.left_type, id: item.left_id },
  right: { type: item.right_type, id: item.right_id },
  relation: item.relation,
  attributes: item.attributes ?? {},
  created_at: new Date(item.created_at).toISOString(),
  updated_at: new Date(item.updated_at).toISOString(),
});

const toEntityRef = (value: z.infer<typeof entityRefSchema>): WorkflowEntityRef => ({
  type: String(value.type),
  id: String(value.id),
});

export function registerEntityLinkActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'links.upsert',
    version: 1,
    inputSchema: upsertInputSchema,
    outputSchema: upsertOutputSchema,
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Upsert Entity Link',
      category: 'Data Store',
      description: 'Create or update a persisted link between two workflow entities.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.manage);
      const result = await WorkflowEntityLinkModel.upsert(tx.trx, tx.tenantId, {
        namespace: input.namespace,
        left: toEntityRef(input.left),
        right: toEntityRef(input.right),
        relation: input.relation,
        attributes: input.attributes,
        created_by_run_id: ctx.runId,
      });
      await writeRunAudit(ctx, tx, {
        operation: 'links.upsert',
        changedData: {
          namespace: input.namespace,
          left: toEntityRef(input.left),
          right: toEntityRef(input.right),
          relation: input.relation,
          link_id: result.record.link_id,
        },
        details: { action_id: 'links.upsert', action_version: 1, namespace: input.namespace, link_id: result.record.link_id },
      });
      return { link_id: result.record.link_id, created: result.created };
    }),
  });

  registry.register({
    id: 'links.lookup',
    version: 1,
    inputSchema: lookupInputSchema,
    outputSchema: lookupOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Lookup Entity Links',
      category: 'Data Store',
      description: 'Find persisted entity links by source entity and direction.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.read);
      return WorkflowEntityLinkModel.lookup(tx.trx, tx.tenantId, {
        namespace: input.namespace,
        from: toEntityRef(input.from),
        direction: input.direction,
        relation: input.relation,
        right_type: input.right_type,
        limit: input.limit,
      });
    }),
  });

  registry.register({
    id: 'links.delete',
    version: 1,
    inputSchema: deleteInputSchema,
    outputSchema: deleteOutputSchema,
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Delete Entity Links',
      category: 'Data Store',
      description: 'Delete persisted entity links by side and optional relation.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.manage);
      let deletedCount = 0;
      try {
        deletedCount = await WorkflowEntityLinkModel.delete(tx.trx, tx.tenantId, {
          namespace: input.namespace,
          left: input.left ? toEntityRef(input.left) : undefined,
          right: input.right ? toEntityRef(input.right) : undefined,
          relation: input.relation,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'WORKFLOW_ENTITY_LINK_DELETE_REQUIRES_LEFT_OR_RIGHT') {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'links.delete requires left or right criteria',
          });
        }
        throw error;
      }
      await writeRunAudit(ctx, tx, {
        operation: 'links.delete',
        changedData: { namespace: input.namespace, left: input.left ?? null, right: input.right ?? null, relation: input.relation ?? null, deleted_count: deletedCount },
        details: { action_id: 'links.delete', action_version: 1, namespace: input.namespace },
      });
      return { deleted_count: deletedCount };
    }),
  });

  registry.register({
    id: 'links.list',
    version: 1,
    inputSchema: listInputSchema,
    outputSchema: listOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'List Entity Links',
      category: 'Data Store',
      description: 'List persisted entity links in a namespace.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.read);
      const result = await WorkflowEntityLinkModel.list(tx.trx, tx.tenantId, input.namespace, {
        left_type: input.left_type,
        right_type: input.right_type,
        relation: input.relation,
        limit: input.limit,
        cursor: input.cursor,
      });
      return {
        items: result.items.map(toLinkItem),
        next_cursor: result.next_cursor,
      };
    }),
  });

  registry.register({
    id: 'links.list_namespaces',
    version: 1,
    inputSchema: listNamespacesInputSchema,
    outputSchema: listNamespacesOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'List Link Namespaces',
      category: 'Data Store',
      description: 'List workflow entity-link namespaces used by this tenant.',
    },
    handler: async (_input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.read);
      const namespaces = await WorkflowEntityLinkModel.listNamespaces(tx.trx, tx.tenantId);
      return { namespaces };
    }),
  });
}
