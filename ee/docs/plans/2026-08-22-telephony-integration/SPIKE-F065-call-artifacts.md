# F065 spike — the Graph surface for Teams Phone call recordings/transcripts

Status: **answered** (desk research, 2026-08-22) · Gates the `call-transcripts` group

## Question

PRD Risk #2: `getAllRecordings` / `getAllTranscripts` are meetings-scoped. Does
Graph expose recordings and transcripts for a Teams Phone 1:1 / PSTN call at
all, and if so, through which surface?

## Answer

Yes — through the **ad hoc call** resource, which is a distinct surface from
online meetings and did not exist when the meetings work was done.

```
# Enumeration — the ONLY collection surface (items carry callId):
GET /users/{userId}/adhocCalls/getAllRecordings(userId=...,startDateTime=...,endDateTime=...)
GET /users/{userId}/adhocCalls/getAllTranscripts(userId=...,startDateTime=...,endDateTime=...)

# Single item + content, by artifact id:
GET /users/{userId}/adhocCalls/{callId}/recordings/{recordingId}
GET /users/{userId}/adhocCalls/{callId}/recordings/{recordingId}/content     → video/mp4
GET /users/{userId}/adhocCalls/{callId}/transcripts/{transcriptId}
GET /users/{userId}/adhocCalls/{callId}/transcripts/{transcriptId}/content   → text/vtt
```

> **Correction (2026-08-25, doc-verified):** the first version of this spike also
> claimed per-call list endpoints (`GET .../adhocCalls/{callId}/recordings`).
> Those do not exist in Graph v1.0 — the resource's only collection methods are
> the getAll functions above ([adhocCall resource](https://learn.microsoft.com/en-us/graph/api/resources/adhoccall?view=graph-rest-1.0),
> [getAllRecordings](https://learn.microsoft.com/en-us/graph/api/adhoccall-getallrecordings?view=graph-rest-1.0)) —
> and the emulator faithfully implementing the fiction validated it, the exact
> failure mode of the Entra direct-sync bug (main 907702138d). Both the fetcher
> and the emulator now use only the documented surface. Community reports also
> show 501/empty responses on these endpoints in some tenants during rollout —
> treat unavailability as "no artifacts", never as integration failure.

`adhocCall` is Microsoft's term for the spontaneous call class — PSTN, 1:1 and
group calls — i.e. exactly what Teams Phone produces. The `callId` is the call
id, the same value the callRecord carries as its `id`, so the ledger row we
already write is the join key: `telephony_call_records.provider_call_id` →
`{callId}`.

## What this costs us that meetings did not

1. **Different permissions.** Ad hoc call artifacts do *not* use
   `OnlineMeetingRecording.Read.All` / `OnlineMeetingTranscript.Read.All`. The
   application permissions are `CallRecordings.Read.All` and the transcript
   equivalent. That is a **new admin consent** on the Entra app registration —
   an operator action, on top of the `CallRecords.Read.All` this plan already
   needs for the CDR itself.
2. **An application access policy is still required.** As with meetings,
   app-only access to a user's call artifacts needs a Teams application access
   policy granted to that user; without it the fetch 403s even with consent.
3. **No artifact change notification for ad hoc calls today.** The
   `getAllRecordings` / `getAllTranscripts` subscription resources are
   meetings-scoped. For calls, the trigger has to be the callRecord
   notification we already receive, followed by a poll of the ad hoc call's
   artifact list — recordings are not published at call-end, so a short
   bounded retry (the meeting pipeline's `recording_fetch_attempts` pattern)
   is the shape to reuse.
4. **Recording is off by default.** Teams Phone call recording is a per-policy
   feature; most tenants record nothing, so the UI must treat "no artifact" as
   the normal case, not an error.

## Consequence for this plan

**Built (2026-08-24).** The `call-transcripts` group shipped on this answer:
`fetchTeamsCallArtifacts` reads the ad hoc call's recordings/transcripts,
`captureCallArtifacts` persists them (transcript → document, recording → file)
against `telephony_call_artifacts`, and `annotateLinkedTicketFromTranscript`
took a call-aware input rather than growing a second summarizer. Because there
is no artifact notification, the CDR notification starts the poll and the
`sweep-telephony-call-artifacts` maintenance job continues it on the bounded
backoff this spike prescribed.

What remains is not code: the second Entra consent
(`CallRecordings.Read.All` / `CallTranscripts.Read.All`) and a Teams
application access policy for the organizer. Until an operator grants them,
Graph answers 403 — which the fetcher deliberately reads as "nothing
recorded", the same as the many tenants that never turn recording on.

## Sources

- [Get callRecording — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/callrecording-get?view=graph-rest-1.0)
- [Get callTranscript — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/calltranscript-get?view=graph-rest-1.0)
- [Working with the call records API in Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/resources/callrecords-api-overview?view=graph-rest-1.0)
- [Microsoft Graph call records API FAQ](https://learn.microsoft.com/en-us/graph/callrecords-api-faq)
