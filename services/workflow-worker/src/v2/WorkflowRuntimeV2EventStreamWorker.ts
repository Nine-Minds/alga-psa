import logger from '@shared/core/logger.js';
import { RedisStreamClient, WorkflowEventBaseSchema } from '@shared/workflow/streams/index.js';
import {
  WorkflowRuntimeV2,
  buildTriggerMappingExpressionContext,
  createSecretResolverFromProvider,
  expandDottedKeys,
  getSchemaRegistry,
  initializeWorkflowRuntimeV2,
  mappingUsesSecretRefs,
  resolveInputMapping,
} from '@shared/workflow/runtime';
import { createTenantSecretProvider } from '@shared/workflow/secrets';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import WorkflowRuntimeEventModelV2 from '@shared/workflow/persistence/workflowRuntimeEventModelV2';
import { getAdminConnection } from '@shared/db/admin.js';
import type { Knex } from 'knex';

type WorkerConfig = {
  consumerGroup: string;
  pollIntervalMs: number;
  batchSize: number;
};

export class WorkflowRuntimeV2EventStreamWorker {
  private readonly workerId: string;
  private readonly config: WorkerConfig;
  private readonly redis: RedisStreamClient;
  private readonly verbose: boolean;
  private running = false;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.verbose =
      process.env.WORKFLOW_WORKER_VERBOSE === 'true' ||
      process.env.WORKFLOW_WORKER_VERBOSE === '1' ||
      process.env.WORKFLOW_WORKER_VERBOSE === 'yes';
    this.config = {
      consumerGroup: process.env.WORKFLOW_RUNTIME_V2_EVENT_CONSUMER_GROUP || 'workflow-runtime-v2',
      pollIntervalMs: Number(process.env.WORKFLOW_RUNTIME_V2_EVENT_POLL_INTERVAL_MS || 5000),
      batchSize: Number(process.env.WORKFLOW_RUNTIME_V2_EVENT_BATCH_SIZE || 10),
    };

