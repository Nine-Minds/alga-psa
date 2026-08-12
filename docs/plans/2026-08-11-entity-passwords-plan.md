# Entity Passwords (Credentials Vault)

**Branch:** `feature/entity-passwords`
**Date:** 2026-08-11
**Status:** Design complete; no product or test code implemented

## Outcome

An IT Glue / Hudu-style credentials vault: named passwords (username, password,
URL, notes, TOTP seed) owned by a client and attachable to entities — assets in
v1 — surfaced through a first-class global **Passwords** screen plus per-entity
tabs. One shared UI and source abstraction serves two storage backends with
full write-through: **native Alga storage** (ciphertext in Postgres, encrypted
via Vault Transit in hosted, AES-256-GCM elsewhere) and the existing **Hudu
integration** (create/edit/delete via the Hudu API, not just read).

Feature posture:

- **EE-only, Pro tier.** All server actions guard with
  `assertTierAccess(TIER_FEATURES.CREDENTIALS)` (new tier feature, minimum tier
  `pro`). CE builds get render-nothing stubs via the `@enterprise` alias, the
  same pattern as `HuduClientPasswordsTab`.
- **All new/changed UI is gated behind the `release-v1.5-feature` flag.** Flag
  off ⇒ no nav item, no tabs change, and the existing Hudu-only client
  Passwords tab keeps its current behavior exactly.
- **No client-portal exposure** in v1.

## Product decisions (settled in design session)

1. **Global screen + entity attachments.** A searchable tenant-wide Passwords
   screen (filter/group by client, by source), plus a Passwords section on
   entity detail screens. Entity set v1: **assets** (plus the owning-client
   surface). The association model is built polymorphic so later cards can add
   entity types by extending a CHECK constraint, as `document_associations`
   does.
2. **Client-owned.** Every credential has a required owning client. MSP-internal
   credentials are owned by the tenant's default company
   (`tenant_companies.is_default = TRUE` partial unique index — one per
   tenant). No nullable-owner escape hatch.
3. **Hudu is a full write-through backend**, not read-only federation. The
   shared abstraction exposes list/reveal/create/update/delete implemented by
   both the native store and the Hudu client.
4. **Vault Transit encryption from day one** in hosted EE; real AES-256-GCM
   fallback for CE/appliance deployments (appliance key delivered as a
   Kubernetes secret, resolved through the existing secret provider). Every row
   carries a scheme tag. **No plain/base64 scheme may ever exist for
   credentials** (the extension-secrets `inline/base64` fallback is explicitly
   not acceptable here).
5. **TOTP with live code generation.** Store the seed encrypted like the
   password; reveal shows a rolling 6-digit code with countdown. The raw seed is
   only exposed via an explicit separate action.
6. **Per-credential ACLs from v1, enforced by the authorization kernel**
   (`@alga-psa/authorization`), not a bespoke checker. Open-by-default to
   holders of `credential:read`; restricted credentials are **hidden entirely**
   (list, tabs, search) from non-granted users via kernel scope resolution.
   Grant subjects: **teams and individual users**.
7. **Reveal is a distinct RBAC action** (`credential:reveal`), so "can see it
   exists" and "can unmask the value" are separately grantable. Every reveal
   writes a **fail-closed** audit row (no audit row ⇒ no value returned),
   following `writeHuduPasswordRevealAudit`.
8. **Creation destination picker.** When Hudu is connected and the owning
   client is mapped to a Hudu company, the create dialog offers a destination
   choice (Alga native default / Hudu). Rows edit and delete in place at their
   source.

## Architecture

### Source abstraction

New EE module `ee/server/src/lib/credentials/`:

