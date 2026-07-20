import { z } from 'zod';
import { BaseDomainEventPayloadSchema, changesSchema, updatedFieldsSchema, uuidSchema } from './commonEventPayloadSchemas';

const projectIdSchema = uuidSchema('Project ID');
const taskIdSchema = uuidSchema('Task ID');
const userIdSchema = uuidSchema('User ID');

const assignedToTypeSchema = z.enum(['user', 'team']).describe('Assignee type');
const projectBillingStatusSchema = z.enum(['pending', 'ready', 'held', 'approved', 'invoiced', 'canceled']);
const projectBillingPaymentStateSchema = z.enum(['outstanding', 'satisfied', 'replacement_needed']);

export const projectCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
}).describe('Payload for PROJECT_CREATED');

export type ProjectCreatedEventPayload = z.infer<typeof projectCreatedEventPayloadSchema>;

export const projectUpdatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  updatedAt: z.string().datetime().optional(),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for PROJECT_UPDATED');

export type ProjectUpdatedEventPayload = z.infer<typeof projectUpdatedEventPayloadSchema>;

export const projectStatusChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  previousStatus: z.string().min(1),
  newStatus: z.string().min(1),
  changedAt: z.string().datetime().optional(),
}).describe('Payload for PROJECT_STATUS_CHANGED');

export type ProjectStatusChangedEventPayload = z.infer<typeof projectStatusChangedEventPayloadSchema>;

export const projectTaskCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  taskId: taskIdSchema,
  projectId: projectIdSchema,
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
  title: z.string().min(1),
  dueDate: z.string().optional(),
  status: z.string().min(1),
}).describe('Payload for PROJECT_TASK_CREATED');

export type ProjectTaskCreatedEventPayload = z.infer<typeof projectTaskCreatedEventPayloadSchema>;

export const projectTaskAssignedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  taskId: taskIdSchema,
  projectId: projectIdSchema,
  assignedToId: z.string().uuid(),
  assignedToType: assignedToTypeSchema,
  assignedByUserId: userIdSchema.optional(),
  assignedByName: z.string().optional().describe('Display name of the user who assigned the task'),
  assignedAt: z.string().datetime().optional(),
}).describe('Payload for PROJECT_TASK_ASSIGNED');

export type ProjectTaskAssignedEventPayload = z.infer<typeof projectTaskAssignedEventPayloadSchema>;

export const projectTaskStatusChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  taskId: taskIdSchema,
  projectId: projectIdSchema,
  previousStatus: z.string().min(1),
  newStatus: z.string().min(1),
  changedAt: z.string().datetime().optional(),
}).describe('Payload for PROJECT_TASK_STATUS_CHANGED');

export type ProjectTaskStatusChangedEventPayload = z.infer<typeof projectTaskStatusChangedEventPayloadSchema>;

export const projectTaskCompletedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  taskId: taskIdSchema,
  projectId: projectIdSchema,
  completedByUserId: userIdSchema.optional(),
  completedAt: z.string().datetime().optional(),
}).describe('Payload for PROJECT_TASK_COMPLETED');

export type ProjectTaskCompletedEventPayload = z.infer<typeof projectTaskCompletedEventPayloadSchema>;

export const projectTaskDependencyBlockedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  taskId: taskIdSchema,
  projectId: projectIdSchema,
  blockedByTaskId: taskIdSchema,
  blockedAt: z.string().datetime().optional(),
}).describe('Payload for PROJECT_TASK_DEPENDENCY_BLOCKED');

export type ProjectTaskDependencyBlockedEventPayload = z.infer<
  typeof projectTaskDependencyBlockedEventPayloadSchema
>;

export const projectTaskDependencyUnblockedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  taskId: taskIdSchema,
  projectId: projectIdSchema,
  unblockedByTaskId: taskIdSchema,
  unblockedAt: z.string().datetime().optional(),
}).describe('Payload for PROJECT_TASK_DEPENDENCY_UNBLOCKED');

