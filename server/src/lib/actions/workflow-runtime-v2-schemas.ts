import { z } from 'zod';
import { workflowDefinitionSchema } from '@shared/workflow/runtime';

const versionNumber = z.preprocess(
  (val) => (typeof val === 'string' ? Number(val) : val),
  z.number().int().positive()
);

export const CreateWorkflowDefinitionInput = z.object({
  definition: workflowDefinitionSchema
});

export const UpdateWorkflowDefinitionInput = z.object({
  workflowId: z.string().min(1),
  definition: workflowDefinitionSchema
});

export const GetWorkflowDefinitionVersionInput = z.object({
  workflowId: z.string().min(1),
  version: versionNumber
});

export const PublishWorkflowDefinitionInput = z.object({
  workflowId: z.string().min(1),
  version: versionNumber,
  definition: z.record(z.any()).optional()
});

export const StartWorkflowRunInput = z.object({
  workflowId: z.string().min(1),
  workflowVersion: versionNumber,
  payload: z.record(z.any()).default({})
});

export const RunIdInput = z.object({
  runId: z.string().min(1)
});

export const SchemaRefInput = z.object({
  schemaRef: z.string().min(1)
});

export const SubmitWorkflowEventInput = z.object({
  eventName: z.string().min(1),
  correlationKey: z.string().min(1),
  payload: z.record(z.any()).default({})
});
