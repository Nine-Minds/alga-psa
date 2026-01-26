# Workflow Fixture Harness (V1)

Runs a single workflow fixture end-to-end:

1) Import a workflow bundle (`bundle.json`)
2) Run the fixture trigger/assertions script (`test.cjs`)
3) Print a PASS/FAIL single-line summary (plus optional JSON)

Fixture root (Enterprise):
- `ee/test-data/workflow-harness/`

## Usage

```bash
node tools/workflow-harness/run.cjs \
  --test ee/test-data/workflow-harness/ticket-created-hello \
  --base-url http://localhost:3010 \
  --tenant <tenantId> \
  --cookie-file /path/to/cookie.txt \
  --force
```

Notes:
- `--cookie` / `--cookie-file` should be the raw `Cookie` header value (e.g. `next-auth.session-token=...`).
- `--tenant` sets `x-tenant-id` so the server runs in the correct tenant context.
- DB assertions require Postgres connectivity. Set `DATABASE_URL` (or pass per-flag overrides; see `--help`).

