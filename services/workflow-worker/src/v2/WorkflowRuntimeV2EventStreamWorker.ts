import { evaluateWorkflowSelfTrigger } from '@alga-psa/workflows/lib/workflowSelfTriggerGuard';
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
  listPublishedWorkflowDefinitions,
  WorkflowEventLaunchSkipModelV2,
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
import {
  WORKFLOW_LAUNCH_SKIP_INTENTIONAL,
  type WorkflowLaunchSkipReason,
} from '@alga-psa/workflows/lib/workflowLaunchSkipReasons';
import { getWorkflowWorkerMetrics, type WorkflowEventMetrics } from '../metrics.js';
import { resolveWorkflowEventCorrelation } from '@alga-psa/workflows/lib/workflowEventCorrelation';
import { isTenantSuspended, tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@shared/db/admin.js';
import type { Knex } from 'knex';

type WorkerConfig = {
  consumerGroup: string;
  pollIntervalMs: number;
  batchSize: number;
};

/**
 * One decision not to launch one workflow for one event. Every skip is
 * persisted to workflow_event_launch_skips and counted in the metrics.
 * `message` is stored on the skip record, which is already scoped to one
 * workflow, so it is human-readable and carries no workflow id/key.
 * `errorMessageSection` only controls how the skip contributes to the event
 * row's legacy `error_message` (unchanged behaviour), which keeps the
 * workflow-labelled `legacyMessage`.
 */
type LaunchSkip = {
  workflowId: string;
  workflowVersion: number | null;
  reason: WorkflowLaunchSkipReason;
  message: string;
  /** Workflow-labelled text for the event row's joined error_message. */
  legacyMessage: string;
  details: Record<string, unknown> | null;
  errorMessageSection: 'validation' | 'diagnostic' | null;
};

/**
 * The shared mapping resolver throws plain `{ category, message, path }`
 * objects (not Errors); pull the real text out instead of "[object Object]".
 */
const describeMappingError = (error: unknown): { message: string; path: string | null } => {
  if (error instanceof Error) {
    const path = (error as { path?: unknown }).path;
    return { message: error.message, path: typeof path === 'string' && path ? path : null };
  }
  if (error && typeof error === 'object') {
    const { message, path } = error as { message?: unknown; path?: unknown };
    const text = typeof message === 'string' && message ? message : null;
    const pathText = typeof path === 'string' && path ? path : null;
    if (text || pathText) {
      return { message: text ?? `Invalid mapping value at ${pathText}`, path: pathText };
    }
  }
  return { message: String(error), path: null };
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
  private readonly metrics: WorkflowEventMetrics;
  private running = false;

  constructor(workerId: string, metrics: WorkflowEventMetrics = getWorkflowWorkerMetrics()) {
    this.workerId = workerId;
    this.metrics = metrics;
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

    // Suspended tenants (cancelled, pending deletion) get their events acked
    // without starting any workflow runs. isTenantSuspended fails open, so a
    // flag-read error can never stall the stream for active tenants.
    if (await isTenantSuspended(knex, event.tenant)) {
      logger.debug('[WorkflowRuntimeV2EventStreamWorker] Skipping event for suspended tenant', {
        workerId: this.workerId,
        eventId: event.event_id,
        eventType: event.event_type,
        tenant: event.tenant,
        event: 'workflow_event_tenant_suspended',
      });
      return;
    }

    // Idempotency: if we already ingested this event_id, do not start runs again.
    const existing = await WorkflowRuntimeEventModelV2.getById(knex, event.event_id, event.tenant).catch(() => null);
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
      tenant: event.tenant,
      event_name: event.event_type,
      correlation_key: correlation.key,
      payload,
      payload_schema_ref: payloadSchemaRef,
      processed_at: processedAt,
    });

    const signaledRuns = new Set<string>();
    // Each waiting run and each matching workflow is delivered independently:
    // one failure is recorded and must not stop delivery to the rest.
    const deliveryErrors: string[] = [];
    const correlationKeys = correlation.keys.length > 0
      ? correlation.keys
      : (correlation.key ? [correlation.key] : []);
    const missingCorrelationWarning = correlationKeys.length > 0
      ? null
      : `Missing workflow correlation key (${correlation.detail})`;
    if (correlationKeys.length > 0) {
      // A wait may be keyed on any derivable identifier (e.g. invoiceId OR
      // clientId), so candidates are collected for every derived key.
      const waitKeyByWaitId = new Map<string, string>();
      const candidateWaits: Awaited<ReturnType<typeof WorkflowRunWaitModelV2.listEventWaitCandidates>> = [];
      for (const correlationKey of correlationKeys) {
        const keyCandidates = await WorkflowRunWaitModelV2.listEventWaitCandidates(
          knex,
          event.event_type,
          correlationKey,
          event.tenant,
          ['event', 'human']
        );
        for (const candidate of keyCandidates) {
          if (waitKeyByWaitId.has(candidate.wait_id)) continue;
          waitKeyByWaitId.set(candidate.wait_id, correlationKey);
          candidateWaits.push(candidate);
        }
      }
      const waitsByRun = new Map<string, Awaited<ReturnType<typeof WorkflowRunModelV2.getById>>>();
      const getRun = async (candidateRunId: string) => {
        if (!waitsByRun.has(candidateRunId)) {
          waitsByRun.set(candidateRunId, await WorkflowRunModelV2.getById(knex, candidateRunId, event.tenant));
        }
        return waitsByRun.get(candidateRunId) ?? null;
      };
      for (const wait of candidateWaits) {
        const matchedRun = await getRun(wait.run_id);
        if (!matchedRun) {
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
              correlationKey: waitKeyByWaitId.get(wait.wait_id) ?? correlation.key,
              payload,
              receivedAt: processedAt,
            });
          }
          signaledRuns.add(wait.run_id);
        } catch (error) {
          deliveryErrors.push(wait.wait_type === 'human'
            ? `Failed to signal Temporal human task for run ${wait.run_id}: ${error instanceof Error ? error.message : String(error)}`
            : `Failed to signal Temporal event wait for run ${wait.run_id}: ${error instanceof Error ? error.message : String(error)}`);
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

    const publishedDefinitions = await listPublishedWorkflowDefinitions(knex, event.tenant);
    const matching = publishedDefinitions.filter(({ workflow, definition }) =>
      ((definition?.trigger as any) ?? workflow.trigger)?.eventName === event.event_type
    );

    const startedRuns: string[] = [];
    // Every reason a matching workflow was NOT launched, collected per workflow
    // and persisted after the loop (including when other workflows launched).
    const skips: LaunchSkip[] = [];
    const recordSkip = (
      skip: Omit<LaunchSkip, 'errorMessageSection' | 'legacyMessage'> & {
        errorMessageSection?: LaunchSkip['errorMessageSection'];
        legacyMessage?: string;
      },
      skipLabel?: string,
    ) => {
      const legacyMessage = skip.legacyMessage
        ?? (skipLabel ? `Skipped ${skipLabel}: ${skip.message.charAt(0).toLowerCase()}${skip.message.slice(1)}` : skip.message);
      skips.push({ errorMessageSection: null, ...skip, legacyMessage });
    };
    // Workflow ids that caused this event (stamped by an action such as tickets.create when a
    // workflow run published it). A workflow already in the chain never relaunches itself, which
    // bounds A -> A and A -> B -> A loops. Non-cyclic chains (A -> B) still run.
    const eventLineage = Array.isArray(payload.workflowLineage)
      ? (payload.workflowLineage as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    for (const { workflow, latestVersion: latest } of matching) {
      // Paused is a deliberate state, not a delivery failure; the launcher
      // would refuse the run anyway.
      if (workflow.is_paused) {
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: 'paused',
          message: 'Workflow is paused',
          details: null,
        });
        continue;
      }

      const skipLabel = `workflow ${workflow.key ?? workflow.workflow_id} (${workflow.workflow_id})`;

      if (eventLineage.includes(workflow.workflow_id)) {
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: 'lineage_loop_guard',
          message: `Workflow is already in the event lineage (trigger loop guard)`,
          details: { guardReason: 'lineage_loop_guard', workflowLineage: eventLineage },
          errorMessageSection: 'diagnostic',
        }, skipLabel);
        logger.warn('[WorkflowRuntimeV2EventStreamWorker] Workflow is already in the event lineage; skipping launch to avoid a trigger loop', {
          workerId: this.workerId,
          eventId: event.event_id,
          eventType: event.event_type,
          tenant: event.tenant,
          workflowId: workflow.workflow_id,
          workflowLineage: eventLineage,
        });
        continue;
      }

      const latestDefinition = latest.definition_json as any;
      const workflowPayloadSchemaRef: string | null =
        (typeof latestDefinition?.payloadSchemaRef === 'string' ? latestDefinition.payloadSchemaRef : null) ??
        (typeof (workflow as any)?.payload_schema_ref === 'string' ? String((workflow as any).payload_schema_ref) : null);

      if (!workflowPayloadSchemaRef) {
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: 'missing_schema_ref',
          message: `No payload schema reference is set on the workflow`,
          details: null,
          errorMessageSection: 'diagnostic',
        }, skipLabel);
        continue;
      }
      if (!schemaRegistry.has(workflowPayloadSchemaRef)) {
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: 'unknown_schema_ref',
          message: `Payload schema ${workflowPayloadSchemaRef} is not registered`,
          details: { workflowPayloadSchemaRef },
          errorMessageSection: 'diagnostic',
        }, skipLabel);
        continue;
      }

      const trigger = (latestDefinition?.trigger ?? workflow.trigger ?? null) as any;
      const eventTrigger = isWorkflowEventTrigger(trigger) ? trigger : null;
      const overrideSourceSchemaRef = typeof eventTrigger?.sourcePayloadSchemaRef === 'string'
        ? eventTrigger.sourcePayloadSchemaRef
        : null;
      const effectiveSourceSchemaRef = overrideSourceSchemaRef ?? payloadSchemaRef;
      if (!effectiveSourceSchemaRef) {
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: 'missing_source_schema',
          message: `No source payload schema is known for event ${event.event_type}`,
          details: { workflowPayloadSchemaRef },
          errorMessageSection: 'diagnostic',
        }, skipLabel);
        continue;
      }

      const payloadMapping = eventTrigger?.payloadMapping as any;
      const mappingProvided = payloadMapping && typeof payloadMapping === 'object' && Object.keys(payloadMapping).length > 0;
      const refsMatch = effectiveSourceSchemaRef === workflowPayloadSchemaRef;
      if (!mappingProvided && !refsMatch) {
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: 'schema_mismatch',
          message: `Event payload schema ${effectiveSourceSchemaRef} differs from workflow schema ${workflowPayloadSchemaRef} and no payload mapping is configured`,
          details: { workflowPayloadSchemaRef, sourcePayloadSchemaRef: effectiveSourceSchemaRef },
          errorMessageSection: 'diagnostic',
        }, skipLabel);
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
        } catch (mappingError) {
          const { message: mappingErrorMessage, path: mappingErrorPath } = describeMappingError(mappingError);
          recordSkip({
            workflowId: workflow.workflow_id,
            workflowVersion: latest.version ?? null,
            reason: 'payload_mapping_failed',
            message: mappingErrorPath
              ? `Trigger payload mapping failed at ${mappingErrorPath}: ${mappingErrorMessage}`
              : `Trigger payload mapping failed: ${mappingErrorMessage}`,
            details: {
              workflowPayloadSchemaRef,
              sourcePayloadSchemaRef: effectiveSourceSchemaRef,
              error: mappingErrorMessage,
              ...(mappingErrorPath ? { path: mappingErrorPath } : {}),
            },
            errorMessageSection: 'diagnostic',
          }, skipLabel);
          continue;
        }
      }

      const validation = schemaRegistry.get(workflowPayloadSchemaRef).safeParse(workflowPayload);
      if (!validation.success) {
        const workflowKey = workflow.key ?? workflow.workflow_id;
        const issues = validation.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        }));
        const validationMessage = `Payload validation failed for workflow ${workflowKey} (${workflow.workflow_id}) using ${workflowPayloadSchemaRef}: ${JSON.stringify(issues)}`;
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: 'payload_validation_failed',
          message: `Payload validation failed using ${workflowPayloadSchemaRef}: ${JSON.stringify(issues)}`,
          legacyMessage: validationMessage,
          details: {
            issues,
            workflowPayloadSchemaRef,
            sourcePayloadSchemaRef: effectiveSourceSchemaRef,
          },
          errorMessageSection: 'validation',
        });
        logger.warn('[WorkflowRuntimeV2EventStreamWorker] Payload validation failed; skipping workflow launch', {
          workerId: this.workerId,
          eventId: event.event_id,
          eventType: event.event_type,
          tenant: event.tenant,
          workflowId: workflow.workflow_id,
          workflowKey,
          payloadSchemaRef: workflowPayloadSchemaRef,
          sourcePayloadSchemaRef: effectiveSourceSchemaRef,
          issues,
        });
        // Skips are persisted after the loop. Only the event row's legacy
        // error_message is conditional on nothing having launched or signaled:
        // an event that matched another workflow must not read as an error.
        continue;
      }

      const selfTrigger = await evaluateWorkflowSelfTrigger(knex, {
        tenant: event.tenant,
        originExecutionId: event.execution_id,
        candidateWorkflowId: workflow.workflow_id,
      });
      if (!selfTrigger.allow) {
        logger.warn('[WorkflowRuntimeV2EventStreamWorker] Skipping workflow launch: event was caused by this workflow chain', {
          workerId: this.workerId,
          eventId: event.event_id,
          eventType: event.event_type,
          tenant: event.tenant,
          workflowId: workflow.workflow_id,
          originExecutionId: event.execution_id,
          reason: selfTrigger.reason,
          causationDepth: selfTrigger.causationDepth,
        });
        const selfTriggerReason: WorkflowLaunchSkipReason =
          selfTrigger.reason === 'causation_depth_exceeded' ? 'causation_depth_exceeded' : 'self_trigger_guard';
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: selfTriggerReason,
          message: selfTriggerReason === 'causation_depth_exceeded'
            ? 'Workflow causation depth limit exceeded'
            : 'Event was caused by this workflow chain (self-trigger guard)',
          details: {
            guardReason: selfTrigger.reason,
            causationDepth: selfTrigger.causationDepth,
            originExecutionId: event.execution_id ?? null,
          },
        });
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
            triggerMappingApplied: mappingApplied,
            ...(selfTrigger.causationDepth > 0 ? { causationDepth: selfTrigger.causationDepth } : {}),
            ...(eventLineage.length > 0 ? { workflowLineage: eventLineage } : {})
          },
          eventType: event.event_type,
          sourcePayloadSchemaRef: effectiveSourceSchemaRef,
          triggerMappingApplied: mappingApplied,
        });
        startedRuns.push(launched.runId);
        this.metrics.recordLaunch({
          tenant: event.tenant,
          workflowId: workflow.workflow_id,
          eventName: event.event_type,
        });
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
        const launchErrorMessage = `Failed to launch Temporal workflow for workflow ${workflow.workflow_id}: ${error instanceof Error ? error.message : String(error)}`;
        deliveryErrors.push(launchErrorMessage);
        recordSkip({
          workflowId: workflow.workflow_id,
          workflowVersion: latest.version ?? null,
          reason: 'launch_failed',
          message: `Failed to launch Temporal workflow: ${error instanceof Error ? error.message : String(error)}`,
          details: { error: error instanceof Error ? error.message : String(error) },
        });
        logger.warn('[WorkflowRuntimeV2EventStreamWorker] Failed to launch workflow', {
          workerId: this.workerId,
          workflowId: workflow.workflow_id,
          version: latest.version,
          eventId: event.event_id,
          eventType: event.event_type,
          tenant: event.tenant,
          error,
        });
      }
    }

    const skipCountsByReason: Record<string, number> = {};
    for (const skip of skips) {
      skipCountsByReason[skip.reason] = (skipCountsByReason[skip.reason] ?? 0) + 1;
    }

    // Always persist: this closes the partial-skip gap (event launched workflow
    // A but skipped B). Failures propagate (fail-fast) to the consumer's
    // logger.error + rethrow; they are not swallowed.
    await WorkflowEventLaunchSkipModelV2.insertMany(
      knex,
      event.tenant,
      skips.map((skip) => ({
        tenant: event.tenant,
        event_id: event.event_id,
        workflow_id: skip.workflowId,
        workflow_version: skip.workflowVersion,
        event_name: event.event_type,
        reason: skip.reason,
        intentional: WORKFLOW_LAUNCH_SKIP_INTENTIONAL[skip.reason],
        message: skip.message,
        details: skip.details,
      }))
    );
    for (const skip of skips) {
      this.metrics.recordLaunchSkip({
        tenant: event.tenant,
        workflowId: skip.workflowId,
        eventName: event.event_type,
        reason: skip.reason,
        intentional: WORKFLOW_LAUNCH_SKIP_INTENTIONAL[skip.reason],
      });
    }

    logger.debug('[WorkflowRuntimeV2EventStreamWorker] Event processed', {
      workerId: this.workerId,
      eventId: event.event_id,
      eventType: event.event_type,
      tenant: event.tenant,
      totalWorkflows: publishedDefinitions.length,
      matchingWorkflows: matching.length,
      startedRuns: startedRuns.length,
      signaledRuns: signaledRuns.size,
      skipCountsByReason,
      // Legacy-shaped view kept for log consumers (derived from the collector).
      skipStats: {
        paused: skipCountsByReason.paused ?? 0,
        workflowCycle: skipCountsByReason.lineage_loop_guard ?? 0,
        missingSchemaRef: (skipCountsByReason.missing_schema_ref ?? 0) + (skipCountsByReason.missing_source_schema ?? 0),
        unknownSchemaRef: skipCountsByReason.unknown_schema_ref ?? 0,
        schemaMismatch: skipCountsByReason.schema_mismatch ?? 0,
        payloadValidationFailed: skipCountsByReason.payload_validation_failed ?? 0,
      },
    });

    // Legacy event-row error_message: validation messages first, then the other
    // diagnostics, each in collection order (paused / self-trigger / launch
    // failures never contributed here).
    const validationMessages = skips.filter((s) => s.errorMessageSection === 'validation').map((s) => s.legacyMessage);
    const diagnosticMessages = skips.filter((s) => s.errorMessageSection === 'diagnostic').map((s) => s.legacyMessage);

    const matchedRunId = Array.from(signaledRuns)[0] ?? startedRuns[0] ?? null;
    if (matchedRunId) {
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        matched_run_id: matchedRunId,
        processed_at: processedAt,
      });
    }

    if (deliveryErrors.length > 0) {
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        error_message: deliveryErrors.join('\n'),
        processed_at: processedAt,
      });
    } else if (
      (validationMessages.length > 0 || diagnosticMessages.length > 0) &&
      startedRuns.length === 0 &&
      signaledRuns.size === 0
    ) {
      await WorkflowRuntimeEventModelV2.update(knex, eventRecord.event_id, {
        error_message: [...validationMessages, ...diagnosticMessages].join('\n'),
        processed_at: processedAt,
      }, event.tenant);
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
    const db = tenantDb(knexOrTrx, opts.tenantId);
    const tenantRow = await db.table('event_catalog')
      .where({ event_type: opts.eventType })
      .first(['payload_schema_ref'])
      .catch(() => null);

    const tenantRef = tenantRow && typeof (tenantRow as any).payload_schema_ref === 'string' ? String((tenantRow as any).payload_schema_ref) : null;
    if (tenantRef) return tenantRef;

    const systemRow = await db.table('system_event_catalog')
      .where({ event_type: opts.eventType })
      .first(['payload_schema_ref'])
      .catch(() => null);

    return systemRow && typeof (systemRow as any).payload_schema_ref === 'string' ? String((systemRow as any).payload_schema_ref) : null;
  }
}
