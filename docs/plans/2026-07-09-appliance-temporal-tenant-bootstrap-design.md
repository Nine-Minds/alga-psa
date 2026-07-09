# Appliance Temporal tenant bootstrap design

## Outcome

A clean appliance startup creates its first tenant by starting the local
Temporal `tenantCreationWorkflow`. The workflow adopts the tenant id returned by
install-code redemption, uses the administrator password chosen during setup,
and skips hosted-only customer tracking and welcome email work.

## Chosen approach

Publish the appliance as one coordinated, immutable artifact set. Build the
Alga Core and Temporal worker images from the same commit, publish charts and
Flux configuration without moving the channel, validate their revisions, and
move `stable` exactly once after approval. Keep the pointer-only workflow for
genuine image-only releases, but make it reject a commit whose changed paths
require an unprovided chart/config or worker artifact.

This is preferred to extending the hosted deployment workflow because it keeps
appliance promotion independent of hosted traffic changes. It is preferred to
manual orchestration because the partial release that caused this incident was
valid at the registry level but invalid as a runnable appliance.

## Startup flow

1. Setup redeems the install code and writes the initial tenant and license
   secrets.
2. The appliance Sebastian chart creates the regular, concurrent bootstrap Job.
3. The Job runs migrations and invokes
   `/app/server/scripts/appliance-create-tenant.mjs`.
4. The script retries the local Temporal frontend, then starts fixed workflow id
   `appliance-initial-tenant` on `tenant-workflows`.
5. The local Temporal worker runs `tenantCreationWorkflow`, adopting the
   registry tenant id and supplied password.
6. The Job waits for the workflow result, runs onboarding seeds, and allows the
   application deployment to become ready.

The fixed workflow id and `ALLOW_DUPLICATE_FAILED_ONLY` make a failed bootstrap
retryable without allowing a completed run to mint a duplicate tenant.

## Release flow

The coordinated Argo workflow builds both required images, publishes an
immutable config/chart release with `promote-release=false`, records component
source revisions, validates that every changed appliance component is present,
pauses for stable approval, and finally publishes one release manifest and moves
the channel tag.

The final manifest must contain compatible Alga Core, Temporal worker,
Sebastian chart, Flux config, profile values, and control-plane references. A
failure before the final tag operation leaves `stable` unchanged.

## Failure handling

- Missing image tags, mismatched component revisions, stale config, or changed
  coordinated paths fail before promotion.
- An unreachable Temporal frontend is retried for the configured startup window.
- Workflow failure fails the bootstrap Job with the workflow id in its log.
- A recover-mode rerun reuses migrated database state and retries only a failed
  workflow execution.

## Verification

Contract tests render the appliance chart and prove it runs the `.mjs` client
with the required Temporal environment. Workflow tests prove tenant id/password
adoption and hosted-step suppression. Release tests prove partial artifact sets
are rejected. Final validation uses an empty local appliance database, observes
the Temporal execution, verifies the local tenant id against the redeemed
registry tenant id, and performs a real administrator login.
