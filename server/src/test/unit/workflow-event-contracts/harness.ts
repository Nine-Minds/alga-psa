import {
  convertToWorkflowEvent,
  getWorkflowEventSchemaRef,
  type WorkflowCatalogEventType,
} from '@alga-psa/event-schemas';
import {
  buildWorkflowPayload,
  type WorkflowEventPublishContext,
} from '@alga-psa/event-bus/workflow/workflowEventPublishHelpers';
import { initializeWorkflowRuntimeV2 } from '@alga-psa/shared/workflow/runtime/init';
import { getSchemaRegistry } from '@alga-psa/shared/workflow/runtime/registries/schemaRegistry';

/**
 * Emitter contract harness.
 *
 * For one emitter case it reproduces exactly what the workflow worker reads from
 * the stream, then validates it with the schema the worker uses:
 *
 *   1. `buildWorkflowPayload(case.build(), ctx)`   (what publishWorkflowEvent runs)
 *   2. `convertToWorkflowEvent({...}).payload`      (what lands in workflow:events:global)
 *   3. `schemaRegistry.get(<catalog ref>).safeParse(wire)` after `initializeWorkflowRuntimeV2()`
 *
 * It never throws for a contract violation; it returns a result so callers (the
 * registry test and the self-test) can decide what failure means.
 */

export type EmitterCase = {
  /** `path#symbol` of the product function that publishes this event. No line numbers. */
  site: string;
  /** Calls the REAL exported builder with realistic domain inputs. */
  build: () => Record<string, unknown>;
  /** Overrides for the publish context (actor, occurredAt, ...). */
  ctx?: Partial<WorkflowEventPublishContext>;
  /**
   * Payload keys the emitter must carry even where the schema marks them optional
   * (e.g. `commentId`: a workflow can only correlate on it if it is present). Schemas cannot
   * express "optional, but the emitter always sends it".
   */
  expectFields?: readonly string[];
  /**
   * `rawPublishEvent` for emitters that still hand the event bus their payload as-is (no
   * `buildWorkflowPayload` envelope): the inbound-email outbox dispatcher and WorkflowEventPublisher.
   * Default is `publishWorkflowEvent`. A harness option of the same name overrides this.
   */
  publishPath?: 'publishWorkflowEvent' | 'rawPublishEvent';
};

export type HarnessIssue = { path: string; code: string; message: string };

export type HarnessResult = {
  ok: boolean;
  eventType: string;
  site: string;
  schemaRef: string;
  /** The payload as the worker sees it. */
  wire: Record<string, unknown> | undefined;
  issues: HarnessIssue[];
};

export type HarnessOptions = {
  /**
   * `publishWorkflowEvent` (default): the builder output goes through `buildWorkflowPayload`.
   * `rawPublishEvent`: the legacy path where the call site hands `publishEvent` its literal as-is.
   * Only the self-test uses the latter, to replay drift that predates the typed helper.
   */
  publishPath?: 'publishWorkflowEvent' | 'rawPublishEvent';
  /**
   * Test seam for the `convertToWorkflowEvent` `occurredAt` backstop. The default is the real
   * function. The self-test injects a converter without the backstop to prove the harness would
   * have caught alga0002101 had the backstop not hidden it.
   */
  /**
   * Self-test only: validate against this ref instead of the catalog's. Lets the self-test replay
   * drift for schema-only events (e.g. TICKET_COMMENT_ADDED) that are not catalogued yet.
   */
  schemaRef?: string;
  convert?: (event: { id: string; eventType: string; timestamp: string; payload: Record<string, unknown> }) => {
    payload: Record<string, unknown>;
  };
};

export const HARNESS_TENANT_ID = 'tenant-contract';
export const HARNESS_ACTOR_USER_ID = '22222222-2222-4222-8222-222222222222';
export const HARNESS_EVENT_TIMESTAMP = '2026-07-16T12:00:00.000Z';

const defaultConvert: NonNullable<HarnessOptions['convert']> = (event) =>
  convertToWorkflowEvent(event as never) as { payload: Record<string, unknown> };

function toIssues(error: { issues: Array<{ path: Array<string | number>; code: string; message: string }> }): HarnessIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

export function runEmitterCase(
  eventType: WorkflowCatalogEventType,
  emitterCase: EmitterCase,
  options: HarnessOptions = {}
): HarnessResult {
  initializeWorkflowRuntimeV2();
  const schemaRef = options.schemaRef ?? getWorkflowEventSchemaRef(eventType);
  const base = { eventType, site: emitterCase.site, schemaRef };

  const built = emitterCase.build();
  const payload =
    (options.publishPath ?? emitterCase.publishPath) === 'rawPublishEvent'
      ? built
      : buildWorkflowPayload(built, {
          tenantId: HARNESS_TENANT_ID,
          actor: { actorType: 'USER', actorUserId: HARNESS_ACTOR_USER_ID },
          ...emitterCase.ctx,
        });

  const wire = (options.convert ?? defaultConvert)({
    id: '55555555-5555-4555-8555-555555555555',
    eventType,
    timestamp: HARNESS_EVENT_TIMESTAMP,
    payload,
  }).payload;

  const registry = getSchemaRegistry();
  if (!registry.has(schemaRef)) {
    return {
      ...base,
      ok: false,
      wire,
      issues: [
        {
          path: '',
          code: 'schema_not_registered',
          message: `The workflow worker's schema registry has no schema for ${schemaRef}; the worker would throw while validating ${eventType}.`,
        },
      ],
    };
  }

  const parsed = registry.get(schemaRef).safeParse(wire);
  const issues = parsed.success ? [] : toIssues(parsed.error);

  for (const field of emitterCase.expectFields ?? []) {
    if (wire?.[field] === undefined) {
      issues.push({
        path: field,
        code: 'expected_field_missing',
        message: `Emitter ${emitterCase.site} must send "${field}" but the wire payload does not carry it.`,
      });
    }
  }

  return { ...base, ok: issues.length === 0, wire, issues };
}

export function formatHarnessFailure(result: HarnessResult): string {
  const lines = result.issues.map((issue) => `  - ${issue.path || '(root)'}: ${issue.message} [${issue.code}]`);
  return [
    `${result.eventType} emitter rejected by ${result.schemaRef}`,
    `site: ${result.site}`,
    ...lines,
    `wire payload: ${JSON.stringify(result.wire)}`,
  ].join('\n');
}

export function assertEmitterCase(
  eventType: WorkflowCatalogEventType,
  emitterCase: EmitterCase,
  options?: HarnessOptions
): void {
  const result = runEmitterCase(eventType, emitterCase, options);
  if (!result.ok) throw new Error(formatHarnessFailure(result));
}
