# Refine Password Vault creation UX & save diagnostics — implementation plan

Card: `1818c609-e1f6-49b0-8cf5-dd1238e0861d`
Branch: `feature/refine-password-vault-creation-ux-and-save-diagn`
Scope: EE credentials vault create/edit experience. Seven acceptance criteria (AC1–AC7).

Defaults chosen where the brief left room are marked **[default]** so they are easy to override in review.

---

## Current state (as read)

- `ee/server/src/components/credentials/CredentialFormDialog.tsx` — create/edit form. Uses a **native `<select>`** for client (AC1), gates the Hudu destination per-client via `getHuduClientContext` (connected && mapped) which is already correct, a length+symbols-only generator (AC4), a plain TOTP input with one help line (AC5), and a **`catch { setError(createFailed) }`** that flattens every failure to one generic string (AC6). Close is a single `onClose` prop with no dirty guard (AC3). `context: CredentialsContext | null` is already passed in but unused.
- `ee/server/src/components/credentials/CredentialsScreen.tsx` — list + the two overlay/inline mount points for the form. Owns `handleFormSubmit`, which calls `createCredential`/`updateCredential` and **re-throws to the dialog**. Source filter always renders a `Hudu` `<option>` regardless of connection (AC2). Client filter is its own native `<select>`.
- `ee/server/src/lib/actions/credentials/credentialActions.ts` — `createCredential`/`updateCredential` delegate to `nativeSource`/`huduSource` and **emit no structured failure log** (AC6). Sources already throw coded errors: `CREDENTIAL_CLIENT_MISMATCH`, `HUDU_UNMAPPED`, `CREDENTIAL_NOT_FOUND`. `getCredentialsContext` already returns `huduConnected` (`is_active`).
- `ee/server/src/components/credentials/EntityCredentialsSection.tsx` — bento tile + manager dialog hosting the entity-scoped screen; the inline create/back path lives in `CredentialsScreen` (`entityView` swap) (AC3 inline case).
- Dialog shell (`packages/ui/src/components/Dialog.tsx`): backdrop click, Escape, and X **all call the single `onClose` prop** — so one guard on the `onClose` we pass covers all four discard paths.
- `packages/ui/src/components/ClientPicker.tsx` — standard searchable picker. Props: `clients`, `selectedClientId`, `onSelect(id|null)`, `placeholder`, `id`, `fitContent`. (AC1)
- `qrcode@^1.5.4` present in root + `server` package (AC5). `qrcode.toDataURL` is browser-safe.
- Reveal path already models the "coded error → localized key" pattern (`REVEAL_ERROR_KEY` in `useCredentialsList.ts`) — reuse it for save errors (AC6).
- Test infra: `ee/server/src/__tests__/unit/credentials/credentialsScreen.component.test.tsx` (jsdom + testing-library, server actions mocked via `vi.hoisted`) is the model for AC7 behavioral tests.

---

## AC1 — ClientPicker replaces the native client `<select>`

**File:** `CredentialFormDialog.tsx`

- Replace the `<select id="credential-form-client">` block (only rendered when `!defaultClientId`) with `ClientPicker`:
  - `clients={clients}`, `selectedClientId={clientId || null}`, `onSelect={(id) => setClientId(id ?? '')}`, `placeholder={t('credentials.form.selectClient')}`, `id="credential-form-client"`.
- **Preselected behavior preserved:** the `!defaultClientId` guard stays — client/entity-scoped surfaces pass `defaultClientId` and the picker is not rendered (client is fixed, as today). Only the tenant-wide global create shows the picker.
- Keep the existing self-fetch of `clients` (already present) as the picker's source; ClientPicker also self-fetches if `clients` is empty — pass what we have.
- **[default]** Leave the `CredentialsScreen` list *client filter* `<select>` as-is for AC1 (the acceptance criterion names only the form). Note it as a consistency follow-up; not required by scope.

## AC2 — Hide Hudu unless the integration is active

- **Source filter (`CredentialsScreen.tsx`):** gate the `<option value="hudu">` on `context?.huduConnected === true`. When Hudu is off, the option is absent and any stale `sourceFilter === 'hudu'` falls back to `'all'` on load. `context.huduConnected` already reflects `is_active`.
- **Destination (`CredentialFormDialog.tsx`):** current per-client `getHuduClientContext` gate (`connected && mapped`) already satisfies "client-specific Hudu writes remain available only for mapped clients." Keep it. Add a cheap short-circuit: skip the `getHuduClientContext` probe entirely when `context?.huduConnected !== true` (no tenant integration ⇒ never offer Hudu, avoids a pointless round-trip).
- **Server-side validation retained:** `huduSource` still throws `HUDU_UNMAPPED`; no server change here.

## AC3 — Dirty tracking + discard confirmation

