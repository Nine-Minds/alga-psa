# Gmail Pub/Sub inbound email: silent failures, base-URL drift, and trial setup burden

## Goal

Make a Gmail inbound provider incapable of reporting "connected" while no mail is arriving. Every step that can break push delivery — the topic IAM grant, the Gmail `watch()` registration, the OIDC audience the webhook verifies — must fail loudly, write its outcome to the provider row the card renders from, and be re-checkable on demand. Where the failure is a genuine configuration fault (no public endpoint, a base URL that cannot be reached), setup must refuse rather than fall back to an address that can never receive a push.

## Grounded constraints

- The downstream pipeline is fully shared. Microsoft, Google, and IMAP all converge on `enqueueUnifiedInboundEmailQueueJob` (`shared/services/email/unifiedInboundEmailQueue.ts:339`). Nothing in this card touches ingestion or ticket processing; the entire divergence is Google setup and push delivery. Do not add a Gmail-specific processing path.
- Gmail push delivery survives on one invariant: the audience Google signs its OIDC token with at provisioning time must be byte-identical to the audience the webhook route checks it against. A trailing slash, an uppercase host, an explicit `:443`, or a path prefix on one side turns every push into a 401 that no part of the product currently notices.
- Three independent base-URL derivations existed and disagreed: provisioning preferred `NEXT_PUBLIC_BASE_URL` first and fell back to `http://localhost:3000` (`configureGmailProvider.ts:14-17`); webhook verification preferred `NEXTAUTH_URL` first (`googleWebhookHandler.ts:185-186`); the action layer read through `getAppSecret` while the other two read `process.env` (`emailProviderActions.ts:191-203`). Any drift between them was invisible until no mail arrived.
- The provider card renders from the `email_providers` row, not from an action's return value. An outcome that is only returned and never persisted cannot be shown. Success/failure must be written to `email_providers.status` / `error_message`.
- Microsoft 365 already has the precedent this card should follow: a diagnostics action + dialog, and — structurally — a platform-credential fallback path (`providerReadiness.ts:60-102`). Google is always tenant-owned with no shared-app fallback, which is the root of the trial setup burden; the diagnostics precedent is adoptable now, the platform-app precedent is a larger follow-up (see Non-goals).
- Gmail watches expire after seven days and are renewed by an EE-Temporal-scheduled handler (`setupSchedules.ts:486`, `googleGmailWatchRenewalHandler.ts`). A CE/non-Temporal stack has no renewal path; that is a real gap but is scoped as follow-up, not silently assumed away.
- The tenant secret write path must not regress the standard Helm install. `server.replicaCount` defaults to 2 with `maxUnavailable: 0 / maxSurge: 1` and no anti-affinity; no `ReadWriteMany` StorageClass exists on these clusters. A shared single-attach PVC does not fix the durability problem — it reproduces it behind a volume that looks solved.

## Design

### 1. One base-URL / naming derivation, used by all three callers

Add `packages/integrations/src/utils/email/gmailPubSub.ts` as the single source of truth for the public address and Pub/Sub naming. It resolves the base URL from a fixed precedence — `NGROK_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXTAUTH_URL`, `PUBLIC_WEBHOOK_BASE_URL` — each read from `process.env` first and the app secret store second, so a value set either way resolves identically regardless of which caller asks.

`normalizeGmailBaseUrl` reduces the value to a canonical origin: lowercase scheme and host, no default port, no query, no fragment, **no path**. A path component is rejected, not preserved — provisioning appends the fixed `GOOGLE_WEBHOOK_PATH` while verification appends `request.nextUrl.pathname`, so a prefix carried on the base would be doubled on one side and dropped on the other, and the mismatch would surface only as a 401. Serving Alga under a path prefix is therefore explicitly unsupported for Gmail push, and setup says so.

Provisioning, verification, and diagnostics all build the push endpoint and the audience from this one function, so the two strings are equal by construction rather than by coincidence. Setup **refuses** a loopback, private-network, or plain-HTTP address instead of falling back to `http://localhost:3000`; `NGROK_URL` (written by the ngrok-sync container to `/app/ngrok/url`) remains the sanctioned local-development escape hatch.

Errors are typed and written to be read straight off the provider card: `GmailPubSubConfigurationError` for a base URL/name that cannot be derived, `GmailPubSubSetupError` for a provisioning step that failed against Google, each message naming the resource and the missing permission.

### 2. Nothing reports success it did not verify

- The publisher IAM grant for `gmail-api-push@system.gserviceaccount.com` (`setupPubSub.ts`) **throws** on failure, naming the topic and `roles/pubsub.publisher`, instead of warning and continuing.
- `setupPubSub` reads the subscription back after creating it and fails when the push endpoint or the OIDC audience does not match what it just provisioned.
- `registerWatch` already reported failure by return value; that value was being discarded. It is now read, and a failed or skipped `watch()` sets `success: false` with the underlying Google message attached (`configureGmailProvider.ts`).
- Every outcome — success or failure — is written to `email_providers.status` / `error_message`, because the card renders from the row.

