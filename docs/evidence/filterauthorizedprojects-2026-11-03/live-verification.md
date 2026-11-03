# Task-detail phase authorization repair: live verification status

## Assignment

Work order: complete the published authorization repair's live verification for PR #4159. Required live cases are in `/tmp/alga-smoke-evidence/filterauthorizedprojects-20261103T160422Z/PLAN.md`.

## Revision and worktree provenance

- Verified branch: `feature/security-authz-in-filterauthorizedprojects`.
- Verified origin branch HEAD before this evidence update: `68e3488f44c109ebfbc754d1514d913e3b87ee0c` (also confirmed with `git ls-remote`).
- This evidence update is the only intended tracked change in this run. Existing `package-lock.json` modification was present at start and is intentionally excluded.
- No task-specific plan was found in `git log main..HEAD --name-only -- docs/plans/`.

## Live environment attempt

- Required URL: `http://feature-security-authz-in-filterauthorizedprojects.localhost:3397`.
- Required board-managed service: `dev-server`, command `PORT=3397 npm run dev`.
- Board service record identifies cwd `/home/robert/alga-copies/feature-security-authz-in-filterauthorizedprojects/server`.
- Recovery was requested with `alga-dev workflow-ensure-service` for the existing card service. The board returned status `suspended` and queued a `resume` request at position 48 on host `robert-X670E-Pro-RS`.
- Latest queue report: needs 6 GB memory; 34 GB free, 17 GB reserved, 8 GB floor; 20 earlier reservations were ahead. The board had also reported that it suspended the service because “Smoke Test” was done and “Draft Implementation” does not use it.
- `ss -ltnp '( sport = :3397 )'` showed no listener. `curl --max-time 3 http://127.0.0.1:3397/api/health` and the required hostname both failed to connect.
- No process was started outside the board. No host workload was changed.

## Cases and outcomes

| Planned case | Outcome | Evidence |
| --- | --- | --- |
| Baseline Wonderland task drawer and authenticated `getTaskWithDetails` response | Not run: server unavailable | Prior blocked-attempt artifacts in `/tmp/alga-smoke-evidence/filterauthorizedprojects-20261103T160422Z/` |
| Redaction aliases (`phase_name`, `fields.phase_name`, `project_phases.phase_name`) in authenticated action responses and drawer | Not run: server unavailable | Same |
| Missing/mismatched and cross-project/cross-tenant phase isolation | Not run: server unavailable | Same |
| Denied-reader behavior | Not run: server unavailable | Same |
| Restored access and baseline parity after cleanup | Not run: no fixtures or authorization changes were made | Same |
| Temporary fixture cleanup | No temporary fixtures created in this attempt | No database writes made |

The required canonical QA login was not attempted because the sign-in page was unreachable. No development-browser workaround was used. No new application defect was established by unavailable infrastructure.

## Other checks and limitations

The prior evidence packet records 48 passing focused behavioral tests and a code inspection of the shared scoped phase projection at `68e3488f44c109ebfbc754d1514d913e3b87ee0c`. Those offline results are supplementary and do not verify runtime authorization, authenticated action responses, or drawer behavior. No repair, build, or typecheck was warranted or run in this blocked attempt.

The `security-finding-resolved` acceptance check was not run; no callable check mechanism was available in the board CLI or enabled tools during this attempt. This report does not assert acceptance-check passage.

## Conclusion

Live verification remains blocked until the board admits and restores the existing dev-server service. Reviewer should first inspect this service-queue evidence and then rerun the supplied plan at the exact origin HEAD. Required live cases remain pending; this is not a verification pass.
