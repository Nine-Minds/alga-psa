# Runtime acceptance at 2d00cb6f0e (production build-1793025108142)

This round closes the remaining late-time gaps and two scoped acceptance items:

- **`1166f31a1a`:** late approved hourly time is never silently omitted. Automatic Invoices and every invoice preview name it.
- **`2d00cb6f0e`:** a voided invoice keeps its window closed.
- **T09 task audiences and T13 time-entry edit:** both exercised on this build.

Every scenario ran on one build:

- **Build:** `build-1793025108142`, stamp `2d00cb6f0e…+da39a3ee5e6b`, dist `server/.next-review-final-2d00cb6f`.
- **Served at:** `:23374`, launched by the board's `review-app` through normal admission. See [runtime-provenance.json](runtime-provenance.json): the board labelled the PTY suspended seconds later, as in earlier rounds, and the Docker refresh incident is recorded there too.

The workers were not rebuilt, because nothing they compile changed since `8093816c90`. Scripts are in [scripts/](scripts/).

| # | Scenario | Keys | Result | Folder |
| --- | --- | --- | --- | --- |
| 1 | Late approved native time, carried and then stranded; nothing generated. | T13 (Task 1) | **pass** (13 assertions) | [01-late-time-notices](01-late-time-notices/) |
| 2 | A draft closes its window, and reversing the draft reopens it. | T13 (Task 1) | **pass** for all 6 behaviour assertions; the recording reads `failed` at its cleanup step (see Findings), and cleanup was completed by 02b | [02-reversed-draft-reopens](02-reversed-draft-reopens/), [02b-reversed-draft-cleanup](02b-reversed-draft-cleanup/) |
| 4 | T09 task-conversation audiences. | T09 | **pass** (7 assertions) | [04-t09-task-audiences](04-t09-task-audiences/) |
| 5 | T13: MSP edit of an existing recorded time entry. | T13 | **pass** (5 assertions) | [05-t13-time-entry-edit](05-t13-time-entry-edit/) |

Scenario 1 details:

1. **Setup:** the White Rabbit hourly contract is restored. A disposable native ticket gets 30 minutes dated Oct 18, approved through native timesheets. That date falls in the October period INV-000003 already closed.
2. **Contract active:** Automatic Invoices lists the entry under "Late approved time billed on the next invoice". It names INV-000003 (draft) and the Oct 1 – Oct 31, 2026 period. The November preview shows the same notice and a line labelled `late time, service period 2026-10-01 – 2026-10-31`.
3. **Contract terminated:** the same entry moves to the warning "Approved time that no invoice will bill (1)". The warning names the entry, the closed period, INV-000003 and the operator's options. The October preview shows the same warning.
4. **Checks:** the entry is still approved and uninvoiced.
5. **Cleanup:** everything was reverted through the product, and INV-000003 is unchanged.

Scenario 2 details:

1. **Setup:** a disposable hourly contract on "CM-REVIEW-20261026-01 Cancel-3", created through the contract wizard.
2. **First draft:** QA logs 30 minutes and gets it approved. The October window is generated as draft INV-000007.
3. **Late entry:** Glinda, a second technician, logs 30 minutes inside October after the draft exists, and QA approves it. Automatic Invoices names her entry as late time closed by INV-000007 (draft).
4. **Reverse:** reversing INV-000007 removes the late-time listing.
5. **Regenerate:** the regenerated October draft bills both entries, with no late-time label.

Scenario 4 details:

- **Setup:** Alice grants Collaborate on her requester-visible project.
- **Posts:** QA posts Shared IT, MSP-private and Requester messages on the shared task; Alice posts a customer-private one.
- **Alice:** sees Shared IT and Requester, never the MSP-private note.
- **QA:** sees his MSP-private note, never Alice's private one.
- **Requester (client portal):** sees only the Requester message.
- **Storage:** the database holds three customer-owned task comments, and the MSP-private note only in the MSP store.
- **Cleanup:** the grant was removed.

Scenario 5 details:

- **Setup:** QA records 30 minutes of MSP commercial time on shared ticket 000016.
- **Edit:** he then edits that entry from his timesheet to 45 minutes with a corrected note.
- **Result:** it is the same entry, with `updated_by` set to QA. It keeps its qualified co-managed work reference, contract line and `commercial` mode.
- **Customer view:** Alice's view of the ticket never shows the MSP time note.
- **Cleanup:** the entry was deleted.

## Decisions recorded and tested

- **Ended or terminated contract, or a final period:** late time stays approved and uninvoiced, and is named in a warning on Automatic Invoices and in every preview for the client. The warning offers two options: restore or extend the line, or reverse a draft that closed the period and generate it again. This replaces silent omission. (Native and co-managed integration tests; scenario 1.)
- **Drafts close their window:** the product cannot regenerate a draft in place, and existing drafts must keep their contents, so late time carries forward and is listed. Reversing the draft (an explicit operator action) reopens the window, and the time rebills with it, unlabelled. (Integration test; scenario 2.)
- **Voided (cancelled) invoices close their window too.** This departs from the review's premise that voiding reopens a window. `voidInvoice` keeps the recurring period's claim, and regenerating the window is refused ("recurring service period … is already claimed by invoice …"). Excluding voided invoices would strand their late time with no notice. It now carries forward, named with the voided invoice. (Integration test with the real finalize and void actions.)

## Not exercised at runtime

- **Voiding.** A void is permanent. Demonstrating it needs a late entry approved after the void, on a sheet that would then stay approved with invoiced entries. That would also leave two pre-existing White Rabbit entries on QA's sheet approved. It is covered by the product-action integration test instead.
- **T09 still lacks** explicit task disclosure (preview, confirmation and receipts) and task notification and email delivery on this build.
- **T13 still lacks** catalog-priced time with a real catalog price, and customer operational time on this build.
- **Unchanged from earlier rounds:** T17 (lifecycle grace expiring mid-operation), F015 (worker failure and cleanup acknowledgement), T18 restore (needs an isolated destination), and the external rows.

## Findings

- **New defect (pre-existing, also on `main`; not fixed because it blocks no listed scenario):** `deleteWorkItem` (timesheet "delete work item") deletes every time entry for the work item tenant-wide, across all users and sheets. In scenario 2's cleanup, QA's row delete also removed Glinda's entry from her own sheet, so her own delete step found nothing and the recording failed at that step.
- **Infrastructure:** a Docker snap auto-refresh restarted the database containers during the first T09 attempt (kept in [attempts/](attempts/)). The scenario was re-run in full afterwards.

## Data left behind

- **Kept:**
  - the disposable contract "LATE-2D00 reopen contract (disposable)", terminated, with its open ticket on Cancel-3
  - T09 task messages on the requester project
  - `T09-2D00` markers
  - QA's and Glinda's sheets in Changes Requested
- **Restored:** the White Rabbit contract (inactive), the billing emails (cleared), the disposable teams (deleted) and the project grant (removed).
- **Untouched:** INV-000003 ($425, 17 sources) and the previously reversed INV-000002.

Attribution is in [requirement-attribution.json](requirement-attribution.json).
