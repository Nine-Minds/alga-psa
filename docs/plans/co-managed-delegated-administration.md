# Co-managed delegated administration (T07)

Customers can approve a specific assigned MSP technician or team to perform one operation against one customer-owned record. The MSP uses `/msp/co-management/administration` in their own session; its workspace list includes only current readable approvals. Customers manage approvals from their co-managed access page. The customer/MSP banner remains visible while editing.

| Operation | Customer-approved target | Allowed fields or behavior |
| --- | --- | --- |
| Board display settings | One active board | `board_name`, `description`, `enable_live_ticket_timer` |
| Non-administrator profile | One active internal user with non-administrative roles | `first_name`, `last_name`, `timezone` |
| Invitation resend | One unused, unexpired invitation created by a customer-local user, for a non-administrative role | Deliver the existing recipient, role, setup token and expiry unchanged |

Initial administrator invitations, new invitations, role assignments, identity/email changes, activation, passwords, credential resets and general customer administration are outside these approvals. There is no tenant impersonation or customer proxy account. Invitation recovery during initial provisioning remains the separate sponsor provisioning operation.

`packages/co-managed/src/delegatedAdministration.ts` retains the live relationship, customer approval, MSP staff assignment and current home session/RBAC/bundle authority through reads and writes. Foreign record policy uses qualified identities and the actual sponsor-owned client projection. Customer approval requires native authority for the chosen operation. Redacted records fail closed; MSP screens include only granted display fields. Customer option searches exhaust candidates in bounded keyset batches and apply current record/principal admission and display-label search before pagination or `hasMore`; hidden usernames, emails and records cannot affect search pages. Invitation approval fingerprints include the exact identity, role permissions, token and expiry. Role parent locks retain those terms across delivery. Resending uses the existing seat-admission engine and never renews the invitation.

Approvals advance the existing relationship policy revision. Grant IDs cannot be repurposed; re-approval after revocation creates a new ID. Commands carry an immutable operation ID and expected field version. Durable receipts serialize exact retries, and metadata-only audits retain the qualified MSP actor without copying invitation tokens or profile values. Revocation remains available during license read-only state. Operational writes honor the existing lifecycle engine.

The generated migration is `20260908225004_add_co_managed_delegated_administration.cjs`. Both customer-owned tables participate in tenant metadata and deletion order. These live trust approvals are deliberately outside portable customer business-record exports; a restored independent workspace does not reactivate former delegated authority.

`release-v1-6-feature` protects only the route/panel/navigation presentation. Server actions and domain operations use normal authentication and authorization without a backend release-flag check. The new translation namespace uses English fallback; navigation labels cover the existing supported languages.

Focused validation:

- PostgreSQL cases in `server/src/test/integration/helpers/coManagedDelegatedAdministrationCases.ts`: allowed board/profile edits, exact receipts, rejected privileged/identity changes, original invitation retry, bundle/session/lapse/revocation checks, team membership and workspace discovery, seat/expiry/role changes, concurrent delivery and revocation, pinned role permissions, immutable actor/target/command snapshots, and fresh approval after revocation.
- `coManagedDelegatedAdministration.test.tsx`: UI flag, scoped fields/customer banner, stable retry, clearing data after access denial, read-only revocation and authorized workspace discovery.
- `coManagedDelegatedAdministrationActions.test.ts`: tracked browser actors, durable target selection, foreign-operation rejection and original invitation transport.
- Existing policy-panel regression tests and direct syntax transforms. No full build or broad TypeScript/test sweep.
