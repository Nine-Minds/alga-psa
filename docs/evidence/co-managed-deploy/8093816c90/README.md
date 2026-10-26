# Runtime acceptance at 8093816c90 (production build-1793021045283)

This round fixed late-approved hourly billing (`5a822cb47e`) and two client-relationship states found during acceptance (`8093816c90`). Every scenario below ran on the same production build:

- **Build:** `build-1793021045283`, stamp `8093816c90…+da39a3ee5e6b`, dist `server/.next-review-final-8093816c`.
- **Served at:** `http://feature-co-managed-it.localhost:23374` by the card's `review-app`, launched through board admission.
- **Temporal worker:** rebuilt at this source and cold-restarted.

Provenance is in [runtime-provenance.json](runtime-provenance.json). It records PIDs, hashes, and the board's later "suspended" label, explained below.

Each scenario is a recorded browser run in the real product. Its folder contains:

- `walkthrough.webm` and `chapters.vtt`.
- `recording.json`: steps, assertions, and the served build, verified before each run.
- Screenshots and database receipts.

The scripts are in [scripts/](scripts/). They sign in through the product's own sign-in forms (MSP and client portal) using the review accounts. Database reads use the card's `server_co_managed`. Email is read from the local SMTP sink simulator. No Stripe, Microsoft or other external provider was used.

