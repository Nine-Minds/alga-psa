# Enforce seat scope in the Add Ticket client picker

## Problem and outcome

A co-managed seat technician can see names of other clients in their sponsoring MSP's Add Ticket dialog. The seat arrangement already identifies the client they may see. Opening the picker, searching and resolving a selected value must all honor that boundary, including when the MSP has never configured a policy bundle.

## Implementation plan

1. Add a database-backed regression through the server action called by Add Ticket. Use an eligible hosted Pro sponsor, two clients in that tenant and an active technician assigned to one client. Confirm that the test detects the original behavior.
2. Route shared client and contact read scoping through the existing read-scope evaluator. Keep the same request-local subject across resources. Apply the combined seat and bundle predicates in SQL before counts, paging, lookup by ID and row enrichment.
3. Exercise both picker entry points and the existing client/contact scope suite. Verify that applicable bundles can further restrict the seat, that a revoked seat gets empty results on its next request, and that ordinary MSP staff retain their existing visibility.
4. Record the regression result and relevant suite results on the card for review.

## Acceptance and rollout

Seat technicians see only their arrangement's client unless an additional rule narrows their access further. Other clients contribute neither rows nor counts. Existing RBAC checks, tenant filtering and the single-probe path for tenants with no applicable authorization sources are preserved. The existing seat assignment and arrangement provide all required data. This change requires no migration, policy setup or picker redesign. Ticket creation authorization and broader changes to co-managed permissions are outside this card.
