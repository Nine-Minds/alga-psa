# DataTable Integration Guide (Iframe UI + UI Kit)

This guide shows how to use the Alga UI Kit DataTable inside an extension’s iframe app, fetching data via the gateway (`/api/ext/[extensionId]/[[...path]]`) and following best practices for performance, security, and UX. In the v2 architecture:
- All server calls go through the API Gateway and are executed by the Runner (`POST /v1/execute`).
- UI assets are served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`.
- The host constructs the iframe URL via [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and initializes with [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45).
- Reference gateway scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)

## Overview

- UI renders in a sandboxed iframe
- Use `@alga/ui-kit` components and `@alga/extension-iframe-sdk` for host integration
- All server calls go through the gateway and are executed by the Runner

## Prerequisites

- An iframe app (React recommended) scaffolded with Vite/Next
- Installed SDKs:
  - `@alga/extension-iframe-sdk`
  - `@alga/ui-kit`

## Basic Table

```tsx
import React from 'react';
import { DataTable } from '@alga/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { useExtension } from '@alga/extension-iframe-sdk';

export default function AgreementsTable() {
  const { context } = useExtension(); // provides tenant/extension context, auth bridge
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const columns = useMemo(() => [
    { key: 'name', header: 'Agreement Name', sortable: true },
    { key: 'vendor', header: 'Vendor', sortable: true },
    { key: 'status', header: 'Status', sortable: true },
    { key: 'amount', header: 'Amount' }
  ], []);

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const qp = new URLSearchParams({ page: String(page), limit: String(pageSize) });
        const url = `${context.gatewayBase}/api/ext/${context.extensionId}/agreements?${qp}`;
        const res = await fetch(url, { signal: abort.signal, headers: context.authHeaders });
        if (!res.ok) throw new Error('Request failed');
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.data ?? [];
        setRows(list);
        setTotal((data.meta && data.meta.total) || list.length);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => abort.abort();
  }, [context.extensionId, context.gatewayBase, context.authHeaders, page, pageSize]);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      loading={loading}
      pagination={{
        page,
        pageSize,
        total,
        onPageChange: setPage,
        onPageSizeChange: setPageSize,
        pageSizeOptions: [10, 25, 50, 100]
      }}
      onSortChange={(sort) => {
        // Optionally re‑fetch with sort params
      }}
    />
  );
}
```

Notes:
- `context.gatewayBase` and `context.authHeaders` are provided by the SDK bridge
- The gateway applies header allowlists and enforces timeouts; the Runner executes the handler

## Custom Cells and Actions

```tsx
import { Button, Badge } from '@alga/ui-kit';

const columns = [
  {
    key: 'name',
    header: 'Agreement Name',
    sortable: true,
    cell: (row: any) => (
      <a className="text-blue-600 hover:underline" href={`#/agreements/${row.id}`}>{row.name}</a>
    )
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row: any) => (
      <Badge variant={row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'secondary'}>
        {row.status}
      </Badge>
    )
  },
  {
    key: 'amount',
    header: 'Amount',
    cell: (row: any) => (
      <span className="font-medium">{row.currency} {Number(row.amount).toLocaleString()}</span>
    )
  },
  {
    key: 'actions',
    header: '',
    cell: (row: any) => (
      <Button variant="ghost" size="sm" onClick={() => console.log('Actions for', row.id)}>Actions</Button>
    )
  }
];
```

## Data Fetching Patterns

- Always go through the gateway: `/api/ext/${extensionId}/...`
- Expect either an array or `{ success, data, meta }`
- Propagate only SDK‑provided auth headers; do not attach end‑user tokens directly

## Performance Tips

- Server‑side: perform data transformation in handlers executed by the Runner
- Client‑side: memoize column definitions; avoid heavy computations in cell renderers
- Use pagination and server‑side filtering/sorting when lists are large

## Error and Loading States

- Display loading indicators while fetching
- Show concise error messages; avoid leaking internal details
- Consider retry UI for transient errors (e.g., 502 from Runner)

## Security Considerations

- Do not attempt cross‑origin requests; route everything through `/api/ext/...`
- Avoid evaluating code or templates at runtime
- Keep sizes small; large responses may be rejected by gateway caps

## Example Handler (Runner)

Manifest v2 declares an endpoint, e.g.: `GET /agreements` → `dist/handlers/http/list_agreements`

Handler (conceptual):
```ts
export async function list_agreements(ctx) {
  // Use host APIs via ctx: storage, http.fetch, secrets, log, metrics
  const items = await ctx.storage.list({ namespace: 'agreements' });
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { data: items }
  };
}
```

## Related References

- Gateway route scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Iframe bootstrap and src builder: [server/src/lib/extensions/ui/iframeBridge.ts](../../../server/src/lib/extensions/ui/iframeBridge.ts:38)
- Runner overview: [runner.md](runner.md)
- Manifest and signing: [manifest_schema.md](manifest_schema.md), [security_signing.md](security_signing.md)
