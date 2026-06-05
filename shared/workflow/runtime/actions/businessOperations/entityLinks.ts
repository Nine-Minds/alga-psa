import { z } from 'zod';
import WorkflowEntityLinkModel, { type WorkflowEntityRef } from '../../../persistence/workflowEntityLinkModel';
import { withWorkflowJsonSchemaMetadata, type WorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
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

const softEnumText = (
  description: string,
  hint: string,
  softEnum: NonNullable<NonNullable<WorkflowJsonSchemaMetadata['x-workflow-editor']>['softEnum']>
): z.ZodString =>
  withWorkflowJsonSchemaMetadata(z.string().trim().min(1).max(MAX_LABEL_LENGTH), description, {
    'x-workflow-editor': {
      kind: 'custom',
      inline: { mode: 'input' },
      allowsDynamicReference: true,
      fixedValueHint: hint,
      softEnum,
    },
  });

const namespaceSchema = softEnumText('Collection that groups related links together, like a folder (e.g. project-task-mirror).', 'Collection', {
  component: 'soft-enum-combobox',
  suggestionKind: 'workflow-data-store-namespace',
  suggestionActionIds: ['links.list_namespaces', 'store.list_namespaces'],
  allowCustomValue: true,
});
const entityTypeSchema = softEnumText('What kind of record this is (e.g. project_task, ticket, contact).', 'Record type', {
  component: 'soft-enum-combobox',
  suggestionKind: 'workflow-entity-type',
  namespaceField: 'namespace',
  allowCustomValue: true,
});
const relationSchema = softEnumText('How the two records are related (e.g. mirrors, maps_to).', 'Relationship', {
  component: 'soft-enum-combobox',
  suggestionKind: 'workflow-link-relation',
  namespaceField: 'namespace',
  allowCustomValue: true,
});
const entityIdSchema = withWorkflowJsonSchemaMetadata(z.string().trim().min(1).max(MAX_LABEL_LENGTH), 'The record id — usually mapped from an earlier step or the trigger payload.', {
  'x-workflow-editor': {
    kind: 'text',
    inline: { mode: 'input' },
    allowsDynamicReference: true,
    fixedValueHint: 'Record id',
  },
});

const idempotencyKeySchema = z.string().trim().min(1).max(MAX_LABEL_LENGTH)
  .describe('(Advanced) Optional. Prevents duplicate writes if the step retries; leave blank and the workflow fills it in automatically.')
  .optional();
const cursorSchema = z.union([z.number().int().nonnegative(), z.string().trim().min(1)]).optional();

const entityRefSchema = z.object({
  type: entityTypeSchema,
  id: entityIdSchema,
});

const fromRefSchema = entityRefSchema.describe('The record this link starts from.');
const toRefSchema = entityRefSchema.describe('The record this link points to.');

const linkItemOutputSchema = z.object({
  link_id: z.string().uuid(),
  namespace: z.string(),
  from: z.object({ type: z.string(), id: z.string() }),
  to: z.object({ type: z.string(), id: z.string() }),
  relation: z.string(),
  attributes: z.record(z.unknown()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const upsertInputSchema = z.object({
  namespace: namespaceSchema,
  from: fromRefSchema,
  to: toRefSchema,
  relation: relationSchema.default('related'),
  attributes: z.record(z.unknown()).default({}).describe('Optional extra details to store on the link (advanced).'),
  idempotency_key: idempotencyKeySchema,
});

const upsertOutputSchema = z.object({
  link_id: z.string().uuid(),
  created: z.boolean(),
});

const lookupInputSchema = z.object({
  namespace: namespaceSchema,
  from: fromRefSchema,
  direction: z.enum(['forward', 'reverse', 'either']).default('forward')
    .describe('Which way to follow the link: forward (from → to), reverse (to → from), or either.'),
  relation: relationSchema.optional(),
  to_type: entityTypeSchema.optional(),
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
  from: fromRefSchema.optional(),
  to: toRefSchema.optional(),
  relation: relationSchema.optional(),
  idempotency_key: idempotencyKeySchema,
}).refine((input) => Boolean(input.from || input.to), {
  message: 'from or to is required',
  path: ['from'],
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
  from: { type: item.left_type, id: item.left_id },
  to: { type: item.right_type, id: item.right_id },
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
        left: toEntityRef(input.from),
        right: toEntityRef(input.to),
        relation: input.relation,
        attributes: input.attributes,
        created_by_run_id: ctx.runId,
      });
      await writeRunAudit(ctx, tx, {
        operation: 'links.upsert',
        changedData: {
          namespace: input.namespace,
          from: toEntityRef(input.from),
          to: toEntityRef(input.to),
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
        right_type: input.to_type,
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
          left: input.from ? toEntityRef(input.from) : undefined,
          right: input.to ? toEntityRef(input.to) : undefined,
          relation: input.relation,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'WORKFLOW_ENTITY_LINK_DELETE_REQUIRES_LEFT_OR_RIGHT') {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'links.delete requires a from or to record',
          });
        }
        throw error;
      }
      await writeRunAudit(ctx, tx, {
        operation: 'links.delete',
        changedData: { namespace: input.namespace, from: input.from ?? null, to: input.to ?? null, relation: input.relation ?? null, deleted_count: deletedCount },
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
