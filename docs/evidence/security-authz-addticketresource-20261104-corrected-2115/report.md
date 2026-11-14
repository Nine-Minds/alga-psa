# Corrected live evidence: ticket-resource record authorization

**Application source revision tested:** `ea8086eb4c993e208a5ca25c694ea081a4a809f6` (also in `revision.txt`). The app source at this revision includes the invalid-agent error mapping.

**Origin/runtime:** `http://feature-security-authz-in-addticketresource.localhost:3751`, served by this worktree's `server/` process. Local headless Chrome via Playwright was used; no card-owned browser pane. The canonical QA account was used for the scoped Quick Add and invalid-staffing check. Separate existing local fixtures were used for resource record-policy and Team UI checks. Temporary fixture passwords were restored after the run.

## Why the prior denial evidence was withdrawn

The prior report's denied operations used canonical QA while its active restrictions caused the coarse `hasPermission` checks to fail first. Their `Cannot view/add/remove ticket resource` messages did not exercise record authorization. Those response/snapshot files were removed. The earlier report now points here and explicitly disclaims those results.

## Current live observations

- **Canonical QA Quick Add, restrictions active:** Before creation, QA retained four active authorization bundle assignments; exact IDs/names are in `canonical-qa-active-restrictions.json`. Created `TIC001286` (`a61a9895-a1d6-4f31-bfda-7c7d1280cbca`) from Quick Add with primary Dorothy Gale and additional agent QA Tester. Both persisted in the database, and creation/assignment audit plus workflow events are captured in `scoped-quickadd-*`. The restriction assignments remained active.
- **Coarse permissions pass, visible record allowed:** The isolated client-portal fixture principal `smoke-authz-3039@example.com` (`2582ac47-d979-4d61-8a58-cc79b944de80`) has effective ticket `read` and `update` permissions as Admin. Against its policy-visible ticket `SMK3039-visible` (`b9c37b04-7c26-4c10-a0d2-737c6b77278c`), resource read returned the current list, add returned assignment `88a12866-8fdf-49a9-83fa-d0dab032940a`, a second read returned that assignment, and remove succeeded. The raw action envelopes are in `visible-resource-operations.json`.
- **Same principal, policy-hidden record denied at the record layer:** `SMK3039-hidden` (`aa569323-8532-4812-8423-fb0bfd9dd505`) belongs to the same client but is outside that contact's visible-board scope. Read, add, and removal by known assignment ID `b7ebc014-9c5b-4de9-a9d4-667b24532ebb` each returned `Permission denied: Cannot access ticket`. This differs from the coarse permission error and demonstrates the record authorization path ran. The principal's role/read/update permissions and exact before/after ticket staffing, audit, and workflow snapshots are in `hidden-record-denials-and-unchanged-state.json`; the snapshots compare equal. The temporary hidden assignment and primary assignee used to create a known-ID removal case were restored/removed after evidence capture. An earlier probe used a route matcher that missed React’s `_1_additional_agent_ids` multipart field and created valid-staffing ticket `TIC001285`; it is not counted as invalid-staffing evidence. The corrected field-specific probe is the `v5` case below.
- **Team UI remove/re-add:** Separate internal Admin fixture `smoke-authz-1251@example.com` (`30391251-0000-4000-8000-000000000001`) used the ticket Team UI on `TIC001280` (`dd1db14a-e30f-42cc-abd1-2f38523f287a`). Removing Dorothy persisted zero additional assignments; re-adding Dorothy persisted one assignment and the reloaded Team UI displayed her. The database audit delta contains the unassignment and assignment. Details and screenshots are in `team-ui-remove-readd.json`, `team-ui-removed.png`, and `team-ui-readded.png`.
- **Invalid staffing rollback through the real browser form:** With the four canonical QA restrictions still active, Playwright submitted Quick Add normally. Its route handler changed only the multipart `_1_additional_agent_ids` field from the selected valid agent to the invalid UUID `00000000-0000-4000-8000-000000000000`; the request reached the compiled `addTicket` action. It returned HTTP 200 with an application `actionError`: “One or more selected agents cannot be assigned. Choose active internal agents and try again.” The UI displayed that validation message. Ticket, audit, and workflow row counts for probe title `Authz Invalid Agent Browser Rollback 20261104 v5` were all zero (`invalid-staffing-*`). This verifies the ticket creation transaction rolled back instead of partially creating the ticket.

## Repair and checks

The browser run first exposed that `HumanWorkAssigneeInvalidError` escaped `addTicket` as an unhandled server error. `ticketActionErrorFrom` now maps its stable error code to a user-safe action error without returning the invalid user ID. A focused unit test covers the mapping, and the ticket-create integration regression now asserts the returned action error plus rollback effects.

- Focused integration suites: **54 passed** across ticket resource assignment (26), ticket create extras (10), and human-work guard (18).
- Focused error-mapper test: **1 passed**.
- Tickets package typecheck: **passed**.
- `npx nx build @alga-psa/tickets`: **passed** (Nx reused cached outputs for 28 dependency tasks).
- The `security-finding-resolved` check remains unavailable locally; this report makes no acceptance-verdict claim.

Canonical QA restrictions were not changed. Temporary passwords for the isolated local fixtures were restored, and the temporary hidden-ticket database fixture was removed after snapshots were saved.
