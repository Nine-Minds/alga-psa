import { z } from 'zod';

const scheduleId = z.string().uuid();
const workflowId = z.string().uuid();

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().min(1)
).optional();

const scheduleName = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.string().min(1, 'Schedule name is required.')
);

const triggerType = z.enum(['schedule', 'recurring']);
const dayTypeFilter = z.enum(['any', 'business', 'non_business']);
const optionalUuid = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid()
).optional();

const jsonObjectPayload = z.record(z.any()).default({});

const baseScheduleInput = z.object({
  workflowId,
  name: scheduleName,
  triggerType,
  dayTypeFilter: dayTypeFilter.default('any'),
  businessHoursScheduleId: optionalUuid.nullish(),
  payload: jsonObjectPayload,
  enabled: z.boolean().default(true)
});

export const ListWorkflowSchedulesInput = z.object({
  workflowId: workflowId.optional(),
  triggerType: z.enum(['all', 'schedule', 'recurring']).default('all'),
  status: z.enum(['all', 'enabled', 'paused', 'failed', 'completed', 'disabled']).default('all'),
  search: optionalTrimmedString
});

export const GetWorkflowScheduleInput = z.object({
  scheduleId
});

export const CreateWorkflowScheduleInput = baseScheduleInput.extend({
  runAt: optionalTrimmedString,
  cron: optionalTrimmedString,
  timezone: optionalTrimmedString
});

export const UpdateWorkflowScheduleInput = baseScheduleInput.extend({
  scheduleId,
  runAt: optionalTrimmedString,
  cron: optionalTrimmedString,
  timezone: optionalTrimmedString
});

export const WorkflowScheduleStatusToggleInput = z.object({
  scheduleId,
  enabled: z.boolean()
});

export const DeleteWorkflowScheduleInput = z.object({
  scheduleId
});

export type CreateWorkflowScheduleInputShape = z.infer<typeof CreateWorkflowScheduleInput>;
export type UpdateWorkflowScheduleInputShape = z.infer<typeof UpdateWorkflowScheduleInput>;
