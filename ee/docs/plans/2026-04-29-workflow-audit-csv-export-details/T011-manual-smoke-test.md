# T011 Manual Smoke Test — Workflow Audit CSV Export Details

## Preconditions
- User is logged in as workflow admin.
- At least one tenant/workspace is available.

## Steps
1. Open workflow designer and create a workflow named `CSV Smoke Workflow` with key `csv.smoke.workflow`.
2. Save draft changes twice (change description/settings between saves).
3. Publish version 1.
4. Start a run for version 1 from the workflow details page.
5. Perform at least one run operation (cancel/resume/retry/replay if available in UI).
6. In workflow definition audit tab, click `Export CSV`.
7. In workflow run details audit tab, click `Export` (CSV).

## Expected CSV Validation (Definition Export)
- Header includes business-readable columns first and technical IDs last:
  - `timestamp,event,actor,source,workflow_name,workflow_key,workflow_version,...,actor_user_id,workflow_id,run_id,record_type,operation,audit_id`
- Rows include readable events like `Workflow draft saved`, `Workflow settings updated`, `Workflow published`.
- `actor` is human-readable (name/email), while `actor_user_id` remains present near the end.
- `changed_fields`, `summary`, and `additional_details` are populated when applicable.
- No raw JSON blobs appear in CSV columns.

## Expected CSV Validation (Run Export)
- Rows include readable run events like `Run started`, `Run canceled`, `Run resumed`, `Run retried`, `Run replayed` when applicable.
- Workflow/run context is present (`workflow_name`, `workflow_key`, `workflow_version`, `run_status`).
- Runtime action details appear where present (`step_path`, `action`).
- Trailing technical columns include `workflow_id`, `run_id`, `operation`, and `audit_id`.

## Cross-check JSON Export
1. Repeat export using JSON mode/API route for the same definition or run.
2. Confirm JSON still contains raw redacted rows (not flattened CSV presentation model).

## Pass Criteria
- Both CSV exports are readable without UUID decoding in front columns.
- Support correlation IDs remain in trailing columns.
- JSON export remains raw redacted row output.