    this.redis = new RedisStreamClient({
      consumerGroup: this.config.consumerGroup,
      batchSize: this.config.batchSize,
      blockingTimeout: this.config.pollIntervalMs,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    initializeWorkflowRuntimeV2();

    await this.redis.initialize();
    this.redis.registerConsumer('global', async (event) => {
      await this.processEvent(event).catch((error) => {
        logger.error('[WorkflowRuntimeV2EventStreamWorker] Failed to ingest event', {
          workerId: this.workerId,
          error,
        });
        throw error;
      });
    });

    logger.info('[WorkflowRuntimeV2EventStreamWorker] Started', {
      workerId: this.workerId,
      consumerGroup: this.config.consumerGroup,
      stream: 'workflow:events:global',
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.redis.close().catch(() => undefined);
  }

  private async processEvent(raw: unknown): Promise<void> {
    const event = WorkflowEventBaseSchema.parse(raw);

    // Only ingest events that have the minimal data we need.
    if (!event.tenant || !event.event_type || !event.event_id) {
      logger.warn('[WorkflowRuntimeV2EventStreamWorker] Skipping event missing required fields', {
        workerId: this.workerId,
        eventId: event.event_id,
        eventType: event.event_type,
        tenant: event.tenant,
      });
      return;
    }

    if (this.verbose) {
      logger.info('[WorkflowRuntimeV2EventStreamWorker] Event received', {
        workerId: this.workerId,
        eventId: event.event_id,
        eventType: event.event_type,
        tenant: event.tenant,
        hasPayload: Boolean(event.payload),
      });
    } else {
      logger.debug('[WorkflowRuntimeV2EventStreamWorker] Event received', {
        workerId: this.workerId,
        eventId: event.event_id,
        eventType: event.event_type,
        tenant: event.tenant,
      });
    }

    const knex = await getAdminConnection();
    const processedAt = new Date().toISOString();

    // Idempotency: if we already ingested this event_id, do not start runs again.
    const existing = await WorkflowRuntimeEventModelV2.getById(knex, event.event_id).catch(() => null);
    if (existing) {
      logger.debug('[WorkflowRuntimeV2EventStreamWorker] Duplicate event ignored', {
        workerId: this.workerId,
        eventId: event.event_id,
        eventType: event.event_type,
        tenant: event.tenant,
      });
      return;
    }

    const payloadSchemaRef = await this.getPayloadSchemaRefForEvent(knex, {
      tenantId: event.tenant,
      eventType: event.event_type,
    });

    const payload = (event.payload && typeof event.payload === 'object' ? event.payload : {}) as Record<string, unknown>;

    logger.debug('[WorkflowRuntimeV2EventStreamWorker] Resolved payload schema ref', {
      workerId: this.workerId,
      eventId: event.event_id,
      eventType: event.event_type,
      tenant: event.tenant,
      payloadSchemaRef,
    });

    const eventRecord = await WorkflowRuntimeEventModelV2.create(knex, {
      event_id: event.event_id,
      tenant_id: event.tenant,
      event_name: event.event_type,
      correlation_key: event.event_id,
      payload,
      payload_schema_ref: payloadSchemaRef,
      processed_at: processedAt,
    });

    const runtime = new WorkflowRuntimeV2();
    const schemaRegistry = getSchemaRegistry();

    const workflows = await WorkflowDefinitionModelV2.list(knex);
    const matching = workflows.filter(
      (workflow) => workflow.status === 'published' && (workflow.trigger as any)?.eventName === event.event_type
    );

    const startedRuns: string[] = [];
    const skipStats = {
      noVersion: 0,
      missingWorkflowSchemaRef: 0,
      unknownWorkflowSchemaRef: 0,
      missingSourceSchemaRef: 0,
      unknownSourceSchemaRef: 0,
      sourcePayloadValidationFailed: 0,
      triggerMappingRequired: 0,
      triggerMappingFailed: 0,
      mappedPayloadValidationFailed: 0,
    };
    for (const workflow of matching) {
      const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflow.workflow_id);
      const latest = versions[0];
      if (!latest) {
        skipStats.noVersion += 1;
        continue;
      }

      const latestDefinition = latest.definition_json as any;
      const workflowPayloadSchemaRef: string | null =
        (typeof latestDefinition?.payloadSchemaRef === 'string' ? latestDefinition.payloadSchemaRef : null) ??
        (typeof (workflow as any)?.payload_schema_ref === 'string' ? String((workflow as any).payload_schema_ref) : null);

      if (!workflowPayloadSchemaRef) {
        skipStats.missingWorkflowSchemaRef += 1;
        continue;
      }
      if (!schemaRegistry.has(workflowPayloadSchemaRef)) {
        skipStats.unknownWorkflowSchemaRef += 1;
        continue;
      }

      const trigger = latestDefinition?.trigger ?? workflow.trigger ?? null;
      const overrideSourceSchemaRef = typeof trigger?.sourcePayloadSchemaRef === 'string' ? String(trigger.sourcePayloadSchemaRef) : null;
      const effectiveSourceSchemaRef = overrideSourceSchemaRef ?? payloadSchemaRef;

      if (!effectiveSourceSchemaRef) {
        skipStats.missingSourceSchemaRef += 1;
        continue;
      }
      if (!schemaRegistry.has(effectiveSourceSchemaRef)) {
        skipStats.unknownSourceSchemaRef += 1;
        continue;
      }

      const payloadMapping = trigger?.payloadMapping as any | undefined;
      const mappingProvided = payloadMapping && typeof payloadMapping === 'object' && Object.keys(payloadMapping).length > 0;
      const refsMatch = effectiveSourceSchemaRef === workflowPayloadSchemaRef;
      if (!mappingProvided && !refsMatch) {
        skipStats.triggerMappingRequired += 1;
        continue;
      }

      const sourceValidation = schemaRegistry.get(effectiveSourceSchemaRef).safeParse(payload);
      if (!sourceValidation.success) {
        skipStats.sourcePayloadValidationFailed += 1;
        continue;
      }

      let workflowPayload: Record<string, unknown> = payload;
      let mappingApplied = false;
      if (mappingProvided) {
        try {
          const provider = mappingUsesSecretRefs(payloadMapping)
            ? createTenantSecretProvider(knex, event.tenant)
            : null;
          const secretResolver = provider
            ? createSecretResolverFromProvider((name, workflowRunId) => provider.getValue(name, workflowRunId))
            : undefined;

          const resolved = await resolveInputMapping(payloadMapping, {
            expressionContext: buildTriggerMappingExpressionContext({
              name: event.event_type,
              correlationKey: event.event_id,
              payload,
              payloadSchemaRef: effectiveSourceSchemaRef
            }),
            secretResolver
          });

          workflowPayload = expandDottedKeys((resolved ?? {}) as Record<string, unknown>);
          mappingApplied = true;
        } catch {
          skipStats.triggerMappingFailed += 1;
          continue;
        }
      }

      const workflowValidation = schemaRegistry.get(workflowPayloadSchemaRef).safeParse(workflowPayload);
      if (!workflowValidation.success) {
        skipStats.mappedPayloadValidationFailed += 1;
        continue;
      }

      const runId = await runtime.startRun(knex, {
        workflowId: workflow.workflow_id,
        version: latest.version,
        payload: workflowPayload,
        tenantId: event.tenant,
        eventType: event.event_type,
        sourcePayloadSchemaRef: effectiveSourceSchemaRef,
        triggerMappingApplied: mappingApplied,
      });
      startedRuns.push(runId);
      if (this.verbose) {
        logger.info('[WorkflowRuntimeV2EventStreamWorker] Started run', {
          workerId: this.workerId,
          runId,
          workflowId: workflow.workflow_id,
          version: latest.version,
          eventId: event.event_id,
          eventType: event.event_type,
          tenant: event.tenant,
        });
      }
    }

    logger.debug('[WorkflowRuntimeV2EventStreamWorker] Event processed', {
      workerId: this.workerId,
      eventId: event.event_id,
      eventType: event.event_type,
      tenant: event.tenant,
      totalWorkflows: workflows.length,
      matchingWorkflows: matching.length,
      startedRuns: startedRuns.length,
      skipStats,
    });

    if (startedRuns.length === 1) {
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        matched_run_id: startedRuns[0],
        processed_at: processedAt,
      });
    }
  }

  private async getPayloadSchemaRefForEvent(
    knexOrTrx: Knex | Knex.Transaction,
    opts: { tenantId: string; eventType: string }
  ): Promise<string | null> {
    const tenantRow = await knexOrTrx('event_catalog')
      .where({ tenant: opts.tenantId, event_type: opts.eventType })
      .first(['payload_schema_ref'])
      .catch(() => null);

    const tenantRef = tenantRow && typeof (tenantRow as any).payload_schema_ref === 'string' ? String((tenantRow as any).payload_schema_ref) : null;
    if (tenantRef) return tenantRef;

    const systemRow = await knexOrTrx('system_event_catalog')
      .where({ event_type: opts.eventType })
      .first(['payload_schema_ref'])
      .catch(() => null);

    return systemRow && typeof (systemRow as any).payload_schema_ref === 'string' ? String((systemRow as any).payload_schema_ref) : null;
  }
}
