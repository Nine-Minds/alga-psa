# Guide recordings on production build `build-1792983401994` (source `54e75edfab`)

All 14 recordings (main walkthrough, collection and sections 01–12) were recorded on the production review build served at `http://feature-co-managed-it.localhost:23374`. That build is the evidence-only commit after fix `7e137086e6`; see [../tagmanager/runtime-provenance.json](../tagmanager/runtime-provenance.json).

- **Published at:** `http://100.82.172.57:8874/` (main walkthrough) and `/guides/index.html` (collection and sections).
- **Media path:** `guides/current/54e75edfabfd814edb9ca0685a5e46d0e050a470/`.
- **Rendering:** `docs/guides/co-managed-it/render.cjs` built the pages from [video-coverage.json](video-coverage.json).
- **Main walkthrough page:** the packet root's current-recording section was regenerated from the same coverage row. Its earlier version is kept as `history-before-54e75edf-main.html`.
- **Metadata:** each recording's JSON carries `testedRevision`/`runtime.sourceRevision` `54e75edfab…` and `build.buildId` `build-1792983401994`.

## Coverage ledger

Coverage comes from each guide's `guide-result.json`.

| Guide | Coverage | Duration (s) / chapters | Not reached / missing |
| --- | --- | --- | --- |
| Main ticket-screen walkthrough | covered | 144.3 / 10 | no viewer account in rebuilt data (viewer checks not run) |
| Collection | covered (composition only) | 30.0 / 14 | does not promote any section |
| 01 Onboarding | partial | 157.7 / 5 | worker failure, expired invitation and delivery failure not induced; claimed-workspace cancel refusal checked only by the absent control |
| 02 Licensing and seats | blocked-external | 42.5 / 5 | real Stripe test account and price; signed self-host licence and lapse/renewal fixture (simulator purchase passed) |
| 03 Access policies | partial | 154.3 / 7 | field-visibility limits need an operator-prepared restricted field policy |
| 04 Delegated administration | covered | 129.6 / 7 | |
| 05 Ticket queue | covered | 122.3 / 5 | |
| 06 Projects and tasks | covered | 117.6 / 9 | team-assignment path not exercised (QA is in no team); customer's concurrent save captured in a second browser (screenshot and DB), not on video |
| 07 Conversations and files | covered | 177.0 / 12 | mail delivery and inbound replies are guide 12's scope |
| 08 SLA | covered | 398.9 / 11 | business-hours (non-24/7) timing not tested |
| 09 Time and billing | covered | 118.3 / 7 | QA acts as technician, approver and billing operator |
| 10 Departure and archives | partial | 234.2 / 7 | stale already-open tab write, queued-mail suppression and invoice continuity across departure not run |
| 11 Export, restore and upgrade | blocked-external | 20.5 / 3 | isolated destination installation and operator; destination licence/subscription; customer's own entitlement for upgrade (encrypted export and operator `--inspect` passed) |
| 12 Customer integrations | blocked-external | 52.9 / 5 | approved Entra app with public redirect URI; customer directory/SCIM; inbound mailbox binding |

Notes on the composed recordings:

- **08:** the published WebM is a lossless concat of the main SLA run and its read-only departed-clock supplement (section 5a). This puts every claimed flow in the published video.
- **10:** the published WebM is a lossless concat of part 1 (which ended the relationship) and part 2 (which resumed from part 1's receipt). Part 1's harness assertion on the client view failed, and that failure is recorded in `departure-recording-combined/recording.json`.

Neither WebM had frames altered; chapters are offset by the first part's duration.

## Playback verification

[checks/published-players.json](checks/published-players.json) records the Chrome check of all 14 published players. Each player:

- returns HTTP 206 for `Range` requests;
- loads metadata and advances during playback;
- seeks to every chapter, through the chapter picker or, on the root page, the track cues;
- decodes a frame near the end.

The published WebMs are byte-identical to the committed sources ([media-inventory.json](media-inventory.json)). Scripts: [scripts/player-check.cjs](scripts/player-check.cjs), [scripts/build-coverage.cjs](scripts/build-coverage.cjs), [collection/scripts/collection.cjs](collection/scripts/collection.cjs).

## Product findings surfaced by these recordings (not fixed in this round)

**Privacy and lifecycle**

- **12 (privacy):** a comment posted to the "Shared IT teams" audience is emailed to the ticket's requester. It reproduced three times: the comment is stored `is_internal=false` and a requester delivery row is created. See [12-customer-integrations/probe-shared-audience-mail](12-customer-integrations/probe-shared-audience-mail/).
- **Ended workspaces:** the ticket fields on the main Kansas Farms and guide-10 Accept-7 tickets are disabled. Grid still offers enabled Duplicate, Delete, Create Task, Quick invoice and add-item actions. These were not clicked, so server-side refusal was not verified here. The Kansas co-managed access page shows "Could not load access settings".
- **10:** after departure, the client's Co-managed IT tab defaults to "Co-managed IT not enabled" with a setup form until the ended relationship is picked. The archive's Retained history lists each message twice: the capture event and the cutoff copy.

**Billing (not specific to co-managed)**

- **09:** time charges ignore the contract line's hourly rate and require a USD catalog price; without one, the preview fails with a generic error.
- **09:** the wizard's 15/15 minimum billable time and round-up are not applied.
- **09:** the service editor shows a catalog price that is not stored.

**Smaller items**

- **12:** requester email links point to `:23377`/`:3374`.
- **12:** the first app saved becomes the default and cannot be archived.
- **01:** after a lost response the form says "Retry these same details" but the button keeps its create label.
- **04:** after revocation, the stale editor shows a generic "could not be confirmed / Retry" message instead of saying the approval was revoked.
- **05:** the queue CSV export includes raw tenant, relationship and ticket UUID columns.
- **Provisioning:** `co_managed_provisioning_operations.state` stays `pending_acceptance` after acceptance, while the UI shows Active.

**No longer reproducing**

- **07:** the earlier composer "unknown response clears the draft" defect did not reproduce on this build. The composer kept the text and file, and Retry produced one message.

## Environment observations

- **QA sessions:** QA is limited to 5 concurrent sessions, so parallel recording runs revoked each other's QA sessions. Scripts re-signed in through the real form, and those re-sign-ins are logged.
- **Fixture differences from the brief:**
  - QA had no co-managed technician assignment on White Rabbit at the start. The guide-09 agent added it through the sponsor UI at 03:16Z and left it in place.
  - `noassign@emeraldcity.oz` does not exist in the rebuilt data. Guide 03 created `cm-review-20261026-03-viewer@emeraldcity.oz`.
- **Escalation needs an MSP SLA setup.** Escalation requires an MSP SLA policy for the client and a priority mapping. Guides 03, 05 and 10 created or borrowed one briefly and restored it.
- **Board grants:** escalation-only mode clears board grants by design. In guide 03, White Rabbit had no board grants for 17 s, and an earlier attempt caused a gap of about 2 minutes.

## Data left behind (needs a decision where marked)

- **Needs a decision:** three extra active disposable relationships from failed guide-01 attempts, "CM-REVIEW-20261026-01 Accept IT", "Accept-3 IT" and "Accept-4 IT". Each holds one seat. They were not ended, because departure is permanent and only one relationship was in scope.
- **Ended relationship:** "CM-REVIEW-20261026-01 Accept-7 IT" is kept as the departure and export fixture, with its tickets, files, SLA policy and mappings, and a draft time entry.
- **Seat pool:** the simulator pool rose from 3 to 7 seats. White Rabbit allocation is restored, and the relationship is still active.
- **Cancelled setups:** Cancel, Accept-2, Cancel-3, Cancel-4, Accept-5, Accept-6, Cancel-7, with their clients.
- **Guide records:** guide-suffixed boards, tickets, projects, a requester user, a viewer user and an inactive profile user.
- **SLA:** four unassigned non-default SLA policies; open escalated test tickets.
- **Time and billing:**
  - QA commercial and White Rabbit operational time entries;
  - draft INV-000002 (nothing finalized or emailed);
  - time periods 10/19–11/01;
  - an undeletable Basic Support USD price row.
- **Integrations:** a default simulator app that cannot be archived, and two archived apps.
- **Credentials:** all credentials created are in `/home/robert/card-review-private/co-managed-it-3363/cm-review-20261026-*` (mode 600). None are committed.

Each guide directory keeps its failed attempts under `attempts/`. Attempt JSON is committed; attempt screenshots and WebMs (about 580 MB) stay on disk only.