```ts
// contracts.ts
export type CredentialSourceKind = 'alga' | 'hudu';

/** Metadata-only projection; never carries value-bearing fields. */
export interface CredentialSummary {
  id: string;                    // native uuid, or 'hudu:{company_id}:{password_id}'
  source: CredentialSourceKind;
  clientId: string;              // Alga client_id (Hudu rows resolved via mapping)
  name: string;
  username: string | null;
  url: string | null;
  description: string | null;
  hasOtp: boolean;
  isRestricted: boolean;         // always false for hudu rows
  folderName: string | null;     // hudu display metadata only in v1
  externalUrl: string | null;    // open-in-Hudu deep link
  attachedAssetIds: string[];    // native only in v1
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CredentialRevealResult {
  state: 'ok' | 'no_access' | 'not_found' | 'error';
  password?: string;             // transient; never persisted or logged
  otpCode?: { code: string; secondsRemaining: number } | null;
}

export interface CredentialWriteInput {
  clientId: string;
  name: string;
  username?: string | null;
  password?: string | null;      // value-bearing; write-only
  otpSecret?: string | null;     // value-bearing; write-only
  url?: string | null;
  description?: string | null;
  assetIds?: string[];           // native only in v1
}

export interface CredentialSource {
  list(ctx, filter: { clientId?: string; assetId?: string; search?: string }): Promise<CredentialSummary[]>;
  reveal(ctx, id): Promise<CredentialRevealResult>;
  revealOtpSeed(ctx, id): Promise<CredentialRevealResult>;   // explicit seed export
  create(ctx, input: CredentialWriteInput): Promise<CredentialSummary>;
  update(ctx, id, input: Partial<CredentialWriteInput>): Promise<CredentialSummary>;
  remove(ctx, id): Promise<void>;
}
```

Two implementations:

- **`nativeSource.ts`** — Postgres-backed, kernel-authorized, envelope-encrypted.
- **`huduSource.ts`** — wraps the existing `HuduClient`
  (`ee/server/src/lib/integrations/hudu/huduClient.ts`), extending it with
  `POST/PUT/DELETE asset_passwords` (list/GET already exist). Company
  resolution reuses `companyMapping.ts` /
  `tenant_external_entity_mappings`. Hudu list payloads stay
  `HuduAssetPasswordSummary` (metadata-only) exactly as today; the existing
  refresh/cache behavior in `huduDataCore.ts` is reused. Writes invalidate that
  cache. TOTP codes for Hudu rows are computed server-side from the
  reveal-time `otp_secret` and the seed is discarded — same non-persistence
  contract as the current reveal path.

Server actions aggregate across sources (native always; Hudu when connected)
and return a single merged, source-tagged list.

### Native data model (migrations, `server/migrations/`)

All tables: composite PK including `tenant`, RLS
(`tenant = current_setting('app.current_tenant')`), Citus distribution by
`tenant`, following the most recent migration patterns (e.g. the document share
links migration).

**`credentials`**

| Column | Type | Notes |
|---|---|---|
| `tenant` | uuid | PK part |
| `credential_id` | uuid | PK part, `gen_random_uuid()` |
| `client_id` | uuid | NOT NULL, FK to clients (tenant-scoped) |
| `name` | text | NOT NULL |
| `username` | text | nullable |
| `url` | text | nullable |
| `description` | text | nullable |
| `password_ciphertext` | text | nullable (a row may be OTP-only) |
| `otp_secret_ciphertext` | text | nullable |
| `encryption_scheme` | text | NOT NULL, CHECK in `('vault-transit:v1','aes-256-gcm:v1')` |
| `is_restricted` | boolean | NOT NULL default false |
| `created_by` | uuid | NOT NULL |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `(tenant, client_id)`, `(tenant, name)` for search.

**`credential_associations`** — mirror of `document_associations`:
`(tenant, association_id, credential_id, entity_id, entity_type)` with
`entity_type` CHECK `('asset')` in v1 (deliberately extensible), unique on
`(tenant, credential_id, entity_id, entity_type)`.

**`credential_access_grants`** —
`(tenant, grant_id, credential_id, subject_type CHECK ('user','team'),
subject_id, created_by, created_at)`, unique on
`(tenant, credential_id, subject_type, subject_id)`.

**Permissions seed migration** — new RBAC resource `credential` with actions
`create`, `read`, `update`, `delete`, `reveal`, seeded to the standard admin /
technician role bundles the way `20250703193155_add_default_roles_and_permissions.cjs`
does (admins get all five; grant matrix for other roles decided in the
migration, defaulting to full for technicians, none for finance-only roles).

