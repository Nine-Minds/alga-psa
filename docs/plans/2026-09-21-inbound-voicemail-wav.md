# Inbound email drops voicemail .wav attachments — implementation plan

- **Ticket:** alga-2026-0002491 (Ryan Hoffmann, FTS Technology) — voicemail `.wav` emailed to a support mailbox is ingested as a ticket, but the recording is not attached.
- **Card:** 8ee8e116-6d66-45a0-8162-b9cb11bc6b9d ("Inbound email drops voicemail .wav attachments")
- **Branch:** `feature/inbound-email-drops-voicemail-wav-attachments-al`
- **Worktree base:** `main` @ `2dc8454a4c`
- **Author:** design-session officer (conn)

---

## 1. Root-cause finding (requirement #1: the exact drop point)

The brief's cited drop point is **not on the IMAP path**. Verified by tracing the code in this worktree:

### What actually runs for an IMAP tenant

IMAP inbound is handled **only** by the in-app pipeline — never Temporal:

1. `email-service` unified queue consumer (`server/src/bin/unifiedInboundEmailQueueConsumer.ts`, `services/email-service/src/index.ts`)
2. → `processUnifiedInboundEmailQueueJob` (`shared/services/email/unifiedInboundEmailQueueJobProcessor.ts:882`)
3. → `fetchImapMessageForPointer` (`unifiedInboundEmailQueueJobProcessor.ts:499`) — fetches with `{ source: true }` (`:627-629`), i.e. the **full RFC822 source including all attachment bytes**, and maps them via `mapParsedMimeToEmailMessageDetails` (`:413-427`), storing each attachment's bytes as inline base64 (`content:` at `:425`).
4. → `processInboundEmailInApp` (called directly at `unifiedInboundEmailQueueJobProcessor.ts:1043`)
5. → `processInboundEmailArtifactsBestEffort` (`shared/services/email/processInboundEmailArtifacts.ts:996`), either inline (V1) or via the durable artifact worker (`inboundEmailArtifactWorker.ts:153`) when `UNIFIED_INBOUND_EMAIL_DURABLE_MODE=enforce`. **Both converge on the same function.**

### That path has no MIME allow-list

In `persistInboundEmailAttachment` (`processInboundEmailArtifacts.ts:693`) a real `.wav` base attachment is: enumerated, size-checked, base64-decoded (`:797`), uploaded (`persistDocumentForBuffer` → `provider.upload` `:506`), and written as a downloadable document (`external_files` `:535`, `documents` `:548`, `document_associations` `:566`, success mirror in `email_processed_attachments` `:575`).

The only skip conditions that exist:
- **100 MB size cap** — `MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024` (`inboundEmailArtifactHelpers.ts:3`), enforced at `processInboundEmailArtifacts.ts:752`, `:835`, `:955`.
- **Missing filename** (`:740`).
- **Consumed-inline-CID dedup** (`:728`) — only fires when the attachment's CID was embedded as an inline image (`consumedInlineCids`, built `:1062-1072`). Never fires for audio.
- **Provider download error** treated as `unsupported_attachment` (`:815-831`) — not reachable for IMAP, whose bytes are inline.
- The image-only check (`:764`, `:847`) is **gated on `allowInlineProcessing`**, which is set only for synthetic embedded images (`inboundEmailArtifactHelpers.ts:170`, `:237`). It never fires for a real `.wav`.

### The brief's cited locations are on unrelated paths

- `ALLOWED_ATTACHMENT_MIME_TYPES` / `isAllowedAttachmentMimeType` / `attachDocumentToTicket` (`shared/workflow/runtime/actions/businessOperations/shared.ts:265`, `:274`, `:280`) is the **generic workflow action** for attaching a document by `file_id`/`document_id`/`url`. It is not invoked by inbound email.
- `process_email_attachments_batch` → `processEmailAttachment` (`shared/workflow/actions/emailWorkflowActions.ts:985`, registered `registerEmailWorkflowActions.ts:753`) is the **legacy Temporal** action. It is only reachable when `INBOUND_EMAIL_RECEIVED` is emitted (`server/src/services/email/EmailProcessor.ts:150`, `MailHogPollingService.ts:339`), which is Microsoft/Gmail-webhook + MailHog only — **not IMAP**. It is also independently broken: it inserts a `documents` row with `content_type`/`name`/`size` but **no `file_id`/`storage_path` and no bytes** (`emailWorkflowActions.ts:997-1012`), so nothing is downloadable.

