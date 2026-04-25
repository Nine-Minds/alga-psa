# SCRATCHPAD: Type OpenAPI Success Response Data Schemas

## 2026-04-25 — Plan Created

### Branch / Worktree

- Worktree: `/Users/roberisaacs/alga-psa.worktrees/docs/api-docs-input-output`
- Branch: `docs/api-docs-input-output`
- PR: https://github.com/Nine-Minds/alga-psa/pull/2395
- Do not stage or commit pre-existing `.env.localtest`.

### Problem Trigger

User spot-checked `GET /api/v1/clients/{id}` and found generated SDK/docs type `data` as `any`.

Investigation showed the generated operation points to `ClientContactApiSuccess`, whose `data` property comes from `zOpenApi.unknown()` and becomes an empty OpenAPI schema `{}`.

### Root Cause

The placeholder-removal pass added real route descriptions and response envelopes, but several route-family registrars used generic success components like:

```ts
zOpenApi.object({
  data: zOpenApi.unknown(),
  meta: zOpenApi.record(zOpenApi.unknown()).optional(),
})
```

In OpenAPI, `unknown` emits as `{}`. SDK/type generators interpret `{}` response payloads as `any` or an unhelpful unconstrained type.

### Baseline Scan Result

CE generated spec currently has 10 components where `properties.data` is exactly `{}`:

- `AccessApiSuccessV1`
- `BillingOverviewResponse`
- `ClientContactApiSuccess`
- `ContractLineApiSuccess`
- `FinancialInvoiceApiSuccess`
- `MetaUtilityApiSuccessV1`
- `QuickBooksV1ApiSuccess`
- `QuotesContractsApiSuccessV1`
- `WebhookApiSuccessV1`
- `WorkV1ApiSuccess`

Approximate total success-response uses: 395.

### Baseline Scan Command

```bash
python3 - <<'PY'
import json
from collections import defaultdict
spec=json.load(open('sdk/docs/openapi/alga-openapi.ce.json'))
any_names=set()
for name,s in spec['components']['schemas'].items():
    if isinstance(s,dict) and (s.get('properties') or {}).get('data')=={}:
        any_names.add(name)
uses=[]
for path,methods in spec['paths'].items():
    for method,op in methods.items():
        if not isinstance(op,dict):
            continue
        for status,resp in (op.get('responses') or {}).items():
            content=(resp.get('content') or {}).get('application/json') or {}
            sch=content.get('schema') or {}
            ref=sch.get('$ref')
            if ref:
                name=ref.split('/')[-1]
                if name in any_names:
                    uses.append((name,method.upper(),path,status))
print('components with data any:', len(any_names), sorted(any_names))
print('uses:', len(uses))
by=defaultdict(list)
for n,m,p,s in uses:
    by[n].append(f'{m} {p} {s}')
for n in sorted(by):
    print('\n', n, len(by[n]))
    for u in by[n][:20]:
        print('  ',u)
PY
```

### Client Detail Evidence

`GET /api/v1/clients/{id}` path:

- Route: `server/src/app/api/v1/clients/[id]/route.ts`
- Controller: `server/src/lib/api/controllers/ApiClientController.ts`
- Base behavior: `server/src/lib/api/controllers/ApiBaseController.ts`, `getById()`
- Service: `server/src/lib/api/services/ClientService.ts`, `getById()`
- Source schema: `server/src/lib/api/schemas/client.ts`, `clientResponseSchema`

Runtime response envelope is from `createSuccessResponse(resource)`:

```json
{
  "data": { ...client fields... }
}
```

`ClientService.getById()` selects `c.*`, joins account manager display name as `account_manager_full_name`, and appends `logoUrl`.

### Required Validation Commands

Regenerate CE/legacy:

```bash
npm --prefix sdk run openapi:generate
```

Regenerate EE:

```bash
npm --prefix sdk run openapi:generate -- --edition ee
```

Placeholder scan:

```bash
python3 - <<'PY'
import json
for f in ['sdk/docs/openapi/alga-openapi.ce.json','sdk/docs/openapi/alga-openapi.ee.json']:
    spec=json.load(open(f))
    cnt=0
    for path, methods in spec['paths'].items():
        for method, op in methods.items():
            if isinstance(op,dict) and ('generated automatically' in op.get('description','') or (op.get('extensions') or {}).get('x-placeholder')):
                cnt += 1
    print(f, cnt)
PY
```

Extension-v2 guard:

```bash
npm run guard:ext-v2
```

### Implementation Notes

- Prefer operation-specific typed envelopes over one generic `ApiSuccess` per broad registrar.
- If a response is paginated, model `data: array(item)` plus `pagination` and `meta`.
- If a response is `{ data: [] }` TODO/stub, still type it as `array(object)` or the expected item schema where source makes that clear.
- Avoid `zOpenApi.unknown()` directly under `data`.
- `meta` may remain a bounded record where source metadata varies; the user-reported problem is `data` becoming `any`.

### Commit Discipline

Before every commit:

```bash
git status --short
```

Expected persistent unstaged local change:

```text
 M .env.localtest
```

Stage exact files only; do not `git add .`.
