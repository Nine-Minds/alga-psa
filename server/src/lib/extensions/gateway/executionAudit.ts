/**
 * The durable pre-dispatch execution audit is owned by the
 * `@product/ext-proxy` package alongside the canonical access policy, so both
 * gateway surfaces share one implementation without a `server <->
 * @product/ext-proxy` import cycle. This module re-exports it for existing
 * server-side importers.
 */
export {
  startExtensionExecution,
  finishExtensionExecution,
} from '@product/ext-proxy/ee/gateway/executionAudit';
export type {
  ExtensionExecutionOutcome,
  StartExtensionExecutionInput,
  FinishExtensionExecutionInput,
} from '@product/ext-proxy/ee/gateway/executionAudit';