| # | Scenario | Requirement keys | Result | Folder |
| --- | --- | --- | --- | --- |
| 1 | Late approved hourly time: MSP time on a shared ticket and native ticket time, both dated Oct 18 inside the October period INV-000003 already closed, are approved and billed once on the next (November-service) invoice. Each line reads `Basic Support (late time, service period 2026-10-01 – 2026-10-31)` at the contract's $100/h; INV-000003 is unchanged and the retry offers nothing. | T13 (Task 1) | **pass** (18 assertions; status reads `partial` only because cleanup is scenario 2) | [01-billing-late-time](01-billing-late-time/) |
| 2 | Cleanup through the product. The disposable draft INV-000005 was reversed, the sheet approval reversed, the two entries, native ticket and approver team deleted, the contract terminated again and the billing email cleared. INV-000003 still reads $425 with 17 sources. | — | **pass** | [02-billing-late-time-cleanup](02-billing-late-time-cleanup/) |
| 3 | A qualified MSP edit (QA changes ticket 000016's priority) is stored with the MSP actor reference: `QA Tester`, `Oz`, no customer user id. Alice's history reads `QA Tester (Oz) changed priority: Low → Urgent`. The priority was restored. | T13 | **pass** | [03-t13-msp-edit-attribution](03-t13-msp-edit-attribution/) |
| 4 | Fresh markers on ticket 000009 in four audiences: Shared IT, customer-private, MSP-private and requester. | T09 | **pass** (8 assertions) | [04-t09-privacy](04-t09-privacy/) |
| 5 | Customer portable export. Alice downloads White Rabbit IT's encrypted backup, and it is decrypted with the product reader. The customer's Shared IT, private and requester markers are present; the MSP-private markers (this round's and `DEPLOY-4E5F-QA-MSP-PRIVATE`) are absent. | T09 | **pass** | [05-t09-export](05-t09-export/) |
| 6 | Client relationship states and write identity: forbidden, single, ended, absent, multiple, inconsistent, a tampered relationship URL, and a stale two-tab write. Also the summary refresh after seat changes in the same document. | clientIntegration:F003, clientIntegration:F010 | **pass** (17 assertions) | [06-f003-relationship-states](06-f003-relationship-states/) |
| 7 | Fixed-client setup recovery, with the setup cancelled and its seat released at the end. | clientIntegration:T009, clientIntegration:F015 (part) | **pass** | [07-t009-onboarding-recovery](07-t009-onboarding-recovery/) |
| 8 | Closure path on the disposable "Accept-3 IT" workspace. QA, assigned as collaborating staff, posts a Shared IT comment with a file and an MSP-private note. The customer admin then ends the relationship in tab A; tab B retries the same closure. | T18 (part), clientIntegration:F018 (part) | **pass** | [08-closure-archive-dedup](08-closure-archive-dedup/) |

Scenario 4 details:

- **Stored audiences:** `shared_it`, `organization_private` and `requester`. The MSP-private note exists only in the sponsor's private store.
- **QA search:** finds a native Oz ticket (positive control). Full search and palette both return 0 results for Alice's private marker.
- **Alice search:** her palette is live (positive control). It returns nothing for QA's private marker, and `/msp/search` is outside the co-managed product.
- **Requester portal:** the ticket shows only the requester reply. Its count (9) matches the permitted comments, not the 35 stored. Portal search matches no hidden marker.

Scenario 6 details:

- **Forbidden:** an Oz Technician sees "You don't have permission to manage co-managed access…". The shared ticket URL and a URL carrying another relationship's ID both fail closed with "Restricted ticket".
- **Single:** White Rabbit shows Active, seats and Manage access.
- **Ended:** Kansas shows "Relationship ended" and its history, with no setup offered.
- **Absent:** a client never set up offers setup to the manager. The non-manager is never offered Enable.
- **Multiple:** "Multiple co-managed relationships". Only after an explicit choice do the management controls appear.
- **Inconsistent:** "Co-managed record needs attention", with neither setup nor management offered.
- **Stale write:** a second tab's save is refused, and the revision is unchanged (95 → 95).
- **Seat refresh:** the summary reads "1 of 2" then "1 of 1" in the same document.

Scenario 7 details:

- **Reserved progress:** the setup shows progress and a reserved seat.
- **Delivery failure:** with the SMTP sink rejecting mail, the client view shows "Invitation delivery failed; retry to send it." It shows the same after a reload, with Retry offered.
- **Recovery:** after the sink recovered, the durable delivery sent exactly one invitation for the same operation without Retry being pressed.
- **Expiry:** an expired invitation reads "Invitation expired", distinct from delivery failure, and offers "Resend administrator invitation".

Scenario 8 details:

- The departure produced exactly one closure and one sealed archive manifest.
- It produced one archive file with no duplicate keys, and released the seat.
- The retry left the relationship revision at 7 and the closure's `closed_at` unchanged.
- QA's Shared work archive lists the ticket once.

## Fixtures and their limits

These are stated in each scenario's `limitations`:

- **Multiple and inconsistent states (scenario 6):** these come from reversible SQL fixtures on the disposable Accept-3 and Accept-4 workspaces. They change an operation's client mapping and a relationship's sponsor client, and are restored in a `finally` block; [fixture-after.json](06-f003-relationship-states/fixture-after.json) shows the original values. The product deliberately offers no path that creates these states.
- **Invitation expiry (scenario 7):** produced by moving `expires_at` into the past.
- **Delivery failure (scenario 7):** uses the SMTP sink's `reject-mail` fault.
- **Escalation (scenario 8):** Accept-3 cannot be escalated because Oz has no SLA policy for that client. The product says so: "Your MSP must configure its SLA policy and priority mapping before this ticket can be escalated." QA therefore participated through the customer's shared Service Desk board, after QA mapped Accept-3's priorities and assigned himself as collaborating staff through the product.

## Findings fixed this round

These were found by the first F003 run on build-1793016214488 (5a822cb47e) and fixed in `8093816c90`. That run is kept at [attempts/build-1793016214488](attempts/build-1793016214488/).

- **Forbidden showed a retry message.** A technician without co-management access saw "Could not load access settings. Reload to try again." The action threw `FORBIDDEN`, and production server actions redact thrown messages. Refusal is now a typed screen state with a permission message.
- **Inconsistent read as "not enabled".** A setup whose relationship record names another client read "Co-managed IT not enabled" and offered Enable; see [09-inconsistent.txt](attempts/build-1793016214488/06-f003-relationship-states/09-inconsistent.txt). Discovery now reports it as inconsistent, setup is closed, and target resolution fails closed.

## Not exercised at runtime

- **Lifecycle grace expiring in the middle of an operation (defer and roll back).** No runtime clock control was available. This stays covered only by the coManagedBootstrap PostgreSQL cases.
- **Cleanup acknowledgement and worker failure (clientIntegration:F015).**
- **Task-conversation audiences (T09).** Requester task access, task disclosure, and task notification and email.
- **Other T13 parts.** Catalog-priced time with a real catalog price, and editing a time entry itself (as opposed to a ticket field).
- **Restore of the portable export (T18).** This needs an isolated destination installation, which is externally blocked.

## Observations, not defects

- A retried closure in a stale tab is a silent no-op: the dialog stays open and shows no "already ended" message.
- The billing `recording.json` status reads `partial` because its cleanup runs as a separate recorded scenario.

## Data left behind

**Created through the product and kept:**

- Comments on White Rabbit tickets 000009 (`T09S…` markers from three runs) and 000016.
- `ticket_audit_logs` rows for the priority edits and their restores.
- QA's staff assignment and the SLA priority mapping on Accept-3, which has now ended.
- The ended Accept-3 relationship and its sealed archive.
- Two cancelled `T009-*` setups on "CM-REVIEW-20261026-01 Cancel", with their seats released.
- One downloaded customer export, kept only in the private card directory.

**Restored:**

- The White Rabbit contract (inactive), billing email (empty), QA's sheet (Changes Requested), and ticket 000016's priority (Low).
- QA's White Rabbit access (Collaborate) and the seat allocation (1).
- The Accept-3 and Accept-4 fixture mappings.

INV-000003 ($425, 17 sources) and the reversed INV-000002 were never touched.

## Requirement attribution

See [requirement-attribution.json](requirement-attribution.json). Rows are promoted only when every clause ran on this build. The census packet applies these decisions without changing any verifier rule.
