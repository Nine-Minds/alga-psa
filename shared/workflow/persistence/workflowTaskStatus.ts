/**
 * Enum for workflow task status.
 *
 * Kept in its own client-safe module (no `@alga-psa/db` import) so client
 * components — e.g. the workflow TaskInbox — can import the enum *value* without
 * pulling the server-only db/knex/secrets chain that workflowTaskModel.ts
 * depends on into the browser bundle. workflowTaskModel.ts and the persistence
 * barrel both re-export it, so server importers are unaffected.
 */
export enum WorkflowTaskStatus {
  PENDING = 'pending',
  CLAIMED = 'claimed',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
  EXPIRED = 'expired'
}
