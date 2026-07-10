# PRD — Appliance Temporal Tenant Bootstrap

- Slug: `appliance-temporal-tenant-bootstrap`
- Date: `2026-07-09`
- Status: Approved

## Summary

Make first-boot tenant provisioning on an Alga PSA appliance run through the
appliance's local Temporal service, and make the release pipeline publish the
app image, Temporal worker, charts, and Flux config as one compatible unit.

## Problem

Commit `5f2b42b2` introduced the Temporal-based appliance tenant flow, but the
stable appliance channel was updated only with the Alga Core image. The old
Sebastian chart continued to invoke `tsx create-tenant.ts`, and the old Temporal
worker did not contain the new workflow inputs. A fresh appliance therefore
failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` instead of starting the local
workflow. The registry accepted this internally inconsistent release.

## Goals

- Start local `tenantCreationWorkflow` during clean appliance bootstrap.
- Adopt the registry tenant id and operator-selected admin password.
- Keep bootstrap retries idempotent.
- Publish all commit-coupled appliance artifacts atomically.
- Reject partial stable releases before the channel tag moves.
- Prove tenant creation and administrator login on the local appliance VM.

## Non-goals

- Changing the hosted tenant-creation behavior.
- Sending a welcome email or creating Nine Minds customer-tracking records for
  appliance tenants.
- Rebuilding the ISO when registry-delivered images/config are sufficient.
- Redesigning the general-purpose Temporal platform.

## Users and Primary Flows

The appliance operator enters an install code and initial administrator details
in setup. The appliance redeems the code, starts its local stack, creates the
tenant through local Temporal, and exposes a working login without manual
database intervention.

## UX / UI Notes

No new form fields are required. Existing setup/status surfaces should report
bootstrap progress and failures. Logs must identify workflow id
`appliance-initial-tenant` when the workflow is started or fails.

## Requirements

### Functional Requirements

1. The appliance bootstrap Job must execute
   `/app/server/scripts/appliance-create-tenant.mjs`, never the legacy TSX
   tenant script.
2. The Job must receive the local Temporal address, namespace, and
   `tenant-workflows` task queue.
3. The Temporal worker must support the appliance tenant id, supplied password,
   and hosted-step skip flags.
4. Successful workflow completion must create exactly one tenant and admin.
5. A failed workflow must be retryable; a completed workflow must not be
   duplicated.
6. A stable release must not move until app, worker, chart, config, and profile
   artifacts validate as compatible.
7. An installed appliance must be able to consume the coordinated manifest and
   reconcile all affected releases.

### Non-functional Requirements

- Promotion is atomic at the mutable channel tag.
- Registry/network failures before promotion leave the prior stable manifest
  intact.
- Startup tolerates the Temporal frontend and worker becoming ready after the
  bootstrap Job starts.

## Data / API / Integrations

Install-code redemption supplies `INITIAL_TENANT_ID`. The bootstrap script uses
the local Temporal gRPC endpoint and the `tenant-workflows` queue. The workflow
writes the existing tenant, company, client, user, role, onboarding, and tenant
settings tables through existing activities; no schema change is introduced by
this repair.

## Security / Permissions

The chosen admin password remains in the existing Kubernetes Secret/env path
and is hashed by the Temporal worker with the same `NEXTAUTH_SECRET` pepper as
the application. Release workflows use the existing GHCR and GitHub credentials
and must not emit their values.

## Observability

Bootstrap logs identify connection retries, workflow start/attach, completion,
and failure. Validation records immutable image/config digests and component
source revisions in the release manifest.

## Rollout / Migration

First publish an immutable coordinated release, then move stable once. Existing
appliances consume it through Manage → Updates. The local verification appliance
is reset to empty application state so the initial-tenant path actually runs.
The same install code may be reused when the machine id is unchanged.

## Open Questions

None. The approved design uses a dedicated coordinated appliance release and a
guard on pointer-only promotion.

## Acceptance Criteria (Definition of Done)

- Stable references the coordinated Alga Core, Temporal worker, chart, and
  config artifacts from one approved source revision.
- A partial release equivalent to the incident is rejected before promotion.
- A clean local appliance log shows `tenantCreationWorkflow` start and success.
- The local tenant id equals the redeemed registry tenant id.
- The configured administrator can log in successfully.
- Required pull requests are merged and release/runbook evidence is recorded.