### Conclusion

On current `main` a `.wav` voicemail on the IMAP path **should already attach as a downloadable document**. The production drop on Ryan's tenant is therefore most plausibly one of:

- **(a)** the tenant is running a build that predates this in-app attachment pipeline (older code with a broader image-only filter, or the legacy Temporal stub that strips bytes); or
- **(b)** the voicemail exceeds the 100 MB cap, or the phone system's MIME framing makes `mailparser` not surface the part as an attachment.

**Open question owed to XO/captain (needs prod access, out of this desk's scope):** confirm the deployed commit for Ryan's tenant and query `email_processed_attachments` for that tenant/provider (`processing_status`, `error_message`, `content_type`) to pin the live drop. Recorded as a card fact on 2026-09-21.

This plan hardens `main` so the guarantee is explicit, consistent with manual upload, and diagnosable from the ticket — and closes the audio gaps that *do* exist on the workflow-action and legacy paths.

---

## 2. Design

Three workstreams, mapped to the required behaviors.

### A. Inbound attachments obey the tenant document-upload policy (requirement #2)

Manual upload validates every file through one shared policy — `StorageService.validateFileUpload(tenant, mime_type, file_size)` (`packages/storage/src/StorageService.ts:490`) → `validateFileUpload` (`packages/storage/src/config/storage.ts:90`): an env-configurable MIME allow-list (default `*/*` = allow all) plus a size ceiling (default 500 MB). The inbound path bypasses this entirely and hand-rolls storage with its own hard 100 MB cap and no MIME policy.

**Change:** make the inbound path validate through the same shared policy, so "inbound email and manual upload agree" (the requirement's preferred option). This both guarantees audio is allowed wherever manual upload allows it and removes duplicated, divergent gating (a `// LEVERAGE: friction` site — inbound re-derives the storage/validation layer manual upload already owns).

- In `persistInboundEmailAttachment` (`processInboundEmailArtifacts.ts:693`), after the buffer + `resolvedMimeType` are known (after `:811`, before `persistDocumentForBuffer` at `:859`), call `StorageService.validateFileUpload(input.tenantId, resolvedMimeType, buffer.length)`. On rejection, `markProcessedAttachment(..., status: 'skipped', errorMessage: 'attachment_type_not_allowed:<mime>')` and return a skip result (feeds workstream B). Replace the inbound-local `MAX_ATTACHMENT_BYTES` size checks (`:752`, `:835`, `:955`) with the shared size ceiling so both agree (keep the pre-download declared-size check as a cheap early-out using the same ceiling).
  - Import: `StorageService` from `@alga-psa/storage` (align with how `processInboundEmailArtifacts.ts:496` already dynamically imports `@alga-psa/storage/StorageProviderFactory`).
  - Original-email `.eml` persistence (`persistInboundOriginalEmail`, `:887`, MIME `message/rfc822`) is a **system artifact**, not a user upload — validate it with `validateSystemArtifact` (size-only, `packages/storage/src/config/storage.ts:116`) so a restrictive tenant allow-list never suppresses the raw-email copy.
- **Regression guard for audio specifically:** because the effective default is `*/*`, audio already passes. To make the guarantee explicit and independent of deployment env (so a tenant with a restrictive `STORAGE_LOCAL_ALLOWED_MIME_TYPES` still keeps voicemails), extend the default allow-list to always include the common audio types, or document that voicemail support requires `audio/*` in the tenant allow-list. Decision: add `audio/*` handling is a config concern; the code change keeps `*/*` default behavior and the test (workstream C) asserts a `.wav` lands under the default policy.
- **Also fix the two audio-dropping paths the brief cited**, for correctness parity:
  - `shared/workflow/runtime/actions/businessOperations/shared.ts` — replace the hand-rolled `ALLOWED_ATTACHMENT_MIME_TYPES` / `isAllowedAttachmentMimeType` (`:265`, `:274`) checks in `attachDocumentToTicket` (`:332`, `:363`) with `StorageService.validateFileUpload`, unifying with the same policy. (Minimal alternative if the storage import is undesirable here: add `audio/wav`, `audio/x-wav`, `audio/vnd.wave`, `audio/mpeg`, `audio/mp4`, `audio/ogg` to the set.)
  - Legacy Temporal `processEmailAttachment` (`emailWorkflowActions.ts:985`): see §4 (deliberately deferred, with rationale).

### B. Dropped attachments are visible on the ticket (requirement #3)

Today every skip/failure is written only to the `email_processed_attachments` ledger (`markProcessedAttachment`, `:353`) — invisible from the ticket. There is no ticket comment/trail for it.

**Change:** in `processInboundEmailArtifactsBestEffort` (`:996`), collect per-attachment skip/fail outcomes (each `persistInboundEmailAttachment` already returns `{ skipped, reason }` / `{ success:false, message }`), and after the attachment loop (after `:1150`), if any were skipped or failed, post **one internal system comment** on the ticket summarizing them (filename, declared type, reason). 

- Reuse the existing inbound comment helper `createCommentFromEmail` (`shared/workflow/actions/emailWorkflowActions.ts:1466`) with `author_type: 'system'` and `suppressTechEmailNotification: true`, OR add a thin internal-note helper on `TicketModel.createComment` with `is_internal: true` (note `createCommentFromEmail` currently hardcodes `is_internal: false` at `:1543`; a dedicated internal-note helper is cleaner than adding a flag to the email-comment helper). Decision: add a small `postInboundAttachmentTrailComment` helper alongside the inbound path that calls `TicketModel.createComment({ is_internal: true, author_type: 'system', ... })`.
- Content: BlockNote/markdown line per skipped file, e.g. `Attachment "voicemail.wav" (audio/wav, 4.2 MB) was not attached: attachment_type_not_allowed`. Keep it best-effort (wrapped in try/catch, `console.warn` on failure) so comment failure never fails ingestion — consistent with the surrounding best-effort contract (`:1143-1149`).
- Idempotency: the durable path can re-run the artifact worker; guard the trail comment so re-processing the same email does not post duplicates (key off `email_processed_attachments` terminal state, or a metadata marker on the comment).

### C. Tests (requirement #4)

- **Inbound integration test (IMAP/GreenMail):** using the `alga-inbound-email-testing` skill and the existing GreenMail harness (`e2e-tests/tests/inbound-email.spec.ts`), send an email with a `.wav` attachment through the IMAP provider, then assert (1) a `documents` row + `document_associations` to the ticket exists with `mime_type` audio and non-null `file_id`/`storage_path`, and (2) it is downloadable via the document view/download route (`/api/documents/view/<fileId>`). Cover both durable modes (`UNIFIED_INBOUND_EMAIL_DURABLE_MODE` `off` and `enforce`) if feasible, since they exercise the inline vs. artifact-worker branches.
- **Skip-visibility test:** with a restrictive `STORAGE_LOCAL_ALLOWED_MIME_TYPES` (e.g. `application/pdf`), send a `.wav`; assert the attachment is `skipped` in `email_processed_attachments` **and** an internal system comment naming the file + reason is on the ticket.
- **Unit tests:**
  - `processInboundEmailArtifacts` — a non-image, non-inline attachment (audio) is persisted under default policy; is skipped-with-reason under a restrictive policy; inline CID image dedup still holds (existing behavior preserved).
  - `businessOperations/shared.ts` — `attachDocumentToTicket` accepts audio types (or, if unified, calls the shared validator). Extend/adjust existing tests that assert the old allow-list.
- Grep/adjust existing tests referencing `ALLOWED_ATTACHMENT_MIME_TYPES` and `process_email_attachments_batch` (`ee/temporal-workflows/src/__tests__/...`, `shared/services/email/__tests__/...`).

---

## 3. Order of work

1. **Confirm live drop (blocking fact, XO/prod):** get the deployed commit + `email_processed_attachments` rows for Ryan's tenant. If it shows the legacy/older path, prioritize §4 accordingly. *(Does not block the hardening below; the code changes are correct regardless.)*
2. **Workstream A** — route inbound persistence through `StorageService.validateFileUpload` / `validateSystemArtifact`; unify size ceiling; unify or widen `businessOperations` allow-list. (Smallest, highest-value; makes audio explicitly first-class.)
3. **Workstream B** — collect skip/fail outcomes and post the internal system trail comment (idempotent, best-effort).
4. **Workstream C** — unit tests, then GreenMail integration test; run under both durable modes.
5. Manual smoke via `alga-inbound-email-testing` on the dev stack (port 3771 / `alga-psa-local-test`).
6. Customer reply to Ryan drafted for the "Prepare Human Review"/PR steps (owed on ship).

---

## 4. What we are deliberately NOT doing

- **Not rewriting `persistDocumentForBuffer`'s transaction** to route through `StorageService.uploadFile`. We reuse only the shared *validator*; the existing upload+`external_files`+`documents`+`document_associations` transaction (`:526-590`) already writes the same rows manual upload writes and is transactionally correct. Full consolidation onto one document-creation helper is a worthwhile `// LEVERAGE:` follow-up but is a larger refactor than this fix warrants.
- **Not fixing the legacy Temporal `processEmailAttachment` stub** (`emailWorkflowActions.ts:985`) in this card beyond noting it. It writes a bytes-less `documents` row and is not on the IMAP path. It is a real latent bug for any provider still routed through `INBOUND_EMAIL_RECEIVED` → Temporal; recommend a **separate card** to either repair it (download + store bytes via the shared helper) or delete it if the Temporal inbound path is fully superseded by the unified queue. Flag for XO.
- **Not changing IMAP fetch sizing/timeouts** (`INBOUND_EMAIL_SOURCE_FETCH_TIMEOUT_MS`, etc.) unless the prod fact in step 1 shows truncation is the live cause.
- **Not adding a new per-tenant DB-backed document policy.** The existing env-driven `validateFileUpload` is the current "tenant document upload policy"; we align to it rather than invent a parallel one.
- **Not touching inline CID image dedup semantics** — preserved as-is (`:728`, `:1062-1072`); tests assert no regression.

---

## 5. Risks

- **Tightening by unification:** switching inbound from "no MIME policy" to `validateFileUpload` means a deployment with a restrictive `STORAGE_LOCAL_ALLOWED_MIME_TYPES` would now skip types inbound used to store. This is the intended "agree with manual upload" behavior, but it is a behavior change — call it out in the PR and default remains `*/*` (allow-all). Mitigated by workstream B making any such skip visible on the ticket.
- **Size ceiling change:** inbound moves from a hard 100 MB to the storage config ceiling (default 500 MB). Larger voicemails than before will now be accepted; confirm storage/provider limits tolerate it.
- **Durable idempotency:** the artifact worker can re-run; the trail comment must be idempotent or it will duplicate. Guard as described in §2.B.
- **Best-effort contract:** the trail comment and validator calls must never throw out of the best-effort loop and abort ticket creation; wrap and log.
- **`.eml` original-email copy:** must use the system-artifact validator, not the user allow-list, or a restrictive tenant policy would suppress the raw-email archive (`persistInboundOriginalEmail`, `:887`).

---

## 6. Verification approach

- **Automated:** unit + GreenMail integration tests (§2.C), run under `UNIFIED_INBOUND_EMAIL_DURABLE_MODE` `off` and `enforce`.
- **Manual smoke (alga-inbound-email-testing):** on the wired dev stack (`alga-psa-local-test`, port 3771), send a voicemail-style email with a `.wav` via GreenMail/IMAP; confirm the ticket shows the attachment and it downloads; then set a restrictive allow-list and confirm the internal "skipped" system comment appears.
- **DB checks:** `email_processed_attachments` shows `processing_status='success'` with `file_id`/`document_id` for the `.wav`; `documents`/`external_files`/`document_associations` rows present and consistent.
- **Prod correlation (owed to XO):** the fact from step 1 either confirms the hardening resolves the live case or points to a build/rollout action instead.
