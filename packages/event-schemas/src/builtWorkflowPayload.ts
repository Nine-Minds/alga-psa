import type { WorkflowCatalogEventType } from './workflowEventCatalog';

declare const builtWorkflowPayloadBrand: unique symbol;

/**
 * Compile-time proof that a payload came from a registered payload builder for event type `T`.
 *
 * `publishWorkflowEvent` only accepts this type, so publishing a catalogued event with an inline
 * object literal (or a payload built for a different event) is a compile error. The brand is
 * contravariant in `T`: a builder shared by several events returns `BuiltWorkflowPayload<'A' | 'B'>`
 * and is accepted by either event's publish call.
 *
 * It is a phantom type: there is no runtime marker. The runtime half of the contract is the
 * emitter contract registry (server/src/test/unit/workflow-event-contracts) and emit-time
 * validation in EventBus.publish; the structural half is scripts/check-workflow-event-emit-sites.mjs,
 * which requires every payload argument to be a call to a builder the registry exercises.
 */
export type BuiltWorkflowPayload<T extends WorkflowCatalogEventType> = {
  readonly [builtWorkflowPayloadBrand]: (eventType: T) => void;
};

/**
 * The ONLY way to produce a `BuiltWorkflowPayload`. Call it as the return expression of a
 * `build*Payload` builder; the event type argument ties the payload to the schema the catalog
 * assigns to that event. Identity at runtime.
 */
export function builtWorkflowPayload<T extends WorkflowCatalogEventType, P extends object>(
  _eventType: T,
  payload: P
): P & BuiltWorkflowPayload<T> {
  return payload as P & BuiltWorkflowPayload<T>;
}