Value handling rule (matches the Hudu tab's standing contract): plaintext
password/OTP-seed values exist only (a) in the write path between request and
encryption, and (b) in a reveal response. They are never logged, never cached
server-side, never placed in list payloads, and live client-side only in
transient component state.

### Encryption (`ee/server/src/lib/credentials/encryption.ts`)

Envelope with per-row scheme tag:

- **`vault-transit:v1`** — encrypt/decrypt via Vault Transit, following
  `ee/server/src/lib/extensions/installConfig.ts` (`ALGA_VAULT_ADDR`/
  `VAULT_ADDR`, `ALGA_VAULT_TOKEN`/`VAULT_TOKEN`, `ALGA_VAULT_TRANSIT_MOUNT`,
  and a dedicated key name env `ALGA_VAULT_CREDENTIALS_TRANSIT_KEY`, default
  `alga-credentials`). Hosted values wiring: add the key name to
  `hosted.values.yaml` and create the transit key (ops step, documented in the
  plan's rollout section).
- **`aes-256-gcm:v1`** — AES-256-GCM with a key derived (SHA-256) from
  `getSecret('credential_encryption_key', 'CREDENTIAL_ENCRYPTION_KEY')`,
  ciphertext format `enc:{base64(iv(12) + authTag(16) + ciphertext)}` — the
  exact `CalendarProviderService` precedent. **No fallback to
  `NEXTAUTH_SECRET`**: if the key is absent and Vault Transit is not
  configured, credential writes fail with a clear operator error. On the
  appliance the key ships as a Kubernetes secret surfaced to the pod by the
  existing secret-provider plumbing; in CE docker it is a filesystem/env
  secret.

Write scheme selection: `vault-transit:v1` when transit is configured, else
`aes-256-gcm:v1`. Decrypt dispatches on the stored row tag, so mixed rows and
future re-encryption migrations are safe. Scheme roster is closed by the DB
CHECK; adding a scheme is an explicit migration.

### Authorization

- **RBAC stage:** all actions check the `credential` resource
  (`hasPermission`) and `assertTierAccess(TIER_FEATURES.CREDENTIALS)` inside a
  `withAuth` wrapper, structurally identical to
  `ee/server/src/lib/actions/integrations/huduDataActions.ts`.
- **Kernel (per-item ACLs):** a builtin authorization provider rule set for
  resource `credential`, registered the way documents build theirs
  (`createAuthorizationKernel` + builtin relationship rules +
  `resolveBundleNarrowingRulesForEvaluation`):
  - Record hydration maps grants to the standard `AuthorizationRecord` fields:
    user grants → `assignedUserIds`, team grants → `teamIds`; `ownerUserId` =
    `created_by`; `clientId` = owning client.
  - Unrestricted row ⇒ allowed (subject to RBAC + bundle narrowing).
  - Restricted row ⇒ allowed only via existing templates `own_or_assigned` or
    `same_team`. No new template keys are introduced.
  - List paths use `resolveScope` / scoped SQL so restricted rows are invisible
    (global screen, entity tabs, search, counts) rather than shown-but-locked.
- **Bundles:** nothing credential-specific to build — tenants can narrow with
  e.g. `credential read → selected_clients` through the existing EE bundle
  management UI.
- **Hudu rows:** governed by RBAC/tier/bundle scope only; per-item grants do
  not apply (Hudu has no enforceable equivalent). The UI's restrict action is
  disabled on Hudu-sourced rows with an explanatory tooltip.
- **Grant management:** `credential:update` (or admin) is required to edit a
  credential's grant list; the creator is implicitly covered as
  `ownerUserId` via the `own_or_assigned` template.

### Reveal + audit

Server action `revealCredential(id)`:

1. RBAC `credential:reveal` + tier + kernel item decision (fail ⇒ `no_access`).
2. Write audit row via `auditLog` inside a transaction with the
   `app.current_tenant` GUC set — operation `credential_reveal` (native) or the
   existing `hudu_password_reveal` (Hudu path keeps its current audit shape).
   Failure to audit ⇒ the action throws; value is never returned (fail-closed,
   exactly `revealAudit.ts`).
3. Decrypt (or live-GET Hudu) and return `{ password, otpCode }`.

TOTP: server computes the current RFC 6238 code (30s period, SHA-1, 6 digits —
standard defaults) and `secondsRemaining`; the client shows a countdown ring
and re-requests on expiry while the row stays revealed. Implementation: small
self-contained RFC 6238 util (HMAC via node `crypto`; base32 decode included)
with test vectors from the RFC — no new dependency. `revealOtpSeed` is a
separate action (same guards + its own audit `credential_otp_seed_reveal`) for
explicit seed export.

Create/update/delete also write audit rows (`credential_created`,
`credential_updated`, `credential_deleted`, `credential_grants_changed`) —
cheap, and MSPs expect a full audit trail on a vault. Audit `details` never
contain values.

### Server actions (EE, `ee/server/src/lib/actions/credentials/credentialActions.ts`)

- `listCredentials({ clientId?, assetId?, search?, sources? })` → merged
  `CredentialSummary[]`
- `getCredential(id)` → summary + grants + associations (metadata only)
- `createCredential(input & { destination: 'alga' | 'hudu' })`
- `updateCredential(id, input)`
- `deleteCredential(id)`
- `revealCredential(id)`, `revealCredentialOtpSeed(id)`
- `setCredentialRestriction(id, { isRestricted, grants })`
- `setCredentialAssociations(id, { assetIds })`
- `getCredentialsContext()` → `{ tierOk, huduConnected, flagIrrelevantHere }`
  cheap gate for UI visibility (pattern: `getHuduClientContext`)

CE stubs for the action barrel and components via the `@enterprise` alias so CE
bundles compile without EE code (existing `packages/ee/.../_stub.ts` /
CE-stub-component pattern).

### UI (all behind `release-v1.5-feature`)

New package area `packages/ee/src/components/credentials/` (CE stubs) with EE
implementations in `ee/server/src/components/credentials/`:

1. **Global Passwords screen** — `/msp/credentials`, nav item "Passwords"
   (nav entry rendered only when flag on AND EE AND tier OK, via
   `getCredentialsContext`). Table: name, username (click-copy), client,
   source badge (Alga/Hudu), attached assets, URL (open), TOTP indicator,
   restricted badge; inline Reveal/Hide/Copy per row (the Hudu tab's
   interaction model, generalized); filters: client, source, search.
2. **Create/edit dialog** — fields per the shared shape; destination selector
   (shown only when Hudu is available for the chosen client; default Alga);
   client picker (defaulting from context); asset attach picker (native only);
   password generator button (client-side, crypto.getRandomValues, length/charset
   options); TOTP seed field accepting base32 or `otpauth://` URI paste.
3. **Restrict dialog** — toggle + user/team grant picker (native rows only).
4. **Asset detail** — "Passwords" section listing native credentials attached
   to the asset, with create-preattached; rendered in the asset detail
   layout alongside the existing panels.
5. **Client detail** — the Passwords tab becomes the shared list scoped to the
   client (native + Hudu merged). **Flag off ⇒ the existing Hudu-only
   `HuduClientPasswordsTab` renders unchanged.** Flag on ⇒ the unified tab
   replaces it (Hudu rows keep reveal-proxy behavior inside the unified list).
6. **Reveal UX invariants** — revealed values live only in transient component
   state keyed by row id, cleared on hide/refresh/unmount; TOTP shows code +
   countdown, never the seed; every reveal round-trips the server (no
   client-side caching of values).

i18n: all strings through the standard translation layer
(`useTranslation('msp/credentials')` namespace), consistent with the current
i18n CI checks.

### Gating summary (three independent gates, all must pass for UI)

| Gate | Mechanism | Off behavior |
|---|---|---|
| Edition | `@enterprise` alias; CE stubs render null | Feature absent in CE |
| Tier | `assertTierAccess(TIER_FEATURES.CREDENTIALS)` server-side; `getCredentialsContext` for UI | Actions throw tier error; UI hidden |
| Release flag | `useFeatureFlag('release-v1.5-feature')` | Existing UI/behavior preserved (incl. Hudu-only client tab) |

New tier feature: add `CREDENTIALS` to `TIER_FEATURES` /
`FEATURE_MINIMUM_TIER` (`pro`) in `packages/types` tier constants.

## Testing

- **Unit:** envelope encryption round-trip both schemes + tamper/auth-tag
  failure + missing-key operator error; RFC 6238 vectors; base32/otpauth
  parsing; kernel builtin rules (unrestricted/user-grant/team-grant/denied,
  hidden-in-scope); Hudu id namespacing.
- **Integration (server, per `integration-testing` conventions):** action CRUD
  with RLS/tenant isolation; restricted rows invisible in list/search for
  non-granted users; reveal writes audit and fails closed when audit insert
  fails; tier gate rejects non-pro; permissions seed migration idempotency.
- **Hudu write-through:** client tests against a mocked Hudu API for
  create/update/delete + cache invalidation + error mapping
  (`no_password_access`, 404, 422), extending the existing hudu client tests.
- **Contract tests:** CE stubs render null / barrel exports match (pattern:
  existing `*.contract.test.ts`); flag-off preserves the legacy Hudu tab
  (wiring test like `ClientDetails.huduDocumentsSection.wiring.test.ts`).
- **Component tests:** reveal state clearing on hide/refresh/unmount; TOTP
  countdown re-request; destination picker visibility rules.

## Implementation order (for the Draft Implementation agent)

1. Migrations: `credentials`, `credential_associations`,
   `credential_access_grants`, permissions seed; tier feature constant.
2. Encryption module + TOTP util (+ unit tests).
3. Native source: model, kernel builtin rules + record hydration, actions
   (list/get/create/update/delete/reveal/restrict/associate) with audit
   (+ integration tests).
4. Hudu client write methods + `huduSource` (+ mocked-API tests).
5. Aggregating actions + `getCredentialsContext` + CE stubs (+ contract tests).
6. UI: global screen → create/edit dialog → restrict dialog → asset section →
   unified client tab, each flag-gated (+ component/wiring tests).
7. Helm/ops: transit key name in hosted values; `credential_encryption_key`
   documented for CE/appliance (K8s secret on appliance); rollout note to
   create the transit key before enabling the flag in hosted.

## Rollout / ops notes (step 7)

### Vault Transit (hosted EE)

- The credentials vault uses a **dedicated** transit key
  `ALGA_VAULT_CREDENTIALS_TRANSIT_KEY` (default `alga-credentials`), separate
  from the extension/installConfig transit usage so vault rows never share a
  key with arbitrary extension secrets.
- **Hosted values wiring:** add `ALGA_VAULT_CREDENTIALS_TRANSIT_KEY` to
  `hosted.values.yaml` (the value is only referenced by name; the key's
  material lives in Vault). Before enabling the `release-v1.5-feature` flag in
  hosted, create the transit key with key-derivation allowed:

  ```sh
  vault write -f transit/keys/alga-credentials \
    deletion_allowed=false \
    allow_plaintext_backup=false \
    derived=true
  ```

- The mount (`ALGA_VAULT_TRANSIT_MOUNT`, default `transit`), address
  (`ALGA_VAULT_ADDR`/`VAULT_ADDR`) and token (`ALGA_VAULT_TOKEN`/`VAULT_TOKEN`)
  follow the existing `installConfig.ts` precedent.
- Rows written while transit is configured are tagged `vault-transit:v1`.
  Decryption dispatches on the stored tag, so rows written before transit was
  wired (tagged `aes-256-gcm:v1`) keep decrypting.

### AES-256-GCM (CE / appliance / self-host)

- The AES fallback derives a 32-byte key (SHA-256) from
  `getSecret('credential_encryption_key', 'CREDENTIAL_ENCRYPTION_KEY')`.
  **There is deliberately no fallback to `NEXTAUTH_SECRET`.** If neither
  transit is configured nor this key is present, credential writes fail with a
  clear operator error (`credential_encryption_key` / `CREDENTIAL_ENCRYPTION_KEY`).
- **CE docker:** provide the key as a Docker secret file
  (`secrets/credential_encryption_key`) or env var `CREDENTIAL_ENCRYPTION_KEY`.
- **Appliance (K8s):** ship the key as a Kubernetes secret
  `credential_encryption_key` surfaced to the pod through the existing
  secret-provider plumbing (mounted as a file resolved by `getSecret`).

### Rollout order (hosted)

1. Apply the migrations (tables + permission seed).
2. Create the transit key in Vault (above) and add the env name to
   `hosted.values.yaml`.
3. Enable the `release-v1.5-feature` flag in PostHog.
4. The nav item / client tab / asset section appear automatically (EE + Pro
   tier + flag).

## Explicitly out of scope (future cards)

- Password folders (Hudu folder names shown as display metadata only) and
  folder-level ACLs.
- Client-portal exposure of credentials.
- Hudu → Alga import/migration tooling.
- Additional entity types beyond assets (constraint is extensible).
- Additional sources (IT Glue, etc.).
- Per-item ACL enforcement on Hudu-sourced rows.
- Asset-level linking of Hudu passwords (`passwordable_*` fields) — v1 Hudu
  writes are company-scoped.
- Re-encryption/key-rotation tooling (scheme tags make this a clean follow-up).
