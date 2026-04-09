import logger from '@shared/core/logger.js';
import {
  RedisStreamClient,
  WorkflowEventBaseSchema,
} from '@alga-psa/workflow-streams';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@alga-psa/workflows/runtime';
import {
  WorkflowDefinitionModelV2,
  WorkflowDefinitionVersionModelV2,
  WorkflowRuntimeEventModelV2,
  WorkflowRunWaitModelV2,
} from '@alga-psa/workflows/persistence';
import { launchPublishedWorkflowRun } from '@alga-psa/workflows/lib/workflowRunLauncher';
import { signalWorkflowRuntimeV2Event } from '@alga-psa/workflows/lib/workflowRuntimeV2Temporal';
import { getAdminConnection } from '@shared/db/admin.js';
import type { Knex } from 'knex';

type WorkerConfig = {
  consumerGroup: string;
  pollIntervalMs: number;
  batchSize: number;
};

type CorrelationResolution = {
  key: string | null;
  source: 'explicit' | 'derived' | 'missing';
  detail: string;
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
    const correlation = this.resolveCorrelationKey(event, payload);

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
    if (correlation.key) {
      const candidateWaits = await WorkflowRunWaitModelV2.listEventWaitCandidates(
        knex,
        event.event_type,
        correlation.key,
        event.tenant,
        ['event']
      );
      for (const wait of candidateWaits) {
        try {
          await signalWorkflowRuntimeV2Event({
            runId: wait.run_id,
            eventId: event.event_id,
            eventName: event.event_type,
            correlationKey: correlation.key,
            payload,
            receivedAt: processedAt,
          });
          signaledRuns.add(wait.run_id);
        } catch (error) {
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
        }
      }
    } else {
      const correlationError = `Missing workflow correlation key (${correlation.detail})`;
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        error_message: correlationError,
        processed_at: processedAt,
      });
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

    const workflows = await WorkflowDefinitionModelV2.list(knex);
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

      // If we can’t validate or don’t have a canonical source schema ref, skip.
      if (!workflowPayloadSchemaRef) {
        skipStats.missingSchemaRef += 1;
        continue;
      }
      if (!schemaRegistry.has(workflowPayloadSchemaRef)) {
        skipStats.unknownSchemaRef += 1;
        continue;
      }

      // If the event catalog defines a source schema, require it to match for now (no trigger mapping in worker yet).
      if (payloadSchemaRef && payloadSchemaRef !== workflowPayloadSchemaRef) {
        skipStats.schemaMismatch += 1;
        continue;
      }

      const validation = schemaRegistry.get(workflowPayloadSchemaRef).safeParse(payload);
      if (!validation.success) {
        skipStats.payloadValidationFailed += 1;
        continue;
      }

      const launched = await launchPublishedWorkflowRun(knex, {
        workflowId: workflow.workflow_id,
        workflowVersion: latest.version,
        payload,
        tenantId: event.tenant,
        triggerType: 'event',
        triggerMetadata: {
          eventType: event.event_type,
          sourcePayloadSchemaRef: payloadSchemaRef ?? workflowPayloadSchemaRef,
          triggerMappingApplied: false
        },
        eventType: event.event_type,
        sourcePayloadSchemaRef: payloadSchemaRef ?? workflowPayloadSchemaRef,
        triggerMappingApplied: false,
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

    if (startedRuns.length === 1) {
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        matched_run_id: startedRuns[0],
        processed_at: processedAt,
      });
    }
  }

  private resolveCorrelationKey(
    event: {
      event_type: string;
      event_id: string;
      workflow_correlation_key?: string | null;
    },
    payload: Record<string, unknown>
  ): CorrelationResolution {
    const explicit = this.resolveExplicitCorrelation(event, payload);
    if (explicit) {
      return {
        key: explicit,
        source: 'explicit',
        detail: 'event.workflow_correlation_key|payload.workflowCorrelationKey|payload.correlationKey'
      };
    }

    const derived = this.resolveDerivedCorrelation(event.event_type, payload);
    if (derived) {
      return {
        key: derived.value,
        source: 'derived',
        detail: `path:${derived.path}`
      };
    }

    return {
      key: null,
      source: 'missing',
      detail: 'no explicit key and no configured derivation path produced a value'
    };
  }

  private resolveExplicitCorrelation(
    event: { workflow_correlation_key?: string | null },
    payload: Record<string, unknown>
  ): string | null {
    const fromEvent = typeof event.workflow_correlation_key === 'string'
      ? event.workflow_correlation_key.trim()
      : '';
    if (fromEvent) return fromEvent;

    const workflowCorrelationKey = payload.workflowCorrelationKey;
    if (typeof workflowCorrelationKey === 'string' && workflowCorrelationKey.trim()) {
      return workflowCorrelationKey.trim();
    }

    const correlationKey = payload.correlationKey;
    if (typeof correlationKey === 'string' && correlationKey.trim()) {
      return correlationKey.trim();
    }

    return null;
  }

  private resolveDerivedCorrelation(
    eventType: string,
    payload: Record<string, unknown>
  ): { value: string; path: string } | null {
    const configuredPaths = this.getConfiguredCorrelationPaths(eventType);
    for (const path of configuredPaths) {
      const value = readDottedValue(payload, path);
      if (value === null || value === undefined) continue;
      const asString = String(value).trim();
      if (!asString) continue;
      return { value: asString, path };
    }
    return null;
  }

  private getConfiguredCorrelationPaths(eventType: string): string[] {
    const raw = process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON;
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const eventPaths = parsed[eventType];
      const wildcardPaths = parsed['*'];
      return normalizePathConfig(eventPaths).concat(normalizePathConfig(wildcardPaths));
    } catch (error) {
      logger.warn('[WorkflowRuntimeV2EventStreamWorker] Failed to parse correlation derivation config', {
        workerId: this.workerId,
        eventType,
        error,
      });
      return [];
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

function normalizePathConfig(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readDottedValue(input: Record<string, unknown>, dottedPath: string): unknown {
  const path = dottedPath.split('.').filter(Boolean);
  let cursor: unknown = input;
  for (const segment of path) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
