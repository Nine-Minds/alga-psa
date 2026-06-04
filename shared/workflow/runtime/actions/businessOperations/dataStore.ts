import { z } from 'zod';
import { Buffer } from 'buffer';
import { env } from 'process';
import WorkflowDataStoreModel from '../../../persistence/workflowDataStoreModel';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  actionProvidedKey,
  requirePermission,
  throwActionError,
  withTenantTransaction,
  writeRunAudit,
} from './shared';

export const WORKFLOW_STORE_MAX_VALUE_BYTES = Number(
  env.WORKFLOW_STORE_MAX_VALUE_BYTES ?? 256 * 1024
);

const MAX_LABEL_LENGTH = 256;
const workflowPermission = {
  read: { resource: 'workflow', action: 'read' },
  manage: { resource: 'workflow', action: 'manage' },
} as const;

const namespaceSchema = withWorkflowJsonSchemaMetadata(
  z.string().trim().min(1).max(MAX_LABEL_LENGTH),
  'Data-store namespace',
  {
    'x-workflow-editor': {
      kind: 'custom',
      allowsDynamicReference: true,
      fixedValueHint: 'Namespace',
    },
  }
);

const keySchema = withWorkflowJsonSchemaMetadata(
  z.string().trim().min(1).max(MAX_LABEL_LENGTH),
  'Data-store key',
  {
    'x-workflow-editor': {
      kind: 'text',
      allowsDynamicReference: true,
      fixedValueHint: 'Key',
    },
  }
);

const jsonValueSchema = withWorkflowJsonSchemaMetadata(z.any(), 'JSON value to persist', {
  'x-workflow-editor': {
    kind: 'json',
    allowsDynamicReference: true,
    fixedValueHint: 'Value',
  },
});

const idempotencyKeySchema = z.string().trim().min(1).max(MAX_LABEL_LENGTH).optional();
const valueTypeSchema = z.enum(['string', 'number', 'boolean', 'json']).default('json');
const cursorSchema = z.union([z.number().int().nonnegative(), z.string().trim().min(1)]).optional();

