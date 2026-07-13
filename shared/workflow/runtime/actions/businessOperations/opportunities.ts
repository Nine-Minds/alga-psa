import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import {
  actionProvidedKey,
  isoDateTimeSchema,
  requirePermission,
  throwActionError,
  uuidSchema,
  withTenantTransaction,
  writeRunAudit,
} from './shared';
import { buildOpportunityCreatedPayload } from '../../../streams/domainEventBuilders/opportunityEventBuilders';

const withPicker = <T extends z.ZodTypeAny>(
  schema: T,
  description: string,
  resource: 'client' | 'contact' | 'user' | 'opportunity',
  dependencies?: string[],
): T => withWorkflowJsonSchemaMetadata(schema, description, {
  'x-workflow-picker-kind': resource,
  'x-workflow-picker-dependencies': dependencies,
  'x-workflow-picker-fixed-value-hint': `Search ${resource.replace('-', ' ')}s`,
  'x-workflow-picker-allow-dynamic-reference': true,
});

const opportunityTypeSchema = z.enum(['new_logo', 'expansion', 'renewal', 'project']);
const opportunityStatusSchema = z.enum(['open', 'won', 'lost']);
const opportunityStageSchema = z.enum(['identified', 'qualified', 'assessment', 'proposed', 'verbal', 'won', 'lost']);
const opportunityConfidenceSchema = z.enum(['low', 'medium', 'high', 'committed']);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const centsSchema = z.number().int().nonnegative();

const opportunitySummarySchema = z.object({
  opportunity_id: uuidSchema,
  opportunity_number: z.string(),
  client_id: uuidSchema,
  contact_id: uuidSchema.nullable(),
  title: z.string(),
  opportunity_type: opportunityTypeSchema,
  owner_id: uuidSchema,
  status: opportunityStatusSchema,
  stage: opportunityStageSchema,
  confidence: opportunityConfidenceSchema,
  mrr_cents: z.number().int(),
  nrr_cents: z.number().int(),
  hardware_cents: z.number().int(),
  currency_code: z.string(),
  expected_close_date: z.string().nullable(),
  next_action: z.string().nullable(),
  next_action_due: z.string().nullable(),
});

function summary(row: Record<string, any>) {
  const dateValue = (value: unknown): string | null => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };
  return opportunitySummarySchema.parse({
    ...row,
    contact_id: row.contact_id ?? null,
    mrr_cents: Number(row.mrr_cents ?? 0),
    nrr_cents: Number(row.nrr_cents ?? 0),
    hardware_cents: Number(row.hardware_cents ?? 0),
    expected_close_date: dateValue(row.expected_close_date)?.slice(0, 10) ?? null,
    next_action: row.next_action ?? null,
    next_action_due: dateValue(row.next_action_due),
  });
}

async function nextOpportunityNumber(trx: any, tenant: string): Promise<string> {
  const result = await trx.raw(
    'SELECT generate_next_number(:tenant::uuid, :type::text) as number',
    { tenant, type: 'OPPORTUNITY' },
  );
  const number = result.rows?.[0]?.number;
  if (!number) throw new Error('Failed to generate opportunity number');
  return number;
}