**Files:** `CredentialFormDialog.tsx` (overlay + inline), `CredentialsScreen.tsx` (entity back path).

- Capture an `initialSnapshot` of the editable fields when the form (re)initializes (the existing `useEffect` on open/editing already computes these values — snapshot there).
- `isDirty` = shallow compare current field state vs snapshot (name, username, password, otpSecret, url, description, clientId, destination, and generator-produced password). Untouched edit forms (password/otp intentionally blank) are **not** dirty.
- Introduce `requestClose()`:
  - if `!isDirty` → `onClose()` directly (untouched forms close normally);
  - else → open an in-form `ConfirmationDialog` (unsaved-changes) with Discard / Keep editing. Discard → `onClose()`.
- Route **all** close paths through `requestClose`:
  - Overlay: pass `onClose={requestClose}` to `Dialog` — this covers backdrop, Escape, and X in one place (verified: shell wires all three to `onClose`).
  - Inline: the inline Cancel button calls `requestClose`.
  - Entity inline back/cancel (`CredentialsScreen` `entityView` → the `credentials-screen-back` arrow and the inline form's Cancel): the form's `onClose` there is `() => setEntityView('list')`. Wrap so the dialog's `requestClose` guards the swap-back too — pass a guard-aware `onClose` and have the back-arrow call the same guard. **[default]** implement by lifting the dirty state into a small shared confirm: simplest is the form owns the confirm and its `onClose` prop is only invoked after the guard passes; the back-arrow triggers the form's `requestClose` via a ref/callback. Chosen approach: the inline form exposes its `requestClose` through an `onRequestClose` callback the screen wires to the back-arrow.
- New locale keys: `credentials.form.discardTitle`, `credentials.form.discardMessage`, `credentials.form.discardConfirm`, `credentials.form.keepEditing`.

## AC4 — Password reveal/hide + expanded generation with set coverage

**File:** `CredentialFormDialog.tsx`

- **Reveal/hide:** add an eye/eye-off toggle button inside the password field row; toggles the `Input type` between `password` and `text`. Add a copy button on the field that copies the current field value via `navigator.clipboard` (client-only). Reset to hidden on open/close. Plaintext stays in React state only — **no console.log, no analytics, no persistence.**
- **Expanded generator:** replace the length+symbols control set with explicit character-set checkboxes:
  - Uppercase `A–Z`, Lowercase `a–z`, Digits `0–9`, Symbols `!@#$%…`. **[default]** all four on by default; length default **20** (range 8–64).
  - **Enforce ≥1 set selected** (disable Generate + inline hint when none).
  - **Selected-set coverage:** generate so the result contains ≥1 char from every selected set. Implementation: place one guaranteed char per selected set, fill the remainder from the union, then Fisher–Yates shuffle using `crypto.getRandomValues`. (Avoids modulo-bias-free rejection only where needed; guaranteed inclusion is deterministic.)
- New locale keys: `passwordShow`, `passwordHide`, `passwordCopy`, `passwordCopied`, generator set labels (`genUppercase`/`genLowercase`/`genDigits`/`genSymbols`), `genNoSetSelected`.

## AC5 — Self-documenting TOTP with local QR preview

**File:** `CredentialFormDialog.tsx`

- **Explain input:** expand help copy to state (a) accepted formats — base32 seed **or** full `otpauth://totp/...` URI, (b) what saving enables — "a rotating 6-digit code is generated and shown when you reveal this password," (c) that the secret is encrypted at rest and only revealed on request.
- **Local QR preview:** when a valid `otpauth://` URI can be *formed*, render a QR image:
  - If the input is already an `otpauth://totp/...` URI → use it directly.
  - If the input is a bare base32 seed → synthesize `otpauth://totp/{label}?secret={seed}&issuer={issuer}` where label/issuer come from the form (**[default]** issuer = credential `name`, account label = `username` when present else `name`).
  - Render with `qrcode.toDataURL(uri)` into component state; show an `<img>` preview beneath the field. Regenerate on debounce as the seed changes; clear when the seed is empty/invalid.
- **Security:** the otpauth URI and the QR data URL are **never logged or persisted** — component state only, cleared on close/unmount. Reuse the existing client-safe `isValidOtpSeed` for the validity gate.
- New locale keys: `credentials.form.otpWhatSaving`, `otpQrPreview`, `otpQrHelp`, richer `otpSecretHelp`.

## AC6 — Safe, actionable save errors + structured server logging

**Files:** `credentialActions.ts` (server), `CredentialsScreen.tsx` + `CredentialFormDialog.tsx` (client), locale.

**Server (structured logging + safe coded errors):**
- Add a helper `raiseSafeCredentialError(operation, error, { tenant, userId, clientId, credentialId })`:
  - Classifies the caught error into a **safe category/code** from a closed set:
    `PERMISSION_DENIED` (Forbidden / tier), `CLIENT_MISMATCH` (`CREDENTIAL_CLIENT_MISMATCH`), `HUDU_UNMAPPED`, `HUDU_API` (Hudu transport/upstream), `VALIDATION` (bad seed/shape), `NOT_FOUND` (`CREDENTIAL_NOT_FOUND`), `UNKNOWN` (default).
  - `logger.error('[CredentialActions] <operation> failed', { operation, code, category, tenant, userId, clientId, credentialId })` — **no secret values, tokens, stack traces, or raw upstream payloads** in the logged fields (log `error.message` only for `UNKNOWN`, and only the message string, never upstream response bodies).
  - Throws `Object.assign(new Error(code), { code })` — the safe code is the only thing that crosses the server-action boundary (Next serializes `message`).
- Wrap `createCredential` and `updateCredential` bodies in try/catch calling the helper. (Reveal actions already log; leave them.)

**Client (map code → actionable message, stop flattening):**
- In `CredentialFormDialog.handleSubmit`, replace the blanket `catch { setError(createFailed) }` with a `SAVE_ERROR_KEY` lookup (mirror of `REVEAL_ERROR_KEY`): map `error.message` code → localized key; unknown/missing code → generic `createFailed`/`updateFailed`. Show the specific message; keep `onError?.()`.
- `CredentialsScreen.handleFormSubmit` already re-throws — keep it (the coded error propagates to the dialog). Verify no intermediate `.catch` swallows the code.
- New locale keys under `credentials.form.errors.*`: `permissionDenied`, `clientMismatch`, `huduUnmapped`, `huduApi`, `validation`, `notFound` (+ existing `createFailed`/`updateFailed` as fallbacks). Copy is actionable and secret-free (e.g. huduUnmapped → "This client isn't mapped to a Hudu company. Map it in Integrations or choose the Alga vault.").

## AC7 — Behavioral coverage (no source-string contract tests)

Extend `ee/server/src/__tests__/unit/credentials/credentialsScreen.component.test.tsx` and add focused files. Cover **user-visible flows**, mocking server actions:
1. **AC1** create dialog renders `ClientPicker` (not a native select) when no `defaultClientId`; hidden when `defaultClientId` set.
2. **AC2** source filter has no Hudu option when `context.huduConnected === false`; present when `true`. Destination picker not offered when Hudu disconnected.
3. **AC3** editing a field then triggering close (X/Escape/backdrop/Cancel) opens the discard confirm; untouched close does not; Discard closes, Keep editing stays. Inline entity back path guarded too.
4. **AC4** eye toggle flips masking; generator with all sets off disables Generate; a generated password contains ≥1 char from each selected set; generated plaintext never passed to any logger mock.
5. **AC5** entering an otpauth URI (and a bare seed) renders a QR `<img>`; invalid/empty clears it; QR data URL not passed to logger mocks.
6. **AC6** a `createCredential` mock rejecting with `code: 'HUDU_UNMAPPED'` surfaces the specific mapped message, not generic Create Failed; unknown code → generic fallback. A server-side unit test asserts `createCredential`/`updateCredential` failures call `logger.error` with `{ operation, code }` and **no secret fields**.

Explicitly **not** adding source-string/contract tests that assert a source enum literal.

---

## Sequencing

1. Server: safe error helper + structured logging + coded throws in `createCredential`/`updateCredential` (AC6 server half) — unblocks client mapping.
2. Client dialog: ClientPicker (AC1), Hudu gating (AC2), error mapping (AC6 client half).
3. Dialog UX: dirty guard (AC3), password reveal/generator (AC4), TOTP docs + QR (AC5).
4. Screen: source-filter Hudu gate (AC2), entity inline back guard (AC3).
5. Locale keys across all `server/public/locales/*/msp/credentials.json` (en authored; others get the same keys — follow repo i18n convention, validate with `scripts/validate-translations.cjs`).
6. Tests (AC7).

## Risks / notes
- **i18n:** every new key must land in all locale files or `validate-translations.cjs` fails; add to `en` first, mirror to the rest.
- **`qrcode` in the browser bundle:** import `qrcode/lib/browser` or the package's browser entry to avoid pulling node builtins into the client chunk (mirror how `isValidOtpSeed` deliberately avoids `node:crypto`). Verify bundle at build.
- **Error boundary fidelity:** confirm no wrapper between the server action and the dialog re-wraps the thrown Error and drops `.message`; the code travels as `error.message`.
- **CE parity:** check for a CE stub of these components (contract test `credentialsCeStubs.contract.test.ts`) and keep prop shapes compatible if a stub exists.
- **Security invariants:** generated plaintext, TOTP seed, otpauth URI, and QR data URL are state-only — no logging, caching, or persistence; audited in AC7 tests.
