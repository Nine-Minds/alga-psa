import { z } from 'zod';

export const EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF = 'payload.Empty.v1';

export const emptyWorkflowPayloadSchema = z.object({}).strict().describe(
  'Workflow payload with no input fields. Use this for manually run workflows that require an empty object payload.'
);

export type EmptyWorkflowPayload = z.infer<typeof emptyWorkflowPayloadSchema>;
