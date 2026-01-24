# @alga-psa/extension-runtime

Utility types and helper functions for Alga extension components compiled with [`componentize-js`](https://github.com/bytecodealliance/componentize-js).

## Installation

```bash
npm install @alga-psa/extension-runtime
```

## Usage

```ts
import { Handler, jsonResponse } from '@alga-psa/extension-runtime';

export const handler: Handler = async (request, host) => {
  const secret = await host.secrets.get('alga_api_key');
  await host.logging.info(`Handling request for ${request.context.tenantId}`);
  return jsonResponse({ ok: true, secret, path: request.http.path });
};
```

The helpers mirror the WIT definitions in `ee/runner/wit/extension-runner.wit`.

## Host Bindings

The `HostBindings` interface provides access to host capabilities:

### Context
```typescript
host.context.get(): Promise<ContextData>
```
Get execution context (tenant, extension, request IDs).

### Secrets
```typescript
host.secrets.get(key: string): Promise<string>
host.secrets.list(): Promise<string[]>
```
Access install-scoped secrets. Requires `cap:secrets.get`.

### HTTP
```typescript
host.http.fetch(request: HttpRequest): Promise<HttpResponse>
```
Make outbound HTTP requests. Requires `cap:http.fetch`.

### Storage
```typescript
host.storage.get(namespace: string, key: string): Promise<Uint8Array | null>
host.storage.put(entry: StorageEntry): Promise<void>
host.storage.delete(namespace: string, key: string): Promise<void>
host.storage.list(namespace: string): Promise<StorageEntry[]>
```
Key-value storage. Requires `cap:storage.kv`.

### Logging
```typescript
host.logging.info(message: string): Promise<void>
host.logging.warn(message: string): Promise<void>
host.logging.error(message: string): Promise<void>
```
Emit structured logs. Requires `cap:log.emit`.

### UI Proxy
```typescript
host.uiProxy.callRoute(route: string, payload?: Uint8Array): Promise<Uint8Array>
```
Call host-mediated proxy routes for UI flows. Requires `cap:ui.proxy`.

### User
```typescript
host.user.getUser(): Promise<UserData>
```
Get current user information. Requires `cap:user.read` (granted by default).

```typescript
interface UserData {
  tenantId: string;
  clientName: string;
  userId: string;
  userEmail: string;
  userName: string;
  userType: string;  // "internal" or "client"
}
```

### Scheduler
```typescript
host.scheduler.list(): Promise<ScheduleInfo[]>
host.scheduler.get(scheduleId: string): Promise<ScheduleInfo | null>
host.scheduler.create(input: CreateScheduleInput): Promise<CreateScheduleResult>
host.scheduler.update(scheduleId: string, input: UpdateScheduleInput): Promise<UpdateScheduleResult>
host.scheduler.delete(scheduleId: string): Promise<DeleteScheduleResult>
host.scheduler.getEndpoints(): Promise<EndpointInfo[]>
```
Manage scheduled tasks. Requires `cap:scheduler.manage`.

### Invoicing
```typescript
host.invoicing.createManualInvoice(input: CreateManualInvoiceInput): Promise<CreateManualInvoiceResult>
```
Create draft manual invoices. Requires `cap:invoice.manual.create`.

## Helper Functions

### jsonResponse
```typescript
jsonResponse(body: unknown, init?: Partial<ExecuteResponse>): ExecuteResponse
```
Create a JSON response with proper headers.

### emptyResponse
```typescript
emptyResponse(status?: number): ExecuteResponse
```
Create an empty response (default status 204).

### createMockHostBindings
```typescript
createMockHostBindings(overrides?: Partial<HostBindings>): HostBindings
```
Create mock host bindings for testing.

## Using WIT Imports

When building with jco componentize, host capabilities are imported from WIT modules. Create a wrapper `index.ts`:

```typescript
// Import WIT functions
// @ts-ignore
import { getUser } from 'alga:extension/user';
// @ts-ignore
import { logInfo } from 'alga:extension/logging';

// Build HostBindings
const host: HostBindings = {
  user: { getUser: async () => getUser() },
  logging: { info: async (msg) => logInfo(msg), /* ... */ },
  // ... other bindings
};

export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return myHandler(request, host);
}
```

See [User Host API Guide](../docs/guides/user-host-api.md), [Scheduler Host API Guide](../docs/guides/scheduler-host-api.md), and [Invoicing Host API Guide](../docs/guides/invoicing-host-api.md) for complete examples.

## Building

Run `npm run build` before publishing.
