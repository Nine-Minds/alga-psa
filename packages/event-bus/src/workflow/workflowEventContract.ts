import logger from '@alga-psa/core/logger';
import {
  getWorkflowEventSchemaRef,
  isWorkflowCatalogEventType,
  workflowEventPayloadSchemas,
  type WorkflowCatalogEventType,
} from '@alga-psa/event-schemas';

/**
 * Emit-time validation of catalogued workflow events (plan step F).
 *
 * The payload that goes on the wire (after `convertToWorkflowEvent`) is checked against the same
 * canonical schema the workflow worker validates with, resolved through the code-level catalog.
 *
 *   enforce  throw          default when NODE_ENV=test
 *   warn     log at warn    default when NODE_ENV=development
 *   off      no-op          default otherwise (production: the worker already records failures)
 *
 * `WORKFLOW_EVENT_CONTRACT_MODE` overrides the default.
 */
export type WorkflowEventContractMode = 'enforce' | 'warn' | 'off';

export class WorkflowEventContractError extends Error {
  readonly eventType: string;
  readonly schemaRef: string;
  readonly issues: Array<{ path: string; code: string; message: string }>;

  constructor(
    eventType: string,
    schemaRef: string,
    issues: Array<{ path: string; code: string; message: string }>
  ) {
    super(
      `[WorkflowEventContract] ${eventType} payload does not satisfy ${schemaRef}: ${JSON.stringify(issues)}`
    );
    this.name = 'WorkflowEventContractError';
    this.eventType = eventType;
    this.schemaRef = schemaRef;
    this.issues = issues;
  }
}

export function getWorkflowEventContractMode(env: NodeJS.ProcessEnv = process.env): WorkflowEventContractMode {
  const explicit = env.WORKFLOW_EVENT_CONTRACT_MODE?.trim().toLowerCase();
  if (explicit === 'enforce' || explicit === 'warn' || explicit === 'off') return explicit;
  if (env.NODE_ENV === 'test') return 'enforce';
  if (env.NODE_ENV === 'development') return 'warn';
  return 'off';
}

export type WorkflowEventContractCheck =
  | { ok: true }
  | { ok: false; schemaRef: string; issues: Array<{ path: string; code: string; message: string }> };

/** Pure check: does `payload` satisfy the canonical schema for catalogued `eventType`? */
export function checkWorkflowEventPayload(
  eventType: WorkflowCatalogEventType,
  payload: unknown
): WorkflowEventContractCheck {
  const schemaRef = getWorkflowEventSchemaRef(eventType);
  const schema = workflowEventPayloadSchemas[schemaRef];
  if (!schema) {
    return {
      ok: false,
      schemaRef,
      issues: [{ path: '', code: 'schema_not_registered', message: `No schema registered for ${schemaRef}` }],
    };
  }
  const result = schema.safeParse(payload);
  if (result.success) return { ok: true };
  return {
    ok: false,
    schemaRef,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  };
}

/**
 * Apply the contract in the active mode. Returns normally unless the mode is `enforce` and the
 * payload is invalid. Non-catalogued event types are ignored.
 */
export function enforceWorkflowEventContract(
  eventType: string,
  payload: unknown,
  mode: WorkflowEventContractMode = getWorkflowEventContractMode()
): void {
  if (mode === 'off' || !isWorkflowCatalogEventType(eventType)) return;
  const check = checkWorkflowEventPayload(eventType, payload);
  if (check.ok) return;
  // Explicit narrowing: consumers compile this file without strictNullChecks, where the union does not narrow.
  const failed = check as Extract<WorkflowEventContractCheck, { ok: false }>;
  const error = new WorkflowEventContractError(eventType, failed.schemaRef, failed.issues);
  if (mode === 'enforce') throw error;
  logger.warn(error.message, {
    eventType,
    schemaRef: failed.schemaRef,
    issues: failed.issues,
    stack: new Error('emit site').stack,
  });
}
