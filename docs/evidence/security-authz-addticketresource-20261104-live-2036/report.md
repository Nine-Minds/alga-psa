# Live authorization mitigation evidence

Tested revision: `1078ea31bc7a32ca98af403ec297bb9ad361f9b4` (recorded in `revision.txt`). Origin: `http://feature-security-authz-in-addticketresource.localhost:3751`. Browser: local headless Google Chrome through Playwright. Canonical QA principal: `qa@emeraldcity.oz`, internal user `20a52aa7-137c-4a42-ab3e-5b75050d54d7`.

## Runtime recovery

The origin initially refused connections and no process listened on 3751. Started the worktree server from `server/` with `PORT=3751 NX_DAEMON=false NX_TUI=false npm run dev`, captured output in `/tmp/security-authz-addticketresource-recovery.log`, and saw startup fail because `CREDENTIAL_ENCRYPTION_KEY` was absent. Ran the repository's `scripts/generate-secrets.sh`, which created the missing ignored secret; restarted the server and verified readiness (`ready on http://0.0.0.0:3751`, origin returned HTTP 200 after redirect to MSP sign-in). Recovered canonical QA login using local Playwright and restored the QA user's original password hash after the run. No card-owned pane was used.

## Executed

- Before creation, QA had four active ticket-scope restrictions; details are in `qa-active-restrictions-before-create.json`. The tenant-wide Admin role grants ticket create/read/update (`qa-rbac-before-create.json`).
- Created Quick Add ticket `TIC001284`, ID `de938db4-80ad-4309-a351-c96eb805e171`, while those restrictions were active. Primary `Dorothy Gale` and additional agent `QA Tester` both persisted (`quick-add-persisted-staffing.json`). Database audit records show both creation and additional-agent assignment; workflow runtime state has `TICKET_CREATED`, `TICKET_ASSIGNED`, and `TICKET_ADDITIONAL_AGENT_ASSIGNED` (`quick-add-ticket-audit.json`, `quick-add-workflow-events.json`).
- Invoked the actual ticket-resource server actions as the same tenant-wide principal against the created ticket and known assignment ID `8ed1931c-c55d-4faa-b128-ec62d9043985`. Resource read, add, and removal each returned their corresponding permission error. Before/after ticket staffing, ticket audit, and workflow event snapshots are byte-equivalent after JSON serialization (`denied-scenario.json`, `denied-before-state.json`, `denied-after-state.json`).
- Opened the created ticket in the MSP UI; record policy returned `Permission denied: Cannot view ticket` while restrictions remained active (`quickadd-ticket-detail.png`).

## Not completed

- Allowed resource operations on a policy-visible ticket and Team UI remove/re-add were not completed. The tested QA principal could not open the created ticket under its active scope, and no separate unrestricted visible-ticket QA session was established during this run.
- Invalid-staffing rollback was attempted through the actual `addTicket` server action with an invalid additional-agent UUID and valid ticket fields. The direct multipart server-action request failed at the Next.js transport layer with `Connection closed`/HTTP 500 before returning an application result. A database query confirmed no ticket with the probe title was created. This does not establish application-level rollback behavior; focused integration tests are the available verification for that behavior.
- `security-finding-resolved` was unavailable in the local environment; no acceptance verdict is claimed.

No source repair was demonstrated as necessary by this run. Evidence contains no browser storage state or credential material. Historical evidence in neighboring folders was not used as a current live pass.

Additional allowed-path recovery attempt: queried existing Mountain Dental tickets (the visible client named by the active ticket-write scope) and opened QA-assigned ticket `TIC001252` (`093e09d4-29e1-4e41-b233-c4b34912a3cd`) in the same authenticated browser. The record policy still returned `Permission denied: Cannot view ticket`, so this principal had no policy-visible record available for allowed resource operations or Team UI remove/re-add during this run. I did not disable or bypass active restrictions to make the UI succeed.