export function registerOpportunityActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'opportunities.create',
    version: 1,
    inputSchema: z.object({
      client_id: withPicker(uuidSchema, 'Client id', 'client'),
      contact_id: withPicker(uuidSchema.nullable().optional(), 'Optional contact id', 'contact', ['client_id']),
      title: z.string().trim().min(1).max(255),
      opportunity_type: opportunityTypeSchema,
      owner_id: withPicker(uuidSchema.optional(), 'Optional owner user id', 'user'),
      confidence: opportunityConfidenceSchema.default('medium'),
      mrr_cents: centsSchema.default(0),
      nrr_cents: centsSchema.default(0),
      hardware_cents: centsSchema.default(0),
      currency_code: z.string().trim().length(3).default('USD'),
      expected_close_date: dateOnlySchema.nullable().optional(),
      next_action: z.string().trim().min(1),
      next_action_due: isoDateTimeSchema,
      idempotency_key: z.string().optional(),
    }).strict(),
    outputSchema: z.object({ opportunity: opportunitySummarySchema }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Create Opportunity',
      category: 'Business Operations',
      description: 'Create an open opportunity with its first next action',
    },
    handler: async (input, ctx) => {
      const created = await withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'opportunities', action: 'create' });
        const db = tenantDb(tx.trx, tx.tenantId);
        const client = await db.table('clients')
          .where({ client_id: input.client_id })
          .first('client_id', 'account_manager_id');
        if (!client) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Client not found' });
        if (input.contact_id) {
          const contact = await db.table('contacts')
            .where({ contact_name_id: input.contact_id, client_id: input.client_id })
            .first('contact_name_id');
          if (!contact) throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Contact not found for client',
          });
        }
        const now = ctx.nowIso();
        const [row] = await db.table('opportunities').insert({
          tenant: tx.tenantId,
          opportunity_number: await nextOpportunityNumber(tx.trx, tx.tenantId),
          client_id: input.client_id,
          contact_id: input.contact_id ?? null,
          title: input.title,
          opportunity_type: input.opportunity_type,
          owner_id: input.owner_id ?? client.account_manager_id ?? tx.actorUserId,
          status: 'open',
          stage: 'identified',
          confidence: input.confidence ?? 'medium',
          mrr_cents: input.mrr_cents ?? 0,
          nrr_cents: input.nrr_cents ?? 0,
          hardware_cents: input.hardware_cents ?? 0,
          currency_code: (input.currency_code ?? 'USD').toUpperCase(),
          values_locked_by_quote: false,
          expected_close_date: input.expected_close_date ?? null,
          next_action: input.next_action,
          next_action_due: input.next_action_due,
          last_activity_at: now,
          created_by: tx.actorUserId,
          created_at: now,
          updated_at: now,
        }).returning('*');
        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:opportunities.create',
          changedData: { opportunity_id: row.opportunity_id },
          details: { action_id: 'opportunities.create', action_version: 1 },
        });
        return { row, tenantId: tx.tenantId, actorUserId: tx.actorUserId, createdAt: now };
      });
      try {
        await publishWorkflowEvent({
          eventType: 'OPPORTUNITY_CREATED',
          payload: buildOpportunityCreatedPayload({
            opportunityId: created.row.opportunity_id,
            clientId: created.row.client_id,
            ownerId: created.row.owner_id,
            stage: created.row.stage,
            createdAt: created.createdAt,
          }),
          ctx: {
            tenantId: created.tenantId,
            occurredAt: created.createdAt,
            actor: { actorType: 'USER', actorUserId: created.actorUserId },
          },
          idempotencyKey: `opportunity_created:${created.row.opportunity_id}`,
        });
      } catch (error) {
        ctx.logger?.warn('workflow_action:opportunities.create event publication failed', { error });
      }
      return { opportunity: summary(created.row) };
    },
  });

  registry.register({
    id: 'opportunities.find',
    version: 1,
    inputSchema: z.object({
      opportunity_id: withPicker(uuidSchema.optional(), 'Opportunity id', 'opportunity'),
      opportunity_number: z.string().trim().min(1).optional(),
      client_id: withPicker(uuidSchema.optional(), 'Client id filter', 'client'),
      owner_id: withPicker(uuidSchema.optional(), 'Owner user id filter', 'user'),
      status: opportunityStatusSchema.optional(),
      stage: opportunityStageSchema.optional(),
      opportunity_type: opportunityTypeSchema.optional(),
      limit: z.number().int().positive().max(100).default(25),
      on_empty: z.enum(['return_empty', 'error']).default('return_empty'),
    }).refine((input) => Boolean(
      input.opportunity_id || input.opportunity_number || input.client_id || input.owner_id
      || input.status || input.stage || input.opportunity_type
    ), { message: 'At least one opportunity filter is required' }),
    outputSchema: z.object({
      opportunities: z.array(opportunitySummarySchema),
      first_opportunity: opportunitySummarySchema.nullable(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Find Opportunities',
      category: 'Business Operations',
      description: 'Find opportunities by id, number, account, owner, status, stage, or type',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'opportunities', action: 'read' });
      const query = tenantDb(tx.trx, tx.tenantId).table('opportunities');
      if (input.opportunity_id) query.where({ opportunity_id: input.opportunity_id });
      if (input.opportunity_number) query.whereRaw('LOWER(opportunity_number) = LOWER(?)', [input.opportunity_number]);
      if (input.client_id) query.where({ client_id: input.client_id });
      if (input.owner_id) query.where({ owner_id: input.owner_id });
      if (input.status) query.where({ status: input.status });
      if (input.stage) query.where({ stage: input.stage });
      if (input.opportunity_type) query.where({ opportunity_type: input.opportunity_type });
      const rows = await query.orderBy('created_at', 'desc').limit(input.limit ?? 25);
      if (!rows.length && input.on_empty === 'error') {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'No opportunities found' });
      }
      const opportunities = rows.map(summary);
      return { opportunities, first_opportunity: opportunities[0] ?? null };
    }),
  });

  const updatePatchSchema = z.object({
    title: z.string().trim().min(1).max(255).optional(),
    contact_id: withPicker(uuidSchema.nullable().optional(), 'Contact id', 'contact'),
    owner_id: withPicker(uuidSchema.optional(), 'Owner user id', 'user'),
    confidence: opportunityConfidenceSchema.optional(),
    mrr_cents: centsSchema.optional(),
    nrr_cents: centsSchema.optional(),
    hardware_cents: centsSchema.optional(),
    currency_code: z.string().trim().length(3).optional(),
    expected_close_date: dateOnlySchema.nullable().optional(),
  }).strict().refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'patch must include at least one field',
  });

  registry.register({
    id: 'opportunities.update',
    version: 1,
    inputSchema: z.object({
      opportunity_id: withPicker(uuidSchema, 'Opportunity id', 'opportunity'),
      patch: updatePatchSchema,
    }).strict(),
    outputSchema: z.object({ opportunity: opportunitySummarySchema }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Update Opportunity',
      category: 'Business Operations',
      description: 'Update editable opportunity fields without changing its derived stage or status',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'opportunities', action: 'update' });
      const db = tenantDb(tx.trx, tx.tenantId);
      const current = await db.table('opportunities')
        .where({ opportunity_id: input.opportunity_id })
        .forUpdate()
        .first();
      if (!current) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Opportunity not found' });
      if (current.values_locked_by_quote && (
        input.patch.mrr_cents !== undefined || input.patch.nrr_cents !== undefined
        || input.patch.hardware_cents !== undefined || input.patch.currency_code !== undefined
      )) {
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'CONFLICT',
          message: 'Opportunity values are locked by an accepted quote',
        });
      }
      const [updated] = await db.table('opportunities')
        .where({ opportunity_id: input.opportunity_id })
        .update({
          ...input.patch,
          ...(input.patch.currency_code ? { currency_code: input.patch.currency_code.toUpperCase() } : {}),
          updated_at: ctx.nowIso(),
        })
        .returning('*');
      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:opportunities.update',
        changedData: { opportunity_id: input.opportunity_id, patch: input.patch },
        details: { action_id: 'opportunities.update', action_version: 1 },
      });
      return { opportunity: summary(updated) };
    }),
  });

  registry.register({
    id: 'opportunities.set_next_action',
    version: 1,
    inputSchema: z.object({
      opportunity_id: withPicker(uuidSchema, 'Opportunity id', 'opportunity'),
      next_action: withWorkflowJsonSchemaMetadata(
        z.string().trim().min(1).max(4000),
        'The next concrete action',
        { 'x-workflow-editor': { kind: 'text', inline: { mode: 'textarea' } } },
      ),
      next_action_due: isoDateTimeSchema,
    }).strict(),
    outputSchema: z.object({ opportunity: opportunitySummarySchema }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Set Opportunity Next Action',
      category: 'Business Operations',
      description: 'Replace the next action and due date on an open opportunity',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'opportunities', action: 'update' });
      const db = tenantDb(tx.trx, tx.tenantId);
      const current = await db.table('opportunities')
        .where({ opportunity_id: input.opportunity_id })
        .forUpdate()
        .first('opportunity_id', 'status');
      if (!current) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Opportunity not found' });
      if (current.status !== 'open') throwActionError(ctx, {
        category: 'ActionError',
        code: 'CONFLICT',
        message: 'Only open opportunities have next actions',
      });
      const [updated] = await db.table('opportunities')
        .where({ opportunity_id: input.opportunity_id })
        .update({
          next_action: input.next_action,
          next_action_due: input.next_action_due,
          overdue_notified_at: null,
          updated_at: ctx.nowIso(),
        })
        .returning('*');
      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:opportunities.set_next_action',
        changedData: {
          opportunity_id: input.opportunity_id,
          next_action: input.next_action,
          next_action_due: input.next_action_due,
        },
        details: { action_id: 'opportunities.set_next_action', action_version: 1 },
      });
      return { opportunity: summary(updated) };
    }),
  });
}
