# Scratchpad — Email Attachments → Ticket Documents

## Summary (Implemented)

- Implemented a workflow-worker override for `process_email_attachment` that:
  - Enforces eligibility rules: skip inline/CID, max 100MB, require filename, allow all file types.
  - Downloads attachment bytes from provider (Microsoft Graph or Gmail).
  - Uploads bytes via `StorageProviderFactory` and creates `external_files`, `documents`, and `document_associations` rows.
  - Attributes `uploaded_by_id`, `created_by`, `user_id` to the configured inbound email “system user” (`inbound_ticket_defaults.entered_by`).
  - Uses strict idempotency via `email_processed_attachments` (stable PK: `{tenant, provider_id, email_id, attachment_id}`) with status + error recording.
  - Treats unsupported Microsoft attachment shapes as `skipped` (not a workflow failure).

- Citus compatibility:
  - Added tenant predicates to `UPDATE email_providers ...` in webhook routes to avoid scatter/gather updates and RLS issues.
  - Added a Citus distribution migration for `email_processed_attachments` (distributed by `tenant`, colocated with `tenants`).

## Key Files

- Worker action override: `services/workflow-worker/src/actions/registerEmailAttachmentActions.ts`
- Worker wiring: `services/workflow-worker/src/index.ts`
- Schema:
  - `server/migrations/20260111121500_create_email_processed_attachments.cjs`
  - `ee/server/migrations/citus/20260111123000_distribute_email_processed_attachments.cjs`
- Provider downloads:
  - Microsoft: `shared/services/email/providers/MicrosoftGraphAdapter.ts` (`downloadAttachmentBytes`, `isInline`)
  - Gmail: `server/src/services/email/providers/GmailAdapter.ts` (`downloadAttachmentBytes`, `isInline`/`contentId` parsing)
- Citus webhook fixes:
  - `server/src/app/api/email/webhooks/microsoft/route.ts`
  - `server/src/app/api/email/webhooks/google/route.ts`

## Test Coverage

- Vitest integration tests (business logic + DB assertions):
  - `server/src/test/integration/emailAttachmentIngestion.integration.test.ts`
  - `server/src/test/integration/systemEmailProcessingWorkflowAttachments.integration.test.ts`
  - `server/src/test/integration/citusTenantFilterEmailProviders.integration.test.ts`

- Playwright UI verification (documents visible on ticket):
  - `ee/server/src/__tests__/integration/email-attachments-to-ticket-documents.playwright.test.ts`

## Playwright Notes ($playwright-testing)

- Cookie naming: the app suffixes the dev session cookie by port (`authjs.session-token.<port>`). Updated Playwright auth helpers to mint cookies using the suffixed cookie name/salt so sessions work on non-3000 ports.
- Secret providers: Playwright runs force secret provider read/write to `env` (avoid developer filesystem secrets clobbering test DB creds).

## Isolated Local Test Env Notes ($alga-test-env-setup)

- For side-by-side worktrees/environments, use the `alga-test-env-setup` scripts to generate unique ports + secrets and avoid collisions:
  - Port detection: `~/.claude/skills/alga-test-env-setup/scripts/detect_ports.py --env-num <N> --json`
  - Secrets generation: `~/.claude/skills/alga-test-env-setup/scripts/generate_secrets.py --secrets-dir <worktree>/secrets`
  - Then wire `server/.env` using the detected ports (unified port model: internal + exposed ports match).
