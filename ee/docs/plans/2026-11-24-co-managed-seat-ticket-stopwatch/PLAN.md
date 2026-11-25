# Log ticket stopwatch time for co-managed seat technicians

A client IT technician can run the stopwatch on an accessible ticket. Stopping it opens the time-entry drawer, but saving fails with “a stopwatch session cannot be logged on the operational surface.” The expected result is the same client IT effort as manual entry, with the stopwatch closed after a successful save.

1. Trace the ticket drawer through `logPreparedStopwatchEntries` and `logSession`. Carry the billing mode derived from the authenticated technician through the existing transactional save. Reuse the manual operational-entry rules, including ticket scope, entry ownership, actual duration, zero billable minutes, and empty commercial fields.
2. Preserve session ownership, paused elapsed time, and the existing per-day split. Save all entries and close the session together. A failed save must leave the paused session available for retry, and repeating a successful save must not duplicate time.
3. Verify through the ticket stopwatch that a seat technician can stop, save, and see their time under client IT effort. Add behavioral coverage for billing exclusion, an unsuccessful save followed by retry, and an ordinary MSP technician recording commercial time through the same path.
