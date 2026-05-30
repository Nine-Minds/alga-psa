# License Key Management

Internal reference for the Nine Minds team. Not for public distribution.

## Key architecture

Appliance licenses are compact ES256-signed JWTs. The JWT header carries a `kid`
(key id) that the appliance uses to select which public key to verify against.
Public keys are baked into the EE build (`packages/licensing/src/lib/license-keys.ts`).
Private keys are held exclusively by Nine Minds and are never committed to this repo.

## Issuing a license

1. Load the current private key from secure storage (1Password vault → "Alga License Signing Key v1").
2. Run the signing CLI:

```bash
ALGA_LICENSE_PRIVATE_KEY_FILE=/path/to/v1.private.pem \
ALGA_LICENSE_KID=v1 \
node ee/tools/alga-license/sign.mjs sign \
  --customer "Acme Corp" \
  --tier premium \
  --months 12 \
  [--seats 50]
```

3. The token is printed to stdout. Send it to the customer securely.
4. For renewals, issue a new token with the new expiry — the customer pastes it
   into the in-app License page, which stores it and takes effect immediately.

## Rotating keys

1. Generate a new keypair:
```bash
node ee/tools/alga-license/sign.mjs gen-keypair > /tmp/new-keys.json
```
2. Extract the public key from `/tmp/new-keys.json` and add it to
   `packages/licensing/src/lib/license-keys.ts` under a new kid (e.g. `v2`).
3. Store the private key in 1Password under "Alga License Signing Key v2".
4. Delete `/tmp/new-keys.json`.
5. Deploy a new EE build containing the updated `license-keys.ts`.
6. Issue future licenses with `ALGA_LICENSE_KID=v2`.
7. Old `v1` licenses continue to work until you remove `v1` from `license-keys.ts`.

## Key storage

| Key | Location |
|-----|----------|
| v1 production private key | 1Password → "Nine Minds Internal" vault → "Alga License Signing Key v1" |
| v1-test private key | `packages/licensing/src/lib/__test-fixtures__/v1-test.private.pem` (committed — test use only) |

**NEVER** use the `v1-test` kid to issue real customer licenses.

## Fixture generation (for tests)

```bash
node ee/tools/alga-license/sign.mjs gen-fixture > /tmp/fixtures.json
```

Produces `validToken`, `expiredToken`, `premiumToken`, `tamperedToken`, `wrongKidToken`
using the committed test keypair. These are used by the automated tests in
`packages/licensing/src/lib/verify-license.test.ts`.