const storeRecordOutputSchema = z.object({
  store_id: z.string().uuid(),
  namespace: z.string(),
  key: z.string(),
  value: z.any(),
  value_type: z.string(),
  revision: z.number(),
  expires_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const getInputSchema = z.object({
  namespace: namespaceSchema,
  key: keySchema,
});

const getOutputSchema = z.object({
  found: z.boolean(),
  value: z.any().nullable(),
  value_type: z.string().nullable(),
  revision: z.number().nullable(),
  expires_at: z.string().datetime().nullable(),
});

const setInputSchema = z.object({
  namespace: namespaceSchema,
  key: keySchema,
  value: jsonValueSchema,
  value_type: valueTypeSchema.optional(),
  ttl_seconds: z.number().int().positive().max(31_536_000).optional(),
  if_revision: z.number().int().nonnegative().optional(),
  idempotency_key: idempotencyKeySchema,
});

const setOutputSchema = z.object({
  revision: z.number(),
  created: z.boolean(),
});

const deleteInputSchema = z.object({
  namespace: namespaceSchema,
  key: keySchema,
  idempotency_key: idempotencyKeySchema,
});

const deleteOutputSchema = z.object({
  deleted: z.boolean(),
});

const incrementInputSchema = z.object({
  namespace: namespaceSchema,
  key: keySchema,
  by: z.number().finite().default(1),
  initial: z.number().finite().default(0),
  idempotency_key: idempotencyKeySchema,
});

const incrementOutputSchema = z.object({
  value: z.number(),
  revision: z.number(),
});

const listInputSchema = z.object({
  namespace: namespaceSchema,
  prefix: z.string().trim().max(MAX_LABEL_LENGTH).optional(),
  limit: z.number().int().positive().max(200).default(100),
  cursor: cursorSchema,
});

const listOutputSchema = z.object({
  items: z.array(storeRecordOutputSchema),
  next_cursor: z.number().nullable(),
});

const listNamespacesInputSchema = z.object({});
const listNamespacesOutputSchema = z.object({
  namespaces: z.array(z.object({
    namespace: z.string(),
    key_count: z.number(),
  })),
});

const expiresAtFromTtl = (ttlSeconds: number | undefined, nowIso: string): string | null => {
  if (ttlSeconds === undefined) return null;
  return new Date(new Date(nowIso).getTime() + ttlSeconds * 1000).toISOString();
};

const valueSizeBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const assertValueSize = (value: unknown, ctx: Parameters<typeof throwActionError>[0]): void => {
  const sizeBytes = valueSizeBytes(value);
  if (sizeBytes <= WORKFLOW_STORE_MAX_VALUE_BYTES) return;
  throwActionError(ctx, {
    category: 'ValidationError',
    code: 'VALIDATION_ERROR',
    message: `workflow data-store value exceeds ${WORKFLOW_STORE_MAX_VALUE_BYTES} bytes`,
    details: { size_bytes: sizeBytes, max_bytes: WORKFLOW_STORE_MAX_VALUE_BYTES },
  });
};

export function registerDataStoreActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'store.get',
    version: 1,
    inputSchema: getInputSchema,
    outputSchema: getOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Get Stored Value',
      category: 'Data Store',
      description: 'Read a persisted workflow key/value entry.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.read);
      const record = await WorkflowDataStoreModel.get(tx.trx, tx.tenantId, input.namespace, input.key);
      if (!record) {
        return { found: false, value: null, value_type: null, revision: null, expires_at: null };
      }
      return {
        found: true,
        value: record.value,
        value_type: record.value_type,
        revision: Number(record.revision),
        expires_at: record.expires_at ?? null,
      };
    }),
  });

  registry.register({
    id: 'store.set',
    version: 1,
    inputSchema: setInputSchema,
    outputSchema: setOutputSchema,
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Set Stored Value',
      category: 'Data Store',
      description: 'Persist a workflow key/value entry.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.manage);
      assertValueSize(input.value, ctx);
      const result = await WorkflowDataStoreModel.set(tx.trx, tx.tenantId, {
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        value_type: input.value_type ?? 'json',
        expires_at: expiresAtFromTtl(input.ttl_seconds, ctx.nowIso()),
        created_by_run_id: ctx.runId,
        if_revision: input.if_revision,
      });
      if (result.conflict || !result.record) {
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'CONFLICT',
          message: 'workflow data-store revision conflict',
          details: { namespace: input.namespace, key: input.key, if_revision: input.if_revision ?? null },
        });
      }
      await writeRunAudit(ctx, tx, {
        operation: 'store.set',
        changedData: { namespace: input.namespace, key: input.key, revision: result.record.revision },
        details: { action_id: 'store.set', action_version: 1, namespace: input.namespace, key: input.key },
      });
      return { revision: Number(result.record.revision), created: result.created };
    }),
  });

  registry.register({
    id: 'store.delete',
    version: 1,
    inputSchema: deleteInputSchema,
    outputSchema: deleteOutputSchema,
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Delete Stored Value',
      category: 'Data Store',
      description: 'Delete a persisted workflow key/value entry.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.manage);
      const deleted = await WorkflowDataStoreModel.delete(tx.trx, tx.tenantId, input.namespace, input.key);
      await writeRunAudit(ctx, tx, {
        operation: 'store.delete',
        changedData: { namespace: input.namespace, key: input.key, deleted },
        details: { action_id: 'store.delete', action_version: 1, namespace: input.namespace, key: input.key },
      });
      return { deleted };
    }),
  });

  registry.register({
    id: 'store.increment',
    version: 1,
    inputSchema: incrementInputSchema,
    outputSchema: incrementOutputSchema,
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Increment Stored Number',
      category: 'Data Store',
      description: 'Atomically increment a persisted workflow number.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.manage);
      let result: Awaited<ReturnType<typeof WorkflowDataStoreModel.increment>>;
      try {
        result = await WorkflowDataStoreModel.increment(tx.trx, tx.tenantId, {
          namespace: input.namespace,
          key: input.key,
          by: input.by,
          initial: input.initial,
          created_by_run_id: ctx.runId,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'WORKFLOW_DATA_STORE_INCREMENT_REQUIRES_NUMERIC_VALUE') {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'store.increment requires the existing value to be numeric',
            details: { namespace: input.namespace, key: input.key },
          });
        }
        throw error;
      }
      await writeRunAudit(ctx, tx, {
        operation: 'store.increment',
        changedData: { namespace: input.namespace, key: input.key, value: result.record.value, revision: result.record.revision },
        details: { action_id: 'store.increment', action_version: 1, namespace: input.namespace, key: input.key },
      });
      return { value: Number(result.record.value), revision: Number(result.record.revision) };
    }),
  });

  registry.register({
    id: 'store.list',
    version: 1,
    inputSchema: listInputSchema,
    outputSchema: listOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'List Stored Values',
      category: 'Data Store',
      description: 'List persisted workflow key/value entries in a namespace.',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.read);
      const result = await WorkflowDataStoreModel.list(tx.trx, tx.tenantId, input.namespace, {
        prefix: input.prefix,
        limit: input.limit,
        cursor: input.cursor,
      });
      return {
        items: result.items.map((item) => ({
          store_id: item.store_id,
          namespace: item.namespace,
          key: item.key,
          value: item.value,
          value_type: item.value_type,
          revision: Number(item.revision),
          expires_at: item.expires_at ?? null,
          created_at: new Date(item.created_at).toISOString(),
          updated_at: new Date(item.updated_at).toISOString(),
        })),
        next_cursor: result.next_cursor,
      };
    }),
  });

  registry.register({
    id: 'store.list_namespaces',
    version: 1,
    inputSchema: listNamespacesInputSchema,
    outputSchema: listNamespacesOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'List Store Namespaces',
      category: 'Data Store',
      description: 'List workflow data-store namespaces used by this tenant.',
    },
    handler: async (_input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, workflowPermission.read);
      const namespaces = await WorkflowDataStoreModel.listNamespaces(tx.trx, tx.tenantId);
      return { namespaces };
    }),
  });
}
