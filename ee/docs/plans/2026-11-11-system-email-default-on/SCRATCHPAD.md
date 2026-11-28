# Scratchpad: system email default-on

Ticket: alga-2026-0002481

## Decisions

- (2026-11-11, Robert) `EMAIL_ENABLE` is reversed: it is only used to disable. It is not required to enable. Rejected alternative: just set `EMAIL_ENABLE=true` on the workflow worker.
- One resolver owns the decision; readers stop comparing the env var themselves.
- "Not disabled and no credentials" is a quiet null (unconfigured), not an error. Without this, the reversal would make `createSMTPProvider` throw "EMAIL_HOST is required" in every process that has no mail settings.

## Discoveries

- Failure path: `shared/workflow/runtime/actions/businessOperations/email.ts` (`email.send`) → `EmailProviderManager.initialize` → no enabled tenant provider → `initializeSystemFallbackProvider` → `SystemEmailProviderFactory.createProvider()` returns null → "No enabled email provider configured".
- Workflow v2 actions run in `services/workflow-worker`, not `temporal-worker`.
- Hosted `workflow-worker` deployment has no `EMAIL_*` / `RESEND_*` env. The app has the full set. `temporal-worker` has `RESEND_API_KEY` and `EMAIL_PROVIDER` but no `EMAIL_ENABLE`, so it gains the system fallback after this change.
- `ee/helm/workflow-worker/templates/deployment.yaml` renders `extraEnv` as plain name/value (around line 192). `ee/helm/temporal-worker/templates/deployment.yaml` (around 196) shows the `resendApiKeySecret` secretKeyRef pattern to copy.
- `nm-kube-config/workflow-worker/hosted.values.yaml` has a `resend:` block that no chart template reads.
- `EMAIL_ENABLE` readers in code: `packages/email/src/system/SystemEmailProviderFactory.ts` (lines 24, 47, 155), `server/src/lib/validation/emailConfigValidation.ts:11`, `server/src/lib/initializeApp.ts:117` (and 455, a config dump), `packages/auth/src/actions/useRegister.tsx:21,281`.
- Defaults: every `docker-compose*.yaml` uses `${EMAIL_ENABLE:-false}`; `server/entrypoint.sh` lists `EMAIL_ENABLE` as required and requires `EMAIL_FROM`/`EMAIL_PORT`/`EMAIL_USERNAME` when it is not `false`; `.env.example` says `EMAIL_ENABLE=false  # Required: Boolean`.
- Tests asserting the old gate: `server/src/test/unit/email/systemEmailProviderFactory.unit.test.ts` ("returns null when EMAIL_ENABLE is unset", "only for exact EMAIL_ENABLE=true"), `server/src/test/integration/email/passwordRecoveryEmailProvider.integration.test.ts`, `packages/billing/src/actions/invoiceCalendarDate.test.ts`.
- Comments referring to the old meaning: `packages/email/src/sendPasswordResetEmail.ts:111`, `packages/auth/src/actions/useRegister.tsx:183`.
- Docs mentioning the flag: `docs/getting-started/configuration_guide.md`, `setup_guide.md`, `setup_guide_windows.md`, `server/src/lib/email/README.md`.

## Commands

- `git grep -n "EMAIL_ENABLE\b" -- ':!*.md'`
- `helm template ee/helm/workflow-worker --set email.provider=resend --set email.from=noreply@example.com --set email.resendApiKeySecret.name=resend-credentials | grep -A4 -E "EMAIL_|RESEND_"`

## Follow-up outside this repo

- `nm-kube-config`: replace the unused `resend:` block in `workflow-worker/hosted.values.yaml` with the chart's new `email:` block, then redeploy the workflow worker.