export type ProjectTaskDependencyUnblockedEventPayload = z.infer<
  typeof projectTaskDependencyUnblockedEventPayloadSchema
>;

export const projectApprovalRequestedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  approvalId: z.string().uuid(),
  projectId: projectIdSchema,
  approvalType: z.string().min(1),
  requestedByUserId: userIdSchema.optional(),
  requestedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
}).describe('Payload for PROJECT_APPROVAL_REQUESTED');

export type ProjectApprovalRequestedEventPayload = z.infer<typeof projectApprovalRequestedEventPayloadSchema>;

export const projectApprovalGrantedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  approvalId: z.string().uuid(),
  projectId: projectIdSchema,
  approvalType: z.string().min(1),
  approvedByUserId: userIdSchema.optional(),
  approvedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
}).describe('Payload for PROJECT_APPROVAL_GRANTED');

export type ProjectApprovalGrantedEventPayload = z.infer<typeof projectApprovalGrantedEventPayloadSchema>;

export const projectApprovalRejectedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  approvalId: z.string().uuid(),
  projectId: projectIdSchema,
  approvalType: z.string().min(1),
  rejectedByUserId: userIdSchema.optional(),
  rejectedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for PROJECT_APPROVAL_REJECTED');

export type ProjectApprovalRejectedEventPayload = z.infer<typeof projectApprovalRejectedEventPayloadSchema>;

export const projectMilestoneReadyEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  entryId: uuidSchema('Project billing schedule entry ID'),
  description: z.string().min(1),
  computedAmount: z.number().int().nonnegative(),
  trigger: z.enum(['phase', 'date', 'manual']),
}).describe('Payload for PROJECT_MILESTONE_READY');

export const projectBudgetThresholdReachedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  threshold: z.number().int().nonnegative(),
  billed: z.number().int().nonnegative(),
  cap: z.number().int().nonnegative(),
}).describe('Payload for PROJECT_BUDGET_THRESHOLD_REACHED');

export const projectBudgetExceededEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  invoiceId: uuidSchema('Invoice ID'),
  billed: z.number().int().nonnegative(),
  attempted: z.number().int().positive(),
  cap: z.number().int().nonnegative(),
  writtenDown: z.number().int().positive(),
}).describe('Payload for PROJECT_BUDGET_EXCEEDED');

export const projectBillingConfigEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  configId: uuidSchema('Project billing configuration ID'),
  billingModel: z.enum(['fixed_price', 'time_and_materials']),
  invoiceMode: z.enum(['recurring', 'standalone']),
  userId: userIdSchema.optional(),
  changes: z.record(z.unknown()).optional(),
}).describe('Payload for project billing configuration lifecycle events');

export const projectBillingScheduleEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  configId: uuidSchema('Project billing configuration ID'),
  entryId: uuidSchema('Project billing schedule entry ID'),
  description: z.string().min(1),
  status: projectBillingStatusSchema,
  previousStatus: projectBillingStatusSchema.nullable().optional(),
  requiresPaymentBeforeWork: z.boolean(),
  userId: userIdSchema.optional(),
  changes: z.record(z.unknown()).optional(),
}).describe('Payload for project billing schedule lifecycle events');

export const projectBillingPaymentStatusEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  projectId: projectIdSchema,
  configId: uuidSchema('Project billing configuration ID'),
  entryId: uuidSchema('Project billing schedule entry ID'),
  invoiceId: uuidSchema('Invoice ID'),
  previousState: projectBillingPaymentStateSchema,
  newState: projectBillingPaymentStateSchema,
  previousInvoiceStatus: z.string().min(1),
  newInvoiceStatus: z.string().min(1),
  requiresPaymentBeforeWork: z.literal(true),
  userId: userIdSchema.optional(),
}).describe('Payload for PROJECT_BILLING_PAYMENT_STATUS_CHANGED');
