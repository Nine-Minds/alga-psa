# Co-Managed IT review guides

Use these guides to review the customer workspace, collaboration, and relationship lifecycle separately. Start with the ticket-screen walkthrough for the existing White Rabbit fixture, then choose the sections you want to assess.

The [ticket-screen walkthrough](http://100.82.172.57:8874/) links the recorded results and evidence. These source guides are rendered with an explicit runtime revision and 14-row recording coverage file. Consult each recording's scenario result and limitations: a playable recording can show a partial or blocked scenario. Expected results in the instructions are not recorded passes. Preserve the actual application build revision when the checkout contains later documentation or tooling changes.

## Regenerate guide pages

Render to a temporary directory first. The renderer validates the supplied revision against the coverage file, requires all 14 guide rows, and writes completed recordings or blocked JSON and WebVTT scaffolds without changing these source files or fabricating WebM files.

```sh
node docs/guides/co-managed-it/render.cjs /tmp/co-managed-guides \
  --revision "$RECORDED_RUNTIME_REVISION" \
  --publication-revision "$PUBLISHED_GUIDE_REVISION" \
  --coverage /absolute/path/to/video-coverage.json
```

`--publication-revision` is optional and defaults to `--revision`. Use it for
a later documentation-only publication: source links and the guide header use
the publication SHA, while media validation and recording metadata retain the
actual runtime SHA. It never promotes scenario acceptance.

The output directory represents the review packet's `guides/` directory and
contains the collection guide and 12 section guides. Coverage `recordingPaths`
are relative to the packet root, so section artifacts must start with `guides/`.
The renderer removes that prefix when writing them beneath the output directory.
The main walkthrough is maintained in the review packet's root `index.html`
and has its own recording artifacts.

### Render a completed walkthrough

Coverage rows may use `status: "complete"` after the product interaction has
been recorded and checked in a browser. Set `testedRevision`, `recordedAt`,
`durationSeconds`, `actors`, `steps`, `outcomes`, and `chapters`. Set both
`playbackVerified` and `chapterSeekVerified` to `true`. `runtime` must identify
the same `sourceRevision` (or `revision`), and `build.sourceRevision` must match
the candidate. `recordingSourcePaths.webm` and `.chapterVtt` point to files
relative to the coverage JSON. The renderer validates the WebM container and
duration with `ffprobe`, checks the timed VTT chapters, copies the media to
`recordingPaths`, and writes a player with chapter seeking.

Blocked rows still need a blocker and a `missing` list. They must not claim a
recording timestamp or verified playback/chapter seeking. To validate renderer
behavior without product evidence, run `node --test
docs/guides/co-managed-it/render.test.cjs`. That test creates a synthetic clip
in a temporary directory. It is not a walkthrough and must not be added to
acceptance evidence.

## Choose a section

| Guide | What you can assess | Preparation beyond the recorded fixture |
| --- | --- | --- |
| [1. Customer onboarding](01-onboarding.md) | Workspace creation, invitation, acceptance, recovery, cancellation | A new disposable client, administrator mailbox and available seats |
| [2. Licensing and seats](02-licensing-and-seats.md) | Sponsor pool, purchase, allocation and capacity limits | Billing administrator; configured test payment provider or signed test license |
| [3. Access policies](03-access-policies.md) | Boards, projects, staff, teams and individual-ticket grants | Customer administrator and MSP access administrator; disposable scoped work |
| [4. Delegated administration](04-delegated-administration.md) | Customer approval, bounded MSP changes and revocation | An approved technician/team and disposable customer records |
| [5. Ticket queue operations](05-ticket-queue.md) | Filtering, CSV export, bulk return and recovery | Two disposable, MSP-responsible customer tickets for bulk tests |
| [6. Projects and tasks](06-projects-and-tasks.md) | Shared tasks, edits, assignment, history and effort | A new customer project and tasks; none existed in the last fixture catalog |
| [7. Conversations and files](07-conversations-and-files.md) | Audiences, replies, files, thread disclosure and requester access | Small test files; requester account and task access for portal tests |
| [8. SLA configuration](08-sla.md) | Policies, priority mapping and independent responsibility clocks | MSP SLA administrator; disposable ticket for new escalation |
| [9. Time approval and billing](09-time-and-billing.md) | Stopwatch, effort ownership, timesheets and commercial billing | Current time period, service/contract setup, approver and billing operator |
| [10. Departure and archives](10-departure-and-archives.md) | Access cutoff, retained work/files and released allocations | A separate relationship that can be ended permanently |
| [11. Export, restore and independence](11-export-restore-and-upgrade.md) | Encrypted export, operator restore and independent upgrade | Customer administrator; isolated destination and operator for restore; own paid/test entitlement for upgrade |
| [12. Customer-owned integrations](12-customer-integrations.md) | Provider setup, identity, directory and email journeys | Isolated test provider bindings and test mailboxes |

## Fixtures

The review app is [feature-co-managed-it.localhost:23374](http://feature-co-managed-it.localhost:23374/auth/msp/signin). Port 3374 is the development app. The last recorded fixture catalog is from October 17; check the displayed organization and current state before using a record.

| Identity or record | Use |
| --- | --- |
| `qa@emeraldcity.oz` | QA Tester, Oz workspace administrator with a co-managed technician assignment. Confirm the current session and offered controls; do not add grants to bypass a denial. |
| `alice@whiterabbit.test` | White Rabbit IT customer administrator; customer-owned tickets and relationship controls. |
| `noassign@emeraldcity.oz` | MSP viewer. Despite the name, this account has a viewer assignment. |
| [White Rabbit client](http://feature-co-managed-it.localhost:23374/msp/clients/151ce95d-225d-4756-be83-89580d04ef22?tab=co-managed) | Existing client relationship and Co-managed IT view. Last recorded allocation: two seats. |
| [Ticket 000002, MSP](http://feature-co-managed-it.localhost:23374/msp/co-management/tickets/1f98df77-cd15-44c2-8f4d-42ff52d01e84/c7de2b20-f1d9-4374-b7bb-c223f681955e/cfff4242-7962-4100-a54c-687eaa540500) | Shared detail; last recorded MSP-responsible and unassigned. |
| [Ticket 000002, customer](http://feature-co-managed-it.localhost:23374/msp/tickets/cfff4242-7962-4100-a54c-687eaa540500) | Same authoritative ticket, viewed as Alice. |
| [Native Oz ticket TIC001011](http://feature-co-managed-it.localhost:23374/msp/tickets/5a9fda39-4057-4e0f-81f0-e5e9d5cd23ce) | Control for ordinary MSP ticket behavior. |

Open Review must enter directly as `qa@emeraldcity.oz`; confirm the avatar and Oz organization before starting. Do not switch to Glinda or broaden QA's grants to work around a missing staff assignment. The record IDs in this guide are historical pointers only: verify each organization, relationship and record in the current app before navigating or changing it.

## Review order and retained changes

For a full review, follow guides 1–9, then integrations, export and restore, and finally upgrade or departure on **separate disposable relationships**. Upgrade and departure end live trust; the active White Rabbit relationship supports the existing ticket review and should remain available.

Use a unique suffix such as `CM-REVIEW-20261018-A` for new records and messages. Record the account, organization, record link, initial state, action, result after reload, and any retained effect. Preserve sent messages, recorded time and financial evidence. Restore reversible settings to their original values. Do not use old September fixture IDs or reset scripts against the rebuilt database.

## Record results

For each flow record **Pass**, **Fail**, **Blocked**, or **Not run**, with a screenshot or record link. A missing project, provider binding, approver or entitlement is a preparation blocker, not a pass. If a save has an uncertain outcome, recover the same operation through the offered retry before submitting another.

These guides do not change the card's approval, CI, merge or production-readiness status. Real payment-provider, licensing, identity and deployment acceptance remain separate from simulator-based review.

## Source references

- [Client management composition](../../../server/src/components/co-managed/CoManagedClientView.tsx)
- [Whole-card completion requirements](../../plans/2026-09-20-co-managed-it-completion/PRD.md)
- [Native ticket screen requirements](../../plans/2026-10-15-co-managed-native-ticket-screen/PRD.md)
