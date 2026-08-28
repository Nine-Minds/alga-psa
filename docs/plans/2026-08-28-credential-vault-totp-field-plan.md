# Credential vault: the two-factor setup key field

## Why this work

The credentials vault stores a TOTP seed next to a password. Revealing the
credential returns the password and the current 6-digit code together, so the
seed never has to reach a technician's phone. Alga is the authenticator.

The create/edit form never says that. It labels the field `TOTP secret`,
explains the encodings it accepts, and — once something valid is typed — renders
a QR code built from the field's contents. That QR has exactly one use: copying
the seed onto a phone, one entry per credential, per technician. It argues for
the model the feature was built to replace, and it is the largest element on the
field.

The result is that a technician cannot tell what the field is for, where to
obtain a value, or whether what they pasted works. Nothing verifies the seed at
entry; a wrong value is discovered later, by someone locked out.

Two supporting defects surfaced while scoping this and are fixed here because
they belong to the same field:

- A saved seed cannot be removed. On edit the input resets to empty, and empty
  means "leave unchanged" (`CredentialFormDialog.tsx`, `handleSubmit`). Nothing
  indicates whether a seed exists at all, though `CredentialSummary.hasOtp`
  already carries that fact and drives a list badge.
- `parseOtpAuthUri` keeps only the `secret` parameter. An `otpauth://` URI
  carrying `algorithm`, `digits`, or `period` is accepted, its parameters
  silently dropped, and `generateTotp` then produces permanently wrong codes
  against SHA-1 / 6 digits / 30s.

## What ships

1. Field copy that names the errand instead of the encoding.
2. A live rotating code under the field, the moment the key parses.
3. The QR preview removed.
4. Edit mode that states whether a key is saved and can remove it.
5. Unsupported `otpauth://` parameters rejected instead of silently dropped.
6. A shared TOTP core, so the browser and the server compute codes from one
   implementation.

## Out of scope

Per-user two-factor authentication for signing in to Alga
(`users.two_factor_secret`) is a separate card. `UserService.enable2FA` works but
is reachable only through `POST /api/v1/users/:id/2fa/enable`, which requires the
caller to supply both the secret and a valid code; nothing generates a secret or
renders a QR, and `packages/auth/src/lib/authenticator/authenticator.ts`
`QRCode()` is hardcoded to one name and always returns an empty string because it
reads the image from an async callback and returns before the callback runs. None
of that is touched here.

## Copy

All keys live under `credentials.` in `server/public/locales/<locale>/msp/credentials.json`.

### Changed

| Key | From | To |
|---|---|---|
| `form.otpSecret` | `TOTP secret` | `Two-factor setup key (optional)` |
| `form.otpSecretPlaceholder` | `base32 secret or otpauth:// URI` | `e.g. JBSW Y3DP EHPK 3PXP` |
| `form.otpSecretHelp` | `Paste a base32 secret or an otpauth:// URI. The secret is encrypted and only revealed on request.` | `On the client's system, start two-factor setup and pick the option to enter a key manually instead of scanning the QR code. Paste that key here.` |
| `form.otpInvalid` | `The TOTP secret is not valid base32.` | `That is not a valid setup key. Setup keys use only the letters A to Z and the digits 2 to 7.` |
| `table.totp` | `TOTP` | `2FA` |
| `table.totpOn` | `TOTP` | `2FA` |

### Added

| Key | Value |
|---|---|
| `form.otpLeadIn` | `If this system asks for a 6-digit code at sign-in, Alga can generate it.` |
| `form.otpPreviewHint` | `Enter this code on the client's system to finish setup.` |
| `form.otpUnsupportedParams` | `This link uses two-factor settings Alga does not support. Enter the setup key on its own instead.` |
| `form.otpSaved` | `A setup key is saved for this password.` |
| `form.otpRemove` | `Remove key` |
| `form.otpRemoved` | `The setup key will be removed when you save.` |

### Removed

| Key | Reason |
|---|---|
| `form.otpQrPreview` | The QR is gone. |
| `form.otpWhatSaving` | The live preview shows what the sentence described. |

### Renamed

The code chip is shared by the reveal row and the form, so its strings move out
of the reveal namespace. Update both call sites.

| From | To | Value |
|---|---|---|
| `reveal.otpExpires` | `otp.expires` | `Expires in {{seconds}}s` |
| `reveal.copyOtp` | `otp.copy` | `Copy code` |

`reveal.otp` (`One-time code`) is unused after the chip is extracted; delete it.

### Locales

Apply to `en` first, then `de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`. The `xx` and
`yy` pseudo-locales are generated: run `npm run test:i18n`, which regenerates
them via `scripts/generate-pseudo-locales.cjs` and then validates parity.

## Implementation

### 1. Shared TOTP core

New `ee/server/src/lib/credentials/totpCore.ts`, free of Node builtins so it
bundles for the browser. Move the pure parts of `totp.ts` here:

- `TOTP_PERIOD_SECONDS`, `TOTP_DIGITS`, `BASE32_ALPHABET`
- `base32Decode(input): Uint8Array`
- `parseOtpAuthUri(input)` returning `{ secret, algorithm, digits, period }`,
  reading the parameters it currently discards
- `counterFor(timestampMs): bigint` and `counterBytes(counter): Uint8Array`
- `dynamicTruncate(hash: Uint8Array): string`, zero-padded to `TOTP_DIGITS`
- `secondsRemaining(timestampMs): number`
- `validateOtpSeed(input): { ok: true; secret: string } | { ok: false; reason: 'invalid' | 'unsupportedParams' }`

