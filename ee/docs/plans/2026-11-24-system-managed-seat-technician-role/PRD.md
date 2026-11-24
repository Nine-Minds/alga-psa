# Protect the co-managed Seat Technician role

## Outcome

An MSP administrator can answer “what access does this technician have?” and can manage their client’s boards and projects from the co-managed arrangement. Alga owns the role’s identity, permissions and assignment. Today an admin can edit this shared role for every seat technician in the MSP, and later provisioning can partially undo the edit.

## Visibility and operator experience

In a tenant served by the seat capability, show the role and its grants to authorized admins inspecting permissions or a technician’s assigned role. Label it “Managed by Co-managed IT” and direct the admin to the client arrangement for board and project scope. Omit it from manual assignment, invitations outside the seat flow, bulk role changes and editable role choices. A read-only presentation can share the permissions matrix where that preserves inspectability. In tenants outside the capability, hide it from ordinary role discovery. Continue to enforce ownership if capability visibility changes.

## Implementation sequence

1. Introduce a stable tenant-scoped identity for capability-owned roles using the existing role catalog and admission boundaries. Keep one authoritative grant set. Distinguish system lifecycle writes from general role administration at the server boundary.
2. Enforce ownership on definition, grants and membership, including replace, remove, rename, delete and bulk operations across actions and APIs. Reserve the identity against collisions. Preserve invitation acceptance, revocation and conversion as the ways the seat lifecycle changes membership.
3. Reconcile deployed data. Derive ownership from reliable evidence including existing seat assignments. Repair missing and extra grants to the exact catalog set and preserve legitimate seat assignments. Account for historical renames, duplicate candidates and manual assignments to non-seat users. Surface ambiguous ownership for resolution before changing unrelated roles or users. Keep migration and retries tenant-scoped and idempotent.
4. Apply the same ownership information to visibility, role detail views and pickers. A security admin can inspect the baseline and a technician’s membership. A client-specific access change is made on the arrangement.
5. Verify real authorization, storage and UI behavior, including ordinary custom roles and capability-off tenants. The existing seat grants, board scope rules and commercial entitlements are outside the redesign.

## Acceptance

A privileged tenant administrator cannot alter the managed definition, grants or memberships through general role administration. Existing and new seat technicians continue to receive the canonical operational permissions and arrangement-scoped access. Inspecting an assigned role explains where access is managed. No manual role picker offers Seat Technician. Re-running reconciliation leaves healthy data intact.
