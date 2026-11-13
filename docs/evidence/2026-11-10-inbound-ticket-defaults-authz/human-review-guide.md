# Human review guide: inbound ticket defaults authorization

## Finding and disposition

The approved plan `docs/plans/2026-11-10-authz-in-updateinboundticketdefaults-fix-plan.md` (plan commit `fc16a83ae7956cf73cad427657945e6be44c6870`) confirms the single high-severity authorization finding. `withAuth` authenticates and establishes tenant context; it does not check permission. The five inbound-defaults actions previously ignored their authenticated user and could be invoked directly. The defaults consumer trusts the stored routing and attribution values for new inbound-email tickets.

The finding is confirmed and fixed at the server-action boundary. No changes were made to UI restrictions, permission catalog, or the inbound-email worker.

## What changed

- `packages/integrations/src/actions/email-actions/inboundTicketDefaultsActions.ts`: all five actions now reject client users before `createTenantKnex()` (reads at lines 83-86 and 394-397; writes at 138-141, 226-229, and 329-332). MSP read actions require `ticket_settings:read`; create, update, and delete require `ticket_settings:update`. Denials preserve the read `{ defaults, error }` and write `actionError(...)` response shapes. Existing validation and tenant scoping remain in place.
- `packages/integrations/src/actions/email-actions/mspInboundTicketDefaultsAccess.ts:17-35`: shared permission guard and read/update mapping.
- `packages/integrations/src/actions/email-actions/inboundTicketDefaultsActions.authz.test.ts:72-156`: behavior tests cover client denials before connection acquisition, missing read/update grants, distinct grants, all authorized action paths, and rejection of caller-controlled routing and attribution updates before persistence.
- Existing location and delete-reference action tests now supply an internal user and grant permission so they continue testing their intended behavior.

`withAuth` is at `packages/auth/src/lib/withAuth.ts:151-178`; the browser form invokes create/update at `packages/integrations/src/components/email/forms/InboundTicketDefaultsForm.tsx:280-285`; and the trusting worker selects `defaults.client_id` and populates new ticket fields at `shared/services/email/processInboundEmailInApp.ts:1976` and `2087-2101`.

## Review first

1. Inspect the client-user checks and permission checks at the beginning of each action in `inboundTicketDefaultsActions.ts`.
2. Inspect `mspInboundTicketDefaultsAccess.ts` for the read/update permission mapping and client rejection.
3. Inspect the unauthorized update regression test and verify it asserts both no application-table access and no mutation for attacker-selected `client_id`, `board_id`, `status_id`, `priority_id`, and `entered_by`.
4. Confirm no unrelated permission or worker behavior changed.

## Verification

Focused command:

```bash
npm -w @alga-psa/integrations test -- --run src/actions/email-actions/inboundTicketDefaultsActions.authz.test.ts src/actions/email-actions/inboundTicketDefaultsActions.location.test.ts src/actions/email-actions/inboundTicketDefaultsActions.deleteReferences.test.ts
```

Result: 3 test files passed, 17 tests passed. As a mutation check, the new authorization suite was run against the original pre-fix action implementation; all 5 authorization tests failed, including one that observed the unguarded update persisting caller-selected routing and attribution fields.

Typecheck: `NODE_OPTIONS=--max-old-space-size=8192 npm -w @alga-psa/integrations run typecheck` passed. The default 4 GB heap attempt ran out of memory; the 8 GB run exited 0. Build: `npx nx build @alga-psa/integrations --output-style=static` passed; its 39 dependency build tasks were served from cache. The workspace `npm run build` script invokes `tsup` without configured input files and fails with “No input files,” so Nx is the repository-supported build target here. `npx nx lint @alga-psa/integrations --output-style=static` passed with existing warnings; changed-file ESLint reported warnings only, no errors. The app server was not started.

## Scope note

The existing `getInboundTicketDefaultsById` query selects a `defaults` column, which the approved plan identifies as a pre-existing unrelated issue. It is unchanged by this authorization fix.
