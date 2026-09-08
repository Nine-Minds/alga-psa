# Portable customer credential vault

The portable vault primitive in `ee/server/src/lib/credentials/portable.ts` transfers native customer passwords and OTP seeds between installations. It decrypts source values through the existing credential encryption dispatcher and encrypts the portable representation with a customer-held passphrase. Restore encrypts verified values using the destination installation's configured AES key or Vault Transit key. It needs no source installation key.

This primitive does not authorize an export or restore. It is not yet a customer-facing export endpoint. The enclosing workspace export must select authorized customer-owned records, write credential reveal audits, retain metadata and associations, and recheck customer authority before releasing an archive. The restore coordinator must validate the manifest, map identities and permissions, and insert records atomically into an isolated destination. Never pass a passphrase or decrypted values through workflow history, persistent job arguments, logs, or analytics.

## Version 1 envelope

The JSON envelope contains exactly these generated fields:

| Field | Value |
| --- | --- |
| `format` | `alga-credential-vault:scrypt-aes-256-gcm:v1` |
| `packageId` | Enclosing export package UUID |
| `sourceTenant` | Source workspace UUID |
| `salt` | Standard padded Base64 of 16 random bytes |
| `iv` | Standard padded Base64 of 12 random bytes |
| `tag` | Standard padded Base64 of the 16-byte GCM authentication tag |
| `ciphertext` | Standard padded Base64 of the encrypted UTF-8 JSON payload |

Derive a 32-byte key with scrypt, using the exact UTF-8 passphrase bytes, the decoded salt, `N = 131072`, `r = 8`, and `p = 1`. Parameters are fixed by the format version and cannot be supplied by the package. Passphrases must contain 16–1024 UTF-8 bytes; they are not trimmed or normalized. Node uses the asynchronous API with a 256 MiB memory ceiling. These operations use the standard [Node crypto APIs](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

Encrypt with AES-256-GCM. Additional authenticated data is the UTF-8 encoding of the compact JSON array `[format, packageId, sourceTenant]`, in that order. UUID spelling is retained exactly. The payload is a JSON array of `{ credentialId, password, otpSecret }`; the two value fields are strings or null. Each credential UUID occurs once. Metadata, ACLs, associations and author identities live in the enclosing workspace manifest, not the encrypted secret payload.

Version 1 limits a vault payload to 32 MiB and 100,000 records. Oversize exports fail explicitly. Ciphertext and fixed-size components require canonical Base64. Restore authenticates the complete payload before parsing it or calling destination encryption. It then requires exact membership with the manifest's expected credential IDs, rejecting missing, duplicate or substituted records. A copied envelope with changed workspace or package identifiers fails authentication.

Derived keys and temporary plaintext buffers are cleared after use, including failure paths. JavaScript strings cannot be reliably erased; plaintext must remain confined to this operation. Provider failures return a value-free error and no partially restored result. The primitive does not export source keys, platform credentials, sessions, or live MSP trust.

## Focused validation

From `server/`, run:

```sh
npm exec -- vitest run src/test/unit/product/coManagedPortableVault.test.ts
```

The suite uses actual scrypt/AES operations and the existing installation encryption dispatcher. It covers an AES source key being replaced before restore, password/OTP recovery under the new key, destination Transit dispatch, authentication and manifest failures before destination calls, and source/destination provider failure. Transit requests are simulated; a full isolated database restore is separate work.
