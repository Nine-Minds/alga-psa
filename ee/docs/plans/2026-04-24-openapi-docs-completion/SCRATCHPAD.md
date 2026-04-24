# SCRATCHPAD: Complete OpenAPI Documentation Coverage

## 2026-04-24 — Plan Created

### Branch / Worktree

- Worktree: `/Users/roberisaacs/alga-psa.worktrees/docs/api-docs-input-output`
- Branch: `docs/api-docs-input-output`
- Existing uncommitted local file to avoid: `.env.localtest`

### Current Progress Baseline

- Completed batches: 1–16 (80 operations).
- Latest pushed commit at plan creation: `e733631bf docs(openapi): document asset history and automation execution routes`.
- Remaining CE placeholder count: `488`.
- Progress tracker: `/tmp/alga-openapi-doc-progress.md`.

### Required Commands

Regenerate CE/legacy specs:

```bash
npm --prefix sdk run openapi:generate
```

Regenerate EE specs:

```bash
npm --prefix sdk run openapi:generate -- --edition ee
```

Placeholder scan pattern:

```bash
python3 - <<'PY'
import json
spec=json.load(open('sdk/docs/openapi/alga-openapi.ce.json'))
items=[]
for path, methods in spec['paths'].items():
  for method, op in methods.items():
    if isinstance(op,dict) and ('generated automatically' in op.get('description','') or (op.get('extensions') or {}).get('x-placeholder')):
      items.append((path,method.upper(),op.get('summary')))
print('remaining', len(items))
for row in items[:50]:
  print(row)
PY
```

### Batch Workflow Decisions

- Continue in batches of 5 operations.
- Use subagents for investigation where possible.
- Preferred model: `deepseek/deepseek-v4-pro`.
- Investigators are read-only and should report source evidence, auth/security, tenant behavior, inputs, outputs, statuses, and ID provenance.
- Main agent writes registrars and generated specs.
- Commit/push periodically.
- Do not stage `.env.localtest`.

### Registrar Rules

- Put domain registrars under `server/src/lib/api/openapi/routes/`.
- Import/register new registrars in `server/src/lib/api/openapi/index.ts` before `registerInventoryBackfillRoutes`.
- Manual route registration key is method+path. If manual route is registered before inventory backfill, placeholder is skipped.
- Prefer actual source behavior over intended behavior when they differ.
- When source has implementation bugs, document them in descriptions/extensions rather than fixing runtime code.

### Current Remaining Placeholder Domains (CE)

Total: `488` placeholders.

Top route families at plan creation:

- 37 `/api/v1/integrations`
- 37 `/api/v1/quickbooks`
- 37 `/api/v1/webhooks`
- 34 `/api/v1/workflows`
- 31 `/api/v1/invoices`
- 29 `/api/v1/financial`
- 26 `/api/v1/users`
- 24 `/api/v1/contract-lines`
- 22 `/api/v1/teams`
- 21 `/api/v1/quotes`
- 19 `/api/v1/tags`
- 18 `/api/v1/projects`
- 17 `/api/v1/time-entries`
- 17 `/api/v1/time-sheets`
- 14 `/api/v1/automation`
- 14 `/api/v1/categories`
- 12 `/api/v1/tickets`
- 10 `/api/v1/roles`
- 9 `/api/v1/clients`
- 8 `/api/v1/contacts`
- 8 `/api/v1/meta`
- 8 `/api/v1/time-periods`
- 7 `/api/v1/permissions`
- 7 `/api/v1/schedules`
- 4 `/api/v1/contracts`
- 4 `/api/v1/user`
- 3 `/api/v1/client-contract-lines`
- 2 `/api/v1/feature-flags`
- 2 `/api/v1/contract-line-templates`
- 2 `/api/v1/rbac`
- 1 `/api/v1/billing-analytics`
- 1 `/api/v1/feature-access`
- 1 `/api/v1/permission-checks`
- 1 `/api/v1/test-auth`
- 1 `/api/v1/user-roles`

