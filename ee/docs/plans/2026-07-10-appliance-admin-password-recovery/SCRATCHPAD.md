# Scratchpad — Appliance Initial-Admin Password Recovery

- Plan slug: `appliance-admin-password-recovery`
- Created: `2026-07-10`

## Decisions

- (2026-07-10) Keep the appliance application's existing 1,000-iteration verifier to preserve existing appliance user credentials.
- (2026-07-10) Override only the appliance temporal-worker values to 1,000 iterations; hosted remains at 10,000.
- (2026-07-10) Limit recovery to the original setup admin.
- (2026-07-10) Use a short-lived Kubernetes Job rather than add an Alga network endpoint.
- (2026-07-10) Use application-owned hashing code and a transient Secret; do not duplicate PBKDF2 in the control plane or pass plaintext in Job arguments.

## Discoveries / Constraints

- (2026-07-10) `packages/core/src/lib/encryption.ts` stores password hashes as `salt:hash`; iteration count, key length, and algorithm are not encoded.
- (2026-07-10) `ee/helm/temporal-worker/values.yaml` defaults to 10,000 iterations.
- (2026-07-10) Hosted Alga values explicitly use 10,000 iterations, while `helm/values.yaml` defaults the Alga application to 1,000.
- (2026-07-10) The appliance temporal-worker overlay does not currently override encryption values.
- (2026-07-10) Existing 10,000-iteration hashes cannot be converted to 1,000 without the plaintext password.
- (2026-07-10) The management UI already has session authentication and a separate recovery CLI for its own management password; this plan resets the Alga application admin credential only.

## Commands / Runbooks

- Inspect effective pod hashing variables with `kubectl -n msp get deploy <name> -o yaml` and compare `SALT_BYTES`, `ITERATIONS`, `KEY_LENGTH`, `ALGORITHM`, and the `NEXTAUTH_SECRET` source.

## Links / References

- `packages/core/src/lib/encryption.ts`
- `ee/helm/temporal-worker/values.yaml`
- `ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml`
- `helm/values.yaml`
- `ee/appliance/status-ui/app/auth/AuthGate.tsx`
- `ee/appliance/host-service/server.mjs`

## Open Questions

- None.

