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
- (2026-07-10) The existing control-plane ClusterRole already grants the namespaced Secret and Job operations required by recovery, so no RBAC expansion was necessary.
- (2026-07-10) The recovery Job clones the running Alga container image and environment, then adds only Secret-backed target/password inputs. This makes the application deployment the effective hashing configuration authority.
- (2026-07-10) Local VM `ubuntu24.04` currently leases `192.168.122.215`, not the older `192.168.122.55` recorded in the appliance skill.
- (2026-07-11) Live appliance smoke passed on `alga-appliance-pro-lab`: Argo workflow `temporal-worker-build-auto-vmfgb` published `ghcr.io/nine-minds/temporal-worker:78b18a50` (digest `sha256:ffb93248de3f9b6d9b80e008f1c3ac8e1f3d19aa4682c7d4c7eb4c59454af8d1`), the appliance rolled out that sole worker with `ITERATIONS=1000`, and `tenantCreationWorkflow` created `temporal-password-smoke-20260711@local.test`. Alga authenticated that user with the exact workflow-supplied password.
- (2026-07-11) The authenticated management recovery path reset original setup admin `bob@nineminds.com`; the reset returned HTTP 200 and Alga authenticated the original admin with the replacement password. The live Job initially failed while the app still used the pre-change `c18cf795` image because that image lacked the reset script, then passed after deploying the committed script on the same base image.

## Commands / Runbooks

- Inspect effective pod hashing variables with `kubectl -n msp get deploy <name> -o yaml` and compare `SALT_BYTES`, `ITERATIONS`, `KEY_LENGTH`, `ALGORITHM`, and the `NEXTAUTH_SECRET` source.
- Render the appliance worker environment with `helm template temporal-worker ee/helm/temporal-worker -f ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml`.
- Run appliance tests with `node --test ee/appliance/host-service/tests/*.test.mjs` (Docker access is required by the embedded fresh-install staging test).
- Run the DB integration with `npx vitest run src/test/integration/applianceInitialAdminPasswordReset.integration.test.ts --coverage.enabled=false` from `server/` against the isolated local test PostgreSQL instance.

## Links / References

- `packages/core/src/lib/encryption.ts`
- `ee/helm/temporal-worker/values.yaml`
- `ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml`
- `helm/values.yaml`
- `ee/appliance/status-ui/app/auth/AuthGate.tsx`
- `ee/appliance/host-service/server.mjs`

## Open Questions

- None.
