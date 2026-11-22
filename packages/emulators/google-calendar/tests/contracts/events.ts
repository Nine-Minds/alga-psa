import { z } from 'zod';

// Independent contract source, reviewed 2026-11-05:
// https://developers.google.com/calendar/api/v3/reference/events/list
// https://developers.google.com/calendar/api/v3/reference/events#resource
// https://developers.google.com/calendar/api/guides/sync
// Only the fields Alga's adapter consumes are checked; extra Google fields are
// allowed, so this is not a complete event schema.
const eventDate = z.object({
  dateTime: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timeZone: z.string().min(1).optional(),
}).refine((value) => Boolean(value.dateTime) !== Boolean(value.date), {
  message: 'an event date is either dateTime or date, never both',
});

export const eventResource = z.object({
  id: z.string().min(1),
  status: z.enum(['confirmed', 'tentative', 'cancelled']),
  summary: z.string().optional(),
  start: eventDate,
  end: eventDate,
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().min(1).optional(),
  originalStartTime: eventDate.optional(),
  updated: z.string().min(1),
});

/** A cancelled instance is a tombstone: ids and status only. */
export const cancelledInstance = z.object({
  id: z.string().min(1),
  status: z.literal('cancelled'),
  recurringEventId: z.string().min(1),
});

export const eventsListResponse = z.object({
  status: z.literal(200),
  body: z.object({
    kind: z.literal('calendar#events'),
    items: z.array(z.union([eventResource, cancelledInstance])),
    nextPageToken: z.string().min(1).optional(),
    nextSyncToken: z.string().min(1).optional(),
  }),
});

// https://developers.google.com/calendar/api/guides/errors
export const errorResponse = z.object({
  status: z.number().int().min(400).max(599),
  body: z.object({
    error: z.object({
      code: z.number().int(),
      message: z.string().min(1),
      errors: z.array(z.object({ domain: z.string(), reason: z.string().min(1), message: z.string() })).optional(),
    }),
  }),
});

export const tokenResponse = z.object({
  status: z.literal(200),
  body: z.object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    token_type: z.literal('Bearer'),
    scope: z.string().min(1),
  }),
});
