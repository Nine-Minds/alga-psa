import { z } from 'zod';

// Independent contract source, reviewed 2026-09-08:
// https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0
// Only the response fields consumed by our calendar journey are checked here.
// Extra Graph fields are allowed; this is not a complete Graph event schema.
const dateTimeTimeZone = z.object({
  dateTime: z.string().min(1),
  timeZone: z.string().min(1),
});

export const calendarCreateResponse = z.object({
  status: z.literal(201),
  body: z.object({
    id: z.string().min(1),
    subject: z.string(),
    start: dateTimeTimeZone,
    end: dateTimeTimeZone,
  }),
});

// https://learn.microsoft.com/en-us/graph/errors
export const graphErrorResponse = z.object({
  status: z.number().int().min(400).max(599),
  body: z.object({ error: z.object({
    code: z.string().min(1),
    message: z.string(),
  }) }),
});