`validateOtpSeed` returns `unsupportedParams` when a parsed URI carries an
`algorithm` other than SHA1, `digits` other than 6, or `period` other than 30.
This is the single validator for both sides.

`ee/server/src/lib/credentials/totp.ts` keeps `generateTotp` and
`normalizeOtpSecret`, now built on the core and supplying the HMAC from
`node:crypto`. `normalizeOtpSecret` throws on either failure reason, preserving
its fail-closed contract for `nativeSource.ts` and `huduSource.ts`. Re-export the
core's names so existing importers are unaffected.

New `ee/server/src/lib/credentials/totpBrowser.ts` exports
`generateTotpInBrowser(secret, timestampMs?): Promise<TotpResult>`, supplying the
HMAC from `crypto.subtle` (`importKey` with `{ name: 'HMAC', hash: 'SHA-1' }`,
then `sign`). It is async and requires a secure context, which localhost and
HTTPS both satisfy. No new dependency.

`CredentialFormDialog.tsx` drops its private `BASE32_REGEX` and the comment
explaining why it exists, and imports `validateOtpSeed` from the core.

### 2. Extract the code chip

Split `TotpCountdown.tsx` into presentation and refresh strategy, because the two
call sites refresh differently: the reveal row re-requests from the server, the
form recomputes locally.

New `ee/server/src/components/credentials/TotpCode.tsx` is presentational, with
props `{ code, secondsRemaining, isRefreshing?, onCopy?, idPrefix? }`. `idPrefix`
defaults to `credentials-totp`, preserving the existing `credentials-totp-countdown`,
`credentials-totp-code`, and `credentials-totp-copy` element ids that tests and
smoke selectors depend on.

`TotpCountdown.tsx` keeps its current behavior — tick down, re-request via
`revealCredential` at zero, never cache the value — and renders `TotpCode`.

### 3. Live preview in the form

In `CredentialFormDialog.tsx`, replace the QR effect with a preview effect:

- On seed change, run `validateOtpSeed`. On `ok`, compute the code with
  `generateTotpInBrowser` and store `{ code, secondsRemaining }`. On failure,
  clear the preview and show `form.otpInvalid` or `form.otpUnsupportedParams`
  inline under the field, rather than only on submit.
- Tick `secondsRemaining` down once per second; recompute at rollover. Cancel on
  unmount, on dialog close, and when the seed changes.
- Render `TotpCode` with `idPrefix="credential-form-otp"` plus
  `form.otpPreviewHint` above it, and a copy control.
- Remove the `qrcode/lib/browser` import and the `qrDataUrl` state. The `qrcode`
  package stays — other screens use it.

The preview never appears on edit unless a new key is typed. The stored seed is
deliberately not loaded into the dialog, so there is nothing to preview.

### 4. Edit mode: state and removal

`editing` is a `CredentialSummary` and already carries `hasOtp`.

- When editing a credential with `hasOtp` and an untouched input, render
  `form.otpSaved` and a `form.otpRemove` control.
- Add `otpCleared` state. `form.otpRemove` sets it true, and the field then shows
  `form.otpRemoved`. Typing a new key clears the flag.
- In `handleSubmit`, the seed resolves as: a typed value when present; otherwise
  `null` when `otpCleared`; otherwise `undefined` on edit and `null` on create.
  This preserves "empty means unchanged" while making removal expressible.
- Include `otpCleared` in the `snapshot` memo so removal marks the form dirty.

### 5. Badge

`CredentialsScreen.tsx` and `EntityCredentialsSection.tsx` render the `hasOtp`
badge from `table.totp` / `table.totpOn`. The string change alone covers this; no
component change beyond confirming both read the key.

## Tests

Extend `ee/server/src/__tests__/unit/credentials/totp.test.ts`:

- `validateOtpSeed` accepts a raw base32 seed and a default-parameter
  `otpauth://` URI.
- It returns `unsupportedParams` for `algorithm=SHA256`, `digits=8`, and
  `period=60`, individually.
- `normalizeOtpSecret` throws on each of those, so the write path stays
  fail-closed.
- Existing RFC 6238 vectors still pass through the refactored `generateTotp`.

New `ee/server/src/__tests__/unit/credentials/totpBrowser.test.ts`: the browser
path produces the same code as the server path for the RFC test vector at a
fixed timestamp. Run under an environment providing `crypto.subtle`.

Update `ee/server/src/__tests__/unit/credentials/credentialsScreen.component.test.tsx`:

- Remove the `qrcode/lib/browser` mock and the three assertions on
  `credential-form-otp-qr` (lines 576-581).
- Assert the preview appears with a valid seed and disappears when the seed
  becomes invalid.
- Assert the inline error for an unsupported-parameter URI.
- Assert that editing a credential with `hasOtp` shows the saved-key state, and
  that using the remove control submits `otpSecret: null` while an untouched
  field submits `undefined`.

## Verification

Round-trip on the dev stack, on both surfaces — Passwords (`/msp/credentials`)
and an entity's Documents & Passwords drawer:

1. Create a credential with a known seed. Confirm the preview ticks and its code
   matches an independent RFC 6238 implementation for the same seed.
2. Save, reveal, and confirm the revealed code matches the preview.
3. Edit: confirm the saved-key state renders, save untouched, reveal again, and
   confirm the code still works.
4. Edit: remove the key, save, and confirm the badge and the revealed code are
   both gone.
5. Paste an `otpauth://` URI with `digits=8` and confirm the inline error names
   the unsupported settings and blocks save.
6. Run `npm run test:i18n` and confirm parity across all locales.
