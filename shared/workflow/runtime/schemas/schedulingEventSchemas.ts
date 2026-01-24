import { z } from 'zod';
import { BaseDomainEventPayloadSchema, uuidSchema } from './commonEventPayloadSchemas';

const appointmentIdSchema = uuidSchema('Appointment ID');
const ticketIdSchema = uuidSchema('Ticket ID');
const scheduleBlockIdSchema = uuidSchema('Schedule Block ID');
const teamIdSchema = uuidSchema('Team ID');
const userIdSchema = uuidSchema('User ID');

const assigneeTypeSchema = z.enum(['user', 'team']).describe('Assignee type');
const partySchema = z.enum(['customer', 'agent']).describe('No-show party');

export const appointmentCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string().min(1),
  assigneeId: z.string().uuid().optional(),
  assigneeType: assigneeTypeSchema.optional(),
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
  location: z.string().optional(),
}).describe('Payload for APPOINTMENT_CREATED');

export type AppointmentCreatedEventPayload = z.infer<typeof appointmentCreatedEventPayloadSchema>;

export const appointmentRescheduledEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  previousStartAt: z.string().datetime(),
  previousEndAt: z.string().datetime(),
  newStartAt: z.string().datetime(),
  newEndAt: z.string().datetime(),
  timezone: z.string().min(1),
  rescheduledAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for APPOINTMENT_RESCHEDULED');

export type AppointmentRescheduledEventPayload = z.infer<typeof appointmentRescheduledEventPayloadSchema>;

export const appointmentCanceledEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  canceledAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for APPOINTMENT_CANCELED');

export type AppointmentCanceledEventPayload = z.infer<typeof appointmentCanceledEventPayloadSchema>;

export const appointmentCompletedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  completedAt: z.string().datetime().optional(),
  outcome: z.string().optional(),
}).describe('Payload for APPOINTMENT_COMPLETED');

export type AppointmentCompletedEventPayload = z.infer<typeof appointmentCompletedEventPayloadSchema>;

export const appointmentNoShowEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  markedAt: z.string().datetime().optional(),
  party: partySchema,
}).describe('Payload for APPOINTMENT_NO_SHOW');

export type AppointmentNoShowEventPayload = z.infer<typeof appointmentNoShowEventPayloadSchema>;

export const appointmentAssignedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  previousAssigneeId: z.string().uuid().optional(),
  previousAssigneeType: assigneeTypeSchema.optional(),
  newAssigneeId: z.string().uuid(),
  newAssigneeType: assigneeTypeSchema,
  assignedAt: z.string().datetime().optional(),
}).describe('Payload for APPOINTMENT_ASSIGNED');

export type AppointmentAssignedEventPayload = z.infer<typeof appointmentAssignedEventPayloadSchema>;

const ownerTypeSchema = z.enum(['user', 'team']).describe('Owner type');

export const scheduleBlockCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  scheduleBlockId: scheduleBlockIdSchema,
  ownerId: z.string().uuid(),
  ownerType: ownerTypeSchema,
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string().min(1),
  createdAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for SCHEDULE_BLOCK_CREATED');

export type ScheduleBlockCreatedEventPayload = z.infer<typeof scheduleBlockCreatedEventPayloadSchema>;

export const scheduleBlockDeletedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  scheduleBlockId: scheduleBlockIdSchema,
  deletedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for SCHEDULE_BLOCK_DELETED');

export type ScheduleBlockDeletedEventPayload = z.infer<typeof scheduleBlockDeletedEventPayloadSchema>;

export const capacityThresholdReachedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  teamId: teamIdSchema,
  date: z.string().min(1).describe('Local date (YYYY-MM-DD)'),
  capacityLimit: z.number().nonnegative(),
  currentBooked: z.number().nonnegative(),
  triggeredAt: z.string().datetime().optional(),
}).describe('Payload for CAPACITY_THRESHOLD_REACHED');

export type CapacityThresholdReachedEventPayload = z.infer<typeof capacityThresholdReachedEventPayloadSchema>;

export const technicianDispatchedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  technicianUserId: userIdSchema,
  dispatchedByUserId: userIdSchema.optional(),
  dispatchedAt: z.string().datetime().optional(),
}).describe('Payload for TECHNICIAN_DISPATCHED');

export type TechnicianDispatchedEventPayload = z.infer<typeof technicianDispatchedEventPayloadSchema>;

export const technicianEnRouteEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  technicianUserId: userIdSchema,
  startedAt: z.string().datetime().optional(),
  eta: z.string().datetime().optional(),
}).describe('Payload for TECHNICIAN_EN_ROUTE');

export type TechnicianEnRouteEventPayload = z.infer<typeof technicianEnRouteEventPayloadSchema>;

export const technicianArrivedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  technicianUserId: userIdSchema,
  arrivedAt: z.string().datetime().optional(),
  location: z.string().optional(),
}).describe('Payload for TECHNICIAN_ARRIVED');

export type TechnicianArrivedEventPayload = z.infer<typeof technicianArrivedEventPayloadSchema>;

export const technicianCheckedOutEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  appointmentId: appointmentIdSchema,
  ticketId: ticketIdSchema.optional(),
  technicianUserId: userIdSchema,
  checkedOutAt: z.string().datetime().optional(),
  workSummary: z.string().optional(),
}).describe('Payload for TECHNICIAN_CHECKED_OUT');

export type TechnicianCheckedOutEventPayload = z.infer<typeof technicianCheckedOutEventPayloadSchema>;