### 3. Re-save honestly re-provisions; no fake cooldown

The 24-hour `pubsub_initialised_at` guard (`configureGmailProvider.ts:69-93`) that returned `pubsubConfigured` / `watchRegistered = true` without checking anything is removed. Every save and every "Refresh Pub/Sub & Watch" re-provisions and re-verifies. A user re-saving to fix a problem gets a real answer, not a cached "success" from the run that first broke.

### 4. A real health check: `runGmailDiagnostics`

Add `GmailDiagnosticsService` plus an action and a `GmailDiagnosticsDialog`, in the shape of the Microsoft 365 precedent. It checks, and prints expected-vs-actual where they differ: the base URL, the service-account key, the topic, the publisher binding, the subscription's push endpoint and audience, the watch and its expiry, and **when a push was last accepted**. That last signal comes from a new `google_email_provider_config.last_push_received_at` column, written by the webhook route after JWT verification — the only end-to-end proof that Google can actually reach the endpoint. Interfaces live in `shared/interfaces/gmail-diagnostics.interfaces.ts`.

### 5. Webhook route: fail loud on a configured-but-unusable base URL

The Google webhook handler no longer silently degrades to `request.nextUrl.origin` (the container-internal address, which can never match the signed audience) when a base URL is configured but unusable — it rejects with the configuration fault stated in the log. The distinct case of *no* base URL configured at all keeps the request-origin fallback, but with a warning that says plainly it only matches when Pub/Sub was provisioned against that same origin. The base is normalized to an origin here too, and a path component is rejected rather than preserved, so a prefix can reach the audience from exactly one source.

### 6. Tenant secret durability without a deadlocking default

`tenantSecrets.persistence` defaults **off**. `ReadWriteMany` is unavailable on these clusters (every StorageClass is node-local or single-attach block storage), and a node-local volume shared by two replicas reproduces the exact bug this card removes — a secret written by one replica unreadable by the other — now hidden behind a PVC. Multi-replica installs must write tenant secrets to Vault (`secrets_provider.writeProvider=vault`); the optional claim is for single-replica installs where the filesystem provider is genuinely the write path, and `sharedTenantSecrets` remains the appliance answer. The chart **fails to render** when `tenantSecrets.persistence.enabled` is combined with `replicaCount > 1`, rather than emitting manifests that deadlock at apply time on `FailedAttachVolume`. Default rendering is byte-identical to the pre-change chart (zero occurrences of `tenant-secrets` or `SECRET_FS_BASE_PATH`).

### 7. Document the GCP prerequisites

Add `docs/inbound-email/setup/gmail-google-cloud-prerequisites.md` and extend `docs/inbound-email/setup/gmail.md`: the GCP project, OAuth client, service-account key with topic IAM, the public HTTPS endpoint requirement, and the OAuth consent screen in Production (a Testing-mode consent screen kills the refresh token in 7 days). This is the burden IMAP avoids; documenting it is the near-term mitigation ahead of a platform Google app path.

## Behavioral tests

- `gmailPubSub.test.ts`: normalization (trailing slash, uppercase host, default-port `:443`, query/fragment stripped), rejection of loopback / private / plain-HTTP / path-carrying bases, and that a prefix arriving via the request path appears in the audience exactly once.
- `googleWebhookUnifiedQueue.integration.test.ts`: a verified push updates `last_push_received_at` and enqueues through the shared queue.
- `inboundAuthPauseReconnectSave.integration.test.ts`: re-save re-provisions rather than short-circuiting on the removed cooldown.
- Helm: `tenantSecrets.persistence.enabled + replicaCount > 1` fails to render; default render contains no tenant-secret artifacts.

## Non-goals (scoped as follow-up)

- **Platform / shared Google app path.** Google remains tenant-owned in this card. A hosted platform-credential path mirroring Microsoft's `providerReadiness.ts:60-102` — so a trial user need not bring their own GCP project — is the highest-leverage fix for trial failure but is a larger change; documenting the prerequisites (§7) is the interim answer.
- **CE-safe watch renewal.** The 7-day renewal remains EE-Temporal-scheduled. A CE/non-Temporal renewal path is a known gap; diagnostics (§4) at least surfaces an imminent/expired watch instead of letting it die silently.
- No change to the shared ingestion/ticket-processing pipeline.

## Review risks

- Base-URL precedence changes which env var wins for existing installs; the fixed order (`NGROK_URL` → `NEXT_PUBLIC_BASE_URL` → `NEXTAUTH_URL` → `PUBLIC_WEBHOOK_BASE_URL`) must match what current tenants have provisioned against, or a re-save will re-point the audience. The diagnostics expected-vs-actual print exists partly to make that visible.
- Turning warn-only steps into hard failures means installs that were "green but dead" will now show red on first save. That is the intended behavior, but it is a visible change for anyone who was silently broken.
