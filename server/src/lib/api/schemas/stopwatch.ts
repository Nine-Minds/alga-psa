/**
 * Stopwatch API Schemas
 * Validation and response schemas for /api/v1/stopwatch (server-side stopwatch sessions).
 */

import { z } from 'zod';
import { uuidSchema } from './common';

/** The stopwatch can be started on tickets and project tasks. */
export const stopwatchWorkItemTypeSchema = z.enum(['ticket', 'project_task']);

export const stopwatchStatusSchema = z.enum(['running', 'paused', 'logged', 'discarded']);

export const startStopwatchSchema = z.object({
  work_item_type: stopwatchWorkItemTypeSchema,
  work_item_id: uuidSchema,
  service_id: uuidSchema.nullable().optional(),
  notes: z.string().optional(),
});

export const updateStopwatchSchema = z.object({
  notes: z.string().optional(),
  service_id: uuidSchema.nullable().optional(),
});

export const logStopwatchSchema = z.object({
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  /** Minutes. Derived from the final start/end span when omitted. */
  billable_duration: z.number().int().min(0).optional(),
  is_billable: z.boolean().optional(),
  notes: z.string().optional(),
  service_id: uuidSchema.optional(),
});

export const activeStopwatchQuerySchema = z.object({
  user_id: uuidSchema.optional(),
});

export const stopwatchSegmentResponseSchema = z.object({
  segment_id: uuidSchema,
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable().describe('Null while the segment is open (the stopwatch is running).'),
});

export const stopwatchSessionResponseSchema = z.object({
  session_id: uuidSchema,
  user_id: uuidSchema,
  work_item_type: z.string(),
  work_item_id: uuidSchema.nullable(),
  service_id: uuidSchema.nullable(),
  notes: z.string(),
  status: stopwatchStatusSchema,
  time_entry_id: uuidSchema.nullable(),
  closed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  segments: z.array(stopwatchSegmentResponseSchema),
  active_ms: z.number().describe('Active (non-paused) milliseconds as of server_now.'),
  server_now: z.string().datetime().describe('Server clock at the moment the response was built; derive a clock offset from it.'),
  ticket_number: z.string().nullable(),
  work_item_title: z.string().nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  service_name: z.string().nullable(),
});

export type StartStopwatchData = z.infer<typeof startStopwatchSchema>;
export type UpdateStopwatchData = z.infer<typeof updateStopwatchSchema>;
export type LogStopwatchData = z.infer<typeof logStopwatchSchema>;
export type ActiveStopwatchQuery = z.infer<typeof activeStopwatchQuerySchema>;
export type StopwatchSessionResponse = z.infer<typeof stopwatchSessionResponseSchema>;
