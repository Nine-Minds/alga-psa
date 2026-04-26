import logger from '@shared/core/logger.js';
import {
  RedisStreamClient,
  WorkflowEventBaseSchema,
} from '@alga-psa/shared/workflow/streams/index.js';
import {
  createSecretResolverFromProvider,
  getSchemaRegistry,
  initializeWorkflowRuntimeV2,
  isWorkflowEventTrigger,
  resolveInputMapping,
} from '@alga-psa/workflows/runtime/core';
import {
  WorkflowDefinitionModelV2,
  WorkflowDefinitionVersionModelV2,
  WorkflowRuntimeEventModelV2,
  WorkflowRunModelV2,
  WorkflowRunWaitModelV2,
} from '@alga-psa/workflows/persistence';
import { createTenantSecretProvider } from '@alga-psa/workflows/secrets';
import { launchPublishedWorkflowRun } from '@alga-psa/workflows/lib/workflowRunLauncher';
import {
  signalWorkflowRuntimeV2Event,
  signalWorkflowRuntimeV2HumanTask,
} from '@alga-psa/workflows/lib/workflowRuntimeV2Temporal';
import { resolveWorkflowEventCorrelation } from '@alga-psa/workflows/lib/workflowEventCorrelation';
import { getAdminConnection } from '@shared/db/admin.js';
import type { Knex } from 'knex';

type WorkerConfig = {
  consumerGroup: string;
  pollIntervalMs: number;
  batchSize: number;
};

