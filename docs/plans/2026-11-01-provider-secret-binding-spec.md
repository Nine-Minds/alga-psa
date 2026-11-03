# Spec — bind provider secrets to the endpoint identity they were entered for

Card: `757bcbf8-d428-571d-bddf-fe144284e41f` · finding from the security review of PR #4009
(merge `f958a142447b`, review card `bcf52eba`) · severity **high** · category **secrets**
PSA ticket `alga-2026-0003023`

## 1. The finding, at the mechanism

`getEmailSettings` deliberately returns the SMTP password (and API key) as the mask `***`
(`emailSettingsActions.ts:162-175`). On write, `mergeProviderSecrets:67-89` treats *any*
`***` in an incoming provider config as "unchanged" and copies the stored secret back **by
`providerId` alone** — no check that host, port, username, TLS flags or even `providerType`
are the same ones the secret was entered for. `updateEmailSettings` then persists that config
(`:194-202`, `:319-353`), and `testOutboundEmail` (`:407-421` →
`packages/email/src/TenantEmailService.ts:511-530`) initializes the saved provider and
performs SMTP verification.

So an admin who may edit email settings can:

1. change the SMTP host to `smtp.attacker.example`,
2. leave the password field as the mask,
3. have the old password silently carried over,
4. click "Test" and hand that password to the attacker's server — a password the admin never
   had to read, and in Microsoft/API-key configs a credential that is not even human-typed.

The mask is meant to mean *"the client never saw this value, so it did not change"*. The code
reads it as *"keep whatever was stored"*, which is true only while the endpoint the secret
belongs to is unchanged. Same root shape as any "sentinel means unchanged" bug: the sentinel
is a statement about a **whole** configuration, and it is being applied field-by-field.

## 2. Decision: the secret is bound to a fingerprint of its endpoint

### 2.1 One definition of "connection identity"

New module `packages/integrations/src/lib/providerConnectionIdentity.ts`:

```ts
/** Fields that define WHERE and AS WHOM a secret authenticates. Order-stable, secret-free. */
export const CONNECTION_IDENTITY_FIELDS: Record<ProviderType, readonly string[]>;
// smtp:    host, port, secure, ignoreTLS, requireTLS, username
// imap:    host, port, secure, username
// microsoft (and any OAuth type): inboundProviderId / providerId, tenantId, clientId
export function connectionFingerprint(config: Record<string, unknown>): string; // sha256 of canonical JSON
```

One place decides what "the same connection" means, so the merge path, the send path and any
future caller cannot disagree.

### 2.2 Merge-time rule (the primary fix)

`mergeProviderSecrets` becomes:

- A config only matches a stored provider when **`providerId` *and* `providerType`** match.
  (Today a config could claim another provider's id.)
- For each field in `SECRET_FIELDS`, the mask is honoured **iff**
  `connectionFingerprint(incoming) === connectionFingerprint(prior)`; then the stored value is
  carried and only the secret is carried.
- If the fingerprints differ and the incoming value is the mask → **return a validation error**
  (`msp/email-providers:errors.settings.secretRequiredAfterConnectionChange`: *"Re-enter the
  password for <provider>: the server address or sign-in details changed."*). Never carry a
  secret across an endpoint change, and never silently drop it.
- If the incoming value is the mask and no stored secret exists → the same error. Today that
  path `delete`s the field, i.e. silently clears a credential the user believed was kept.

Because the function returns an error instead of a config, `updateEmailSettings` must check it
**before** the transaction opens: no partial persistence, and the settings form receives a
message it can render per provider.

### 2.3 Send-time binding (defence in depth, and the general fix)

Writing the secret also writes its fingerprint alongside it in the provider config JSON
(`__secretFingerprint`, internal). `TenantEmailService` verifies, before initialising a saved
provider for send or test, that the *current* config still hashes to the stored fingerprint.
A mismatch means the connection was changed by a path that did not re-authenticate (a direct
DB edit, an import, a future action that forgets the rule) → refuse to send with a clear
error instead of presenting the old credential to the new host.

No schema migration: the fingerprint lives inside the existing provider-config JSON. It must
be stripped by the same sanitiser that masks `password`/`apiKey` in `getEmailSettings`, and
from any export/logging path.

Why both layers: the merge rule stops the normal path and lets the UI tell the admin what to
do; the fingerprint stops every *other* path, which is where this class of bug returns.

## 3. What we are deliberately NOT doing

- **Not removing the mask mechanism.** The form legitimately must round-trip a secret the
  browser never sees; the fix is to make the sentinel's meaning precise, not to start sending
  real secrets to the browser.
- **Not making the secret readable.** No "show password" affordance, no reversible storage, no
  change to at-rest encryption.
- **Not trusting "the host did not change" as reported by the client.** Identity is computed
  from the persisted config, not from a client-supplied "unchanged" flag.
- **Not touching Microsoft OAuth acquisition.** The finding's flow through
  `testOutboundEmail` is closed by the binding; token handling is out of scope here.
- **Not auditing/rotating already-leaked credentials.** If any config was changed under the
  old code, rotation is a human decision — the design surfaces the fingerprint mismatch so
  those configs fail loudly, and that list is worth reporting in the PR body.

## 4. Tests

1. **The finding.** Stored SMTP config with password `***` round-trip; submit the same
   `providerId` with `host` changed and `password: '***'` → validation error; the stored
   settings row is **unchanged** (assert the persisted JSON equals the pre-call value);
   `testOutboundEmail` on the untouched config never contacts the new host.
2. **Unchanged config still saves.** Mask + identical connection fields + a change to an
   unrelated setting (e.g. `from`, `maxDailyEmails`) → saves, secret preserved (no
   over-blocking; this is the common path and must stay frictionless).
3. **Any identity field counts.** Parameterised over port, secure, username, and
   `providerType` → each alone rejects a masked secret.
4. **Mask with no stored secret** → the same validation error, not a silent field deletion.
5. **Cross-provider id reuse.** Incoming `providerId` equal to a stored provider of a
   *different* `providerType` → treated as a new provider, no secret carried.
6. **Re-entry works.** Host changed **and** a real password supplied → accepted, saved, and a
   new fingerprint written.
7. **Send-time binding.** Persist a config, then mutate `host` directly in the DB → send and
   test both refuse with the "credentials no longer match this server" error, and no SMTP
   connection is attempted (socket never opened; assert with a stub).
8. **Sanitiser.** `getEmailSettings` never returns `__secretFingerprint`, `password` or
   `apiKey` in clear (regression pin on the existing masking test).

## 5. Risks

- **Admins blocked by an error they do not understand.** The message names the provider and
  the reason; the settings form should mark the password field as required when the host/port/
  username inputs are dirty. A smoke walk of "change host on a saved SMTP provider" is part of
  acceptance.
- **Microsoft/OAuth configs whose identity fields are not connection-ish.** The table decides
  per `providerType`; OAuth types key on the linked provider id and tenant, not on the masking
  path — test 3 covers the parameterisation so an OAuth config cannot be broken by an SMTP
  rule.
- **Existing configs have no fingerprint.** Absent `__secretFingerprint` is treated as
  "written before binding" — the merge rule still applies, and the send check passes only if
  the config's identity has not changed since this card's release. Backfill is not attempted;
  the first successful save writes a fingerprint.
- **A stored secret that is now wrong fails loudly at send.** That is intended; the error says
  to re-enter it, which is exactly the human action that repairs it.

## 6. Order of work

1. `providerConnectionIdentity.ts` (fields table + canonical fingerprint).
2. Merge rule returning a typed error; `updateEmailSettings` surfaces it before the txn.
3. Fingerprint written on secret write; stripped by the sanitiser.
4. `TenantEmailService` send/test verification using the same helper.
5. Tests 1–8; PR body quotes the four-step exploit above and states the two layers.
