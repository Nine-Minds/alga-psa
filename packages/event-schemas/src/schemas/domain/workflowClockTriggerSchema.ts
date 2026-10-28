import { z } from 'zod';

export const WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF = 'payload.WorkflowClockTrigger.v1';

export const workflowClockTriggerPayloadSchema = z.object({
  triggerType: z.enum(['schedule', 'recurring']).describe('Clock trigger kind that started the workflow'),
  scheduleId: z.string().describe('Workflow schedule registration identifier'),
  scheduledFor: z.string().datetime().describe('Scheduled fire time in ISO 8601 UTC form'),
  firedAt: z.string().datetime().describe('Actual handler fire time in ISO 8601 UTC form'),
  timezone: z.string().min(1).describe('IANA timezone associated with the trigger'),
  workflowId: z.string().describe('Workflow definition identifier'),
  workflowVersion: z.number().int().positive().describe('Published workflow version'),
  cron: z.string().min(1).optional().describe('Recurring cron expression when triggerType=recurring')
}).strict();

export type WorkflowClockTriggerPayload = z.infer<typeof workflowClockTriggerPayloadSchema>;
