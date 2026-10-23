# Single-user tenant quote approval + Request Changes 500 — implementation plan (alga-2026-0002597)

Customer: RightPath Consulting (Eric Pfeifer), one-person MSP. Critical.
Four linked issues: (1) sole user can't approve their own quote; (2) API Request Changes 500;
(3) Send blocked while pending; (4) no MSP-side "mark accepted".

## Grounded code map (read on this branch)
- `packages/billing/src/actions/quoteActions.ts`
  - `createQuoteAuthorizationKernel(includeApproveGuard)` :278-303 installs a builtin mutation
    guard: `approve` + `record.ownerUserId === subject.userId` → denied
    `billing_not_self_approver_denied`.
  - `approveQuote` :1445-1475 calls `authorizeMutation` and, if `!allowed`, throws
    `'Permission denied: Cannot approve your own quote'` :1461.
  - UI `requestChanges` writes activity_type `'approval_changes_requested'` :1518.
  - Send gate :1559 — `approvalRequired` requires status `approved` before send.
- `ee/server/src/lib/actions/auth/authorizationBundleActions.ts` :1040-1060 — a second,
  independent EE builtin guard with the same self-approver rule.
- `packages/authorization/src/bundles/starterBundles.ts` :57 — `finance-reviewer` bundle rule
  `billing/approve/client_portfolio/not_self_approver`; enforced in
  `packages/authorization/src/kernel/providers/bundleProvider.ts` :98-140
  (`bundleProvider` computes `notSelfApproverViolation`).
- API `server/src/lib/api/controllers/ApiQuoteController.ts` `requestChanges()` :615-633 →
  `server/src/lib/api/services/QuoteService.ts` `requestChanges()` :410-428 (writes activity_type
  `'changes_requested'` :421 — **inconsistent with the UI's `approval_changes_requested`**).

### Confirmed
- `QUOTE_ALLOWED_STATUS_TRANSITIONS` (`packages/billing/src/schemas/quoteSchemas.ts:145`):
  `pending_approval: ['approved','draft','cancelled']` — `pending_approval → draft` **is** allowed,
  so the API 500 is **not** a status-transition rejection.
- `quote_activities` migration (`server/migrations/20260320100000_create_quotes_tables.cjs`
  :137-150): `activity_type text NOT NULL`, no CHECK/enum, `performed_by` nullable → not a
  constraint failure. The `changes_requested` vs `approval_changes_requested` mismatch is real drift
  but would not by itself 500.
- `throwQuoteApiError` (`QuoteService.ts:46-93`) maps a known set of messages to 4xx and re-throws
  **everything else as-is** → an unforeseen error in `requestChanges` surfaces as HTTP 500.

## Decisions
1. **Self-approval when no other approver (chosen).** When no *other* active MSP user holds
   `quotes:approve`, the submitter may approve their own quote. Implement as ONE predicate and
   apply it at all three enforcement sites so they cannot drift:
   `allowSelfQuoteApproval(knex, tenant, subjectUserId)` → true iff the count of active users with
   `quotes:approve` excluding the subject is 0. Wire it into (a) the quoteActions builtin guard,
   (b) the EE builtin guard, (c) the `bundleProvider` `not_self_approver` evaluation (pass an
   allowSelf flag through the authorize input). The `quoteActions` post-check at :1461 defers to the
   same decision. On a self-approval, write an audit activity
   (`approved` with metadata `{ self_approved: true, reason: 'sole approver' }`).
   Prefer this over a hidden tenant toggle: the customer's problem is structural (no other approver),
   and a toggle can be added later without changing the guards. *(This is a free choice under the
   conn grant — recorded here as the design decision.)*
2. **Tell the user instead of stalling.** In the approval UI (`QuoteApprovalDashboard.tsx`,
   `approval_required` copy), when the tenant has no other approver, show "You are the only
   approver — you can approve your own quotes" rather than a dead Pending state.
3. **Request Changes parity + fix the 500.** Make the API path mirror the UI: same activity_type
   constant (single shared value — use `approval_changes_requested` as canonical and migrate the API
   to it, or add the API string to the shared type), status `pending_approval → draft`, and an
   explicit reason. Reproduce the 500 first (see Investigations); the two leading causes are
   (a) `await req.json()` on an empty/absent body throwing a raw SyntaxError → 500 (map to 400 with
   a clear message), and (b) an unhandled error re-thrown by `throwQuoteApiError`. Add API tests for
   both the happy path and the bad-body path. Verify the UI Request Changes action too.
4. **MSP "Mark as accepted" (include).** Add an MSP-side action on a `sent` quote that records
   acceptance with actor, timestamp and an optional note, moving `sent → accepted` (allowed by the
   transition map) and writing an `accepted` activity; feed the existing Accepted → invoice/project
   path. i18n the new strings. This directly serves the one-person MSP and the verbal-acceptance
   case; it is the smallest change that closes issue 4.

## Investigations the implementer must run
- Reproduce the API 500 with the real request (and with no body); capture the stack and confirm
  which throw is unmapped.
- Confirm `hasPermission(user,'quotes','approve')` semantics for the sole user (it should be true).
- Diff the three self-approver guards to confirm they share inputs (ownerUserId/subject.userId).

## Tests
- Unit: `allowSelfQuoteApproval` true (sole approver) / false (another approver exists).
- `quoteActions` approve: self-approval succeeds and writes the audit activity when sole approver;
  still denied when another approver exists.
- Authorization kernel: the builtin guard and the bundle `not_self_approver` both allow the sole
  approver (parity test so the three sites cannot drift).
- API: `POST .../request-changes` returns 200 for a pending quote and 400 (not 500) for a bad/empty
  body; activity_type matches the UI constant.
- "Mark as accepted": sent → accepted with activity; blocked for non-sent.
- i18n: every new string localized.

## Acceptance
- A single-user tenant with approval required takes a quote Draft → Approved → Sent → Accepted
  (portal or the new MSP action), with no stuck Pending state and an audit trail.
- API Request Changes returns a correct 2xx/4xx, never 500; UI Request Changes works.
- Send works once approved.

## Out of scope
Changing who holds `quotes:approve`; multi-approver workflow redesign.