### Next Batch at Plan Creation

Batch 17:

1. `GET /api/v1/automation/performance`
2. `GET /api/v1/automation/rules`
3. `POST /api/v1/automation/rules`
4. `POST /api/v1/automation/rules/bulk-execute`
5. `POST /api/v1/automation/rules/bulk-status`

### Known Gotchas Discovered So Far

- Some v1 asset routes have edge middleware that checks only `x-api-key` presence, but route files lack a wrapper that sets `req.context`; these routes can fail with `Request context not available`. Document actual behavior.
- Several controllers return v2 HATEOAS links from v1 routes. Document where observed.
- Some service methods throw generic `Error` for not-found/invalid state, producing 500 rather than expected 404/400. Document current behavior.
- Some inventory routes point to missing route files. Document as inventory-only/missing-handler rather than inventing behavior.
- `deepseek/deepseek-v4` failed earlier; `deepseek/deepseek-v4-pro` is the working provider-qualified model when provider balance is available.

### Commit Discipline

Before every commit:

```bash
git status --short
```

Expected persistent unstaged file:

```text
 M .env.localtest
```

Do not `git add .`; stage exact registrar/spec/plan files only.

## 2026-04-24 — Batch 17 Completed (Automation Rules/Performance + Remaining Automation Family)

### Scope completed

- Documented all remaining placeholder automation endpoints in `server/src/lib/api/openapi/routes/automation.ts`:
  - `GET /api/v1/automation/performance`
  - `GET /api/v1/automation/rules`
  - `POST /api/v1/automation/rules`
  - `POST /api/v1/automation/rules/bulk-execute`
  - `POST /api/v1/automation/rules/bulk-status`
  - `DELETE /api/v1/automation/rules/{id}`
  - `GET /api/v1/automation/rules/{id}`
  - `PUT /api/v1/automation/rules/{id}`
  - `POST /api/v1/automation/rules/{id}/execute`
  - `GET /api/v1/automation/statistics`
  - `GET /api/v1/automation/templates`
  - `POST /api/v1/automation/templates`
  - `GET /api/v1/automation/templates/{id}`
  - `POST /api/v1/automation/templates/{id}/use`

### Key source-grounded decisions (with rationale)

- Documented service/controller mismatch where `manualExecutionSchema` requires `automation_rule_id` in request body but execution uses path `/rules/{id}`. Kept this explicit in schema/description to avoid hiding runtime behavior.
- Documented known 500-vs-404/400 gaps where `AutomationService` throws generic `Error` for not-found or invalid-state conditions.
- Documented query-array parsing gap on performance route because controller query parsing (`validateQueryParams`) maps URL params to string values while schema expects arrays for `rule_ids` and `metrics`.
- Preserved tenant/RBAC metadata using base-controller auth flow (`x-api-key` + optional `x-tenant-id`, `hasPermission` against resource `automation`).

### Commands / runbook executed

```bash
npm --prefix sdk run openapi:generate
npm --prefix sdk run openapi:generate -- --edition ee
python3 <placeholder scan script for CE+EE targeted automation ops + remaining counts>
```

### Validation results

- CE targeted automation placeholder check: all 14 automation operations now non-placeholder.
- EE targeted automation placeholder check: all 14 automation operations now non-placeholder.
- Remaining placeholder counts after batch:
  - CE: `474` (down from 488)
  - EE: `482`

### Updated next cursor

- Next unresolved CE operations:
  1. `GET /api/v1/billing-analytics/overview`
  2. `GET /api/v1/contract-lines`
  3. `POST /api/v1/contract-lines`
  4. `DELETE /api/v1/contract-lines/bulk`
  5. `POST /api/v1/contract-lines/bulk`

### Gotchas reinforced

- OpenAPI registry request bodies must be registered as `request: { body: { schema: ... } }`; passing the schema directly (`body: Schema`) causes `zod-to-openapi` generation failure.
