# Plan — Saving non-empty passwords throw error

Card: `383abfe2-cef5-41f5-b468-74b6ec9bf2b3` · Branch: `feature/saving-non-empty-passwords-throw-error`

## Root cause (confirmed in code)

The failure is in the **EE credentials vault** save path, not user login passwords.
`encryptCredentialValues()` short-circuits and returns `null` ciphertext when the
password is **empty** (so empty saves succeed), but on a **non-empty** password it calls
`getAesKey()`, which **throws** when neither `credential_encryption_key` (file secret) nor
`CREDENTIAL_ENCRYPTION_KEY` (env) is set — and there is a deliberate no-fallback to
`NEXTAUTH_SECRET`.

- `ee/server/src/lib/credentials/encryption.ts:199-201` — empty short-circuit; `:145-160` / `:216` — throw on missing key.
- `credentialActions.ts:281-294` catches it and maps to a generic `CONFIGURATION` failure.
- `CredentialFormDialog.tsx:128-136` surfaces it as a vague "configuration" message.

The key is **never provisioned by default**: it's commented out in `.env.example:17`,
absent from the `REQUIRED_SECRETS` list in `scripts/validate-secrets.sh:17-25`, and missing
from the local `secrets/` dir. So the vault is broken out-of-the-box in any environment
that didn't manually set it.

## Fix approach

Keep the security model (no NEXTAUTH fallback) — instead make the key a **first-class,
auto-provisioned secret** like `crypto_key`/`nextauth_secret`, and make the failure actionable.

1. **Provision the key** — add `credential_encryption_key` to secret generation/bootstrap
   (same path that generates `crypto_key` et al.), add it to `REQUIRED_SECRETS` in
   `validate-secrets.sh`, uncomment/document in `.env.example`, and add to helm/compose
   secret templates.
2. **Fail loud & early, not on save** — add a startup/health guard so a misconfigured vault
   is caught at boot, not on the user's first save.
3. **Actionable UI error** — distinguish "vault not configured" from other configuration
   errors so the admin knows the remedy (`CredentialFormDialog.tsx`).
4. **Tests** — unit test that `encryptCredentialValues` with a non-empty password succeeds
   when the key is provisioned; integration/smoke test for create + update credential
   round-trip (encrypt → store → decrypt).

## Files in scope

`encryption.ts`, `credentialActions.ts`, `CredentialFormDialog.tsx`,
`scripts/validate-secrets.sh`, secret-generation/bootstrap script, `.env.example`,
helm/compose secret templates.

## Open design question

Whether to **auto-generate** the key on first boot (safe for fresh envs; but a later key
rotation makes existing ciphertext undecryptable — needs a documented rotation/re-encryption
story) vs. **require explicit provisioning** with a hard startup failure.
Recommendation: auto-generate + persist as a managed secret, and document rotation as a
follow-up, since no ciphertext exists in affected (currently-broken) environments yet.

## Risk / scope note

EE-only (credentials vault). User password changes use `NEXTAUTH_SECRET` (provisioned) and
are unaffected.
