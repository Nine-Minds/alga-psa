# Workflow Bundles (Importable Samples)

This folder contains version-controlled **workflow bundle** JSON files that can be imported into an Alga PSA instance to quickly seed workflows for manual testing.

## Import (CLI)

The repo includes a small CLI wrapper:

```bash
node tools/workflow-bundle-cli/workflow-bundle.js import \
  --base-url http://localhost:3010 \
  --file ee/test-data/workflow-bundles/sample.ticket-created-hello.v1.json \
  --cookie '<your Cookie header>' \
  --tenant "<tenantId>"
```

Notes:
- `--cookie` must be the raw **request** `Cookie` header (only `name=value` pairs, separated by `; `). Do not paste `Set-Cookie` attributes like `Path`, `HttpOnly`, `Expires`, etc.
- `--tenant` sets the `x-tenant-id` header.