const expandDottedKeys = (input: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.includes('.')) {
      result[key] = value;
      continue;
    }
    const parts = key.split('.').filter(Boolean);
    if (parts.length === 0) continue;
    let cursor: Record<string, unknown> = result;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        cursor[part] = value;
        continue;
      }
      const existing = cursor[part];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        cursor = existing as Record<string, unknown>;
        continue;
      }
      const next: Record<string, unknown> = {};
      cursor[part] = next;
      cursor = next;
    }
  }
  return result;
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
    const correlation = resolveWorkflowEventCorrelation({
      eventName: event.event_type,
      payload,
      explicitCorrelationKey: event.workflow_correlation_key ?? null,
    });

    logger.debug('[WorkflowRuntimeV2EventStreamWorker] Resolved payload schema ref', {
      workerId: this.workerId,
      eventId: event.event_id,
      eventType: event.event_type,
      tenant: event.tenant,
      payloadSchemaRef,
      correlationKey: correlation.key,
      correlationSource: correlation.source,
      correlationDetail: correlation.detail,
    });

    const eventRecord = await WorkflowRuntimeEventModelV2.create(knex, {
      event_id: event.event_id,
      tenant_id: event.tenant,
      event_name: event.event_type,
      correlation_key: correlation.key,
      payload,
      payload_schema_ref: payloadSchemaRef,
      processed_at: processedAt,
    });

    const signaledRuns = new Set<string>();
    let deliveryError: string | null = null;
    const missingCorrelationWarning = correlation.key
      ? null
      : `Missing workflow correlation key (${correlation.detail})`;
    if (correlation.key) {
      const candidateWaits = await WorkflowRunWaitModelV2.listEventWaitCandidates(
        knex,
        event.event_type,
        correlation.key,
        event.tenant,
        ['event', 'human']
      );
      const waitsByRun = new Map<string, Awaited<ReturnType<typeof WorkflowRunModelV2.getById>>>();
      const getRun = async (candidateRunId: string) => {
        if (!waitsByRun.has(candidateRunId)) {
          waitsByRun.set(candidateRunId, await WorkflowRunModelV2.getById(knex, candidateRunId));
        }
        return waitsByRun.get(candidateRunId) ?? null;
      };
      for (const wait of candidateWaits) {
        const matchedRun = await getRun(wait.run_id);
        if (matchedRun?.engine !== 'temporal') {
          continue;
        }
        try {
          if (wait.wait_type === 'human') {
            const taskId = typeof (wait.payload as Record<string, unknown> | null | undefined)?.taskId === 'string'
              ? String((wait.payload as Record<string, unknown>).taskId)
              : '';
            if (!taskId) {
              continue;
            }
            await signalWorkflowRuntimeV2HumanTask({
              runId: wait.run_id,
              taskId,
              eventName: event.event_type,
              payload,
            });
          } else {
            await signalWorkflowRuntimeV2Event({
              runId: wait.run_id,
              eventId: event.event_id,
              eventName: event.event_type,
              correlationKey: correlation.key,
              payload,
              receivedAt: processedAt,
            });
          }
          signaledRuns.add(wait.run_id);
        } catch (error) {
          deliveryError = wait.wait_type === 'human'
            ? `Failed to signal Temporal human task for run ${wait.run_id}: ${error instanceof Error ? error.message : String(error)}`
            : `Failed to signal Temporal event wait for run ${wait.run_id}: ${error instanceof Error ? error.message : String(error)}`;
          logger.warn('[WorkflowRuntimeV2EventStreamWorker] Failed to signal candidate run', {
            workerId: this.workerId,
            runId: wait.run_id,
            waitId: wait.wait_id,
            eventId: event.event_id,
            eventType: event.event_type,
            tenant: event.tenant,
            correlationKey: correlation.key,
            error,
          });
          break;
        }
      }
    } else {
      logger.warn('[WorkflowRuntimeV2EventStreamWorker] Correlation key unresolved; skipping wait routing', {
          workerId: this.workerId,
          eventId: event.event_id,
          eventType: event.event_type,
          tenant: event.tenant,
          correlationSource: correlation.source,
          correlationDetail: correlation.detail,
        }
      );
    }

    const schemaRegistry = getSchemaRegistry();

    const workflows = await WorkflowDefinitionModelV2.list(knex, event.tenant);
    const matching = workflows.filter(
      (workflow) => workflow.status === 'published' && (workflow.trigger as any)?.eventName === event.event_type
    );

    const startedRuns: string[] = [];
    const skipStats = {
      noVersion: 0,
      missingSchemaRef: 0,
      unknownSchemaRef: 0,
      schemaMismatch: 0,
      payloadValidationFailed: 0,
    };
    for (const workflow of matching) {
      if (deliveryError) {
        break;
      }

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
        skipStats.missingSchemaRef += 1;
        continue;
      }
      if (!schemaRegistry.has(workflowPayloadSchemaRef)) {
        skipStats.unknownSchemaRef += 1;
        continue;
      }

      const trigger = (latestDefinition?.trigger ?? workflow.trigger ?? null) as any;
      const eventTrigger = isWorkflowEventTrigger(trigger) ? trigger : null;
      const overrideSourceSchemaRef = typeof eventTrigger?.sourcePayloadSchemaRef === 'string'
        ? eventTrigger.sourcePayloadSchemaRef
        : null;
      const effectiveSourceSchemaRef = overrideSourceSchemaRef ?? payloadSchemaRef;
      if (!effectiveSourceSchemaRef) {
        skipStats.missingSchemaRef += 1;
        continue;
      }

      const payloadMapping = eventTrigger?.payloadMapping as any;
      const mappingProvided = payloadMapping && typeof payloadMapping === 'object' && Object.keys(payloadMapping).length > 0;
      const refsMatch = effectiveSourceSchemaRef === workflowPayloadSchemaRef;
      if (!mappingProvided && !refsMatch) {
        skipStats.schemaMismatch += 1;
        continue;
      }

      let workflowPayload: Record<string, unknown> = payload;
      let mappingApplied = false;
      if (mappingProvided) {
        try {
          const provider = createTenantSecretProvider(knex, event.tenant);
          const secretResolver = createSecretResolverFromProvider((name, workflowRunId) => provider.getValue(name, workflowRunId));
          const resolved = await resolveInputMapping(payloadMapping, {
            expressionContext: {
              event: {
                name: event.event_type,
                correlationKey: correlation.key,
                payload,
                payloadSchemaRef: effectiveSourceSchemaRef
              }
            },
            secretResolver
          });
          workflowPayload = expandDottedKeys((resolved ?? {}) as Record<string, unknown>);
          mappingApplied = true;
        } catch {
          continue;
        }
      }

      const validation = schemaRegistry.get(workflowPayloadSchemaRef).safeParse(workflowPayload);
      if (!validation.success) {
        skipStats.payloadValidationFailed += 1;
        continue;
      }

      try {
        const launched = await launchPublishedWorkflowRun(knex, {
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version,
          payload: workflowPayload,
          tenantId: event.tenant,
          triggerType: 'event',
          triggerMetadata: {
            eventType: event.event_type,
            sourcePayloadSchemaRef: effectiveSourceSchemaRef,
            triggerMappingApplied: mappingApplied
          },
          eventType: event.event_type,
          sourcePayloadSchemaRef: effectiveSourceSchemaRef,
          triggerMappingApplied: mappingApplied,
        });
        startedRuns.push(launched.runId);
        if (this.verbose) {
          logger.info('[WorkflowRuntimeV2EventStreamWorker] Started run', {
            workerId: this.workerId,
            runId: launched.runId,
            workflowId: workflow.workflow_id,
            version: latest.version,
            eventId: event.event_id,
            eventType: event.event_type,
            tenant: event.tenant,
          });
        }
      } catch (error) {
        deliveryError = `Failed to launch Temporal workflow for workflow ${workflow.workflow_id}: ${error instanceof Error ? error.message : String(error)}`;
        logger.warn('[WorkflowRuntimeV2EventStreamWorker] Failed to launch workflow', {
          workerId: this.workerId,
          workflowId: workflow.workflow_id,
          version: latest.version,
          eventId: event.event_id,
          eventType: event.event_type,
          tenant: event.tenant,
          error,
        });
        break;
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
      signaledRuns: signaledRuns.size,
      skipStats,
    });

    const matchedRunId = Array.from(signaledRuns)[0] ?? startedRuns[0] ?? null;
    if (matchedRunId) {
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        matched_run_id: matchedRunId,
        processed_at: processedAt,
      });
    }

    if (deliveryError) {
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        error_message: deliveryError,
        processed_at: processedAt,
      });
    } else if (missingCorrelationWarning && startedRuns.length === 0 && signaledRuns.size === 0) {
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        error_message: missingCorrelationWarning,
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
