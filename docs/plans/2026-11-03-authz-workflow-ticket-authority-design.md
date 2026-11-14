# Design — Security: authz in retainWorkflowTicketAuthority

## Finding (confirmed on main)

retainWorkflowTicketAuthority returns silently when no provider is registered (shared/workflow/runtime/actions/businessOperations/shared.ts:570-573); the only registration (packages/co-managed/src/deliveryRegistration.ts) is never imported by services/workflow-worker/src/index.ts, so co-managed record-scope checks never run.

## Approved design (from the attached review packet)

1. Register the ticket-authority provider in the workflow-worker bootstrap before runtime init.
2. Make absence explicit: a served co-managed tenant mutation with no provider fails closed and logs one diagnostic, rather than falling back to the coarse permission check.
3. Keep the seam dependency-clean: the worker composes providers; the shared runtime does not import the co-managed package. Tenant classification must use the authoritative capability gate; an inconclusive classification cannot permit the mutation.
4. Preserve native behavior for a tenant authoritatively classified as not served.
5. Behavioral coverage: a bundle-narrowed author's worker mutation is refused, an in-scope author succeeds, and an unregistered provider fails closed.

## Files in scope

`services/workflow-worker/src/index.ts`, `shared/workflow/runtime/actions/businessOperations/shared.ts`, `packages/co-managed/src/deliveryRegistration.ts`, and worker/security tests.

## Hand-off
This file materializes the approved Design Session review packet and is the spec linked to this card's PSA ticket. Record its repository-relative path in `state.psaSpecPaths`.
