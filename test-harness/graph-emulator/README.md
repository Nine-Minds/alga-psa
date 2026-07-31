# Microsoft Graph emulator

Minimal OAuth, Microsoft Graph and CIPP surface for smoke-testing the Microsoft
integrations without a real tenant. It is stateful only in memory and is not
intended for production use.

Run it directly:

```bash
npm start
```

or with Docker:

```bash
docker compose up --build
```

Point the Alga server at it with:

```bash
MICROSOFT_LOGIN_BASE_URL=http://127.0.0.1:4010
MICROSOFT_GRAPH_BASE_URL=http://127.0.0.1:4010/v1.0
```

`npm test` starts isolated emulators and verifies the OAuth client pin, message
listing, the subscription validation handshake, notification push, and the whole
Entra surface below.

## Inbound email

The control API under `/__control` can register OAuth clients, seed messages,
expire access tokens, revoke refresh tokens, inject faults, and inspect live
subscriptions.

## Entra + CIPP

On boot the emulator seeds an MSP directory: three managed tenants (Contoso Ltd,
Northwind Traders, Fabrikam Residential — 13 users between them, two of them
disabled and one with no mailbox) plus the partner's own tenant, Delgado IT.
`GRAPH_EMULATOR_SEED=none` starts empty.

Both connection methods read the same directory, so the wizard can be walked
either way and produce the same clients and contacts:

| Method | What it calls |
| --- | --- |
| Direct | `GET /v1.0/tenantRelationships/managedTenants/tenants`, `…/users?$filter=tenantId eq '…'` |
| Direct, self-tenant smoke | `GET /v1.0/organization`, `GET /v1.0/users` |
| CIPP | `GET /api/listtenants`, `GET /api/listusers?tenantId=…` |

Graph responses page with `@odata.nextLink` whenever `$top` is smaller than the
result set, so an adapter that ignores paging fails here rather than in
production.

### Connecting Alga to it

Set `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` in the emulator's own
environment and it registers that OAuth client at boot; the same pair goes in
Alga's environment. Then **Direct** connects without a consent screen — the
emulator's authorize endpoint redirects straight back with a code.

For **CIPP**, use the emulator's base URL as the CIPP API URL and any non-empty
API key, unless a key has been pinned.

```bash
# Seed a fresh directory, register the OAuth client, print the env for Alga
npm run seed -- --client-id=alga-dev --client-secret=alga-dev-secret
```

### Entra control API

| Endpoint | Does |
| --- | --- |
| `POST /__control/entra/seed` | Reset and reseed the MSP directory |
| `POST /__control/entra/reset` | Empty the directory |
| `POST /__control/entra/tenants` | Add a tenant (`{tenantId, displayName, defaultDomainName, users: []}`) |
| `POST /__control/entra/users` | Add a user (`{tenantId, displayName, mail, accountEnabled, jobTitle, …}`) |
| `POST /__control/entra/users/disable` | Offboard by `id`, `mail` or `userPrincipalName`; pass `accountEnabled: true` to re-enable |
| `POST /__control/entra/organization` | Replace the partner's own tenant |
| `POST /__control/entra/cipp-key` | Pin the CIPP API key (`{apiKey: null}` accepts any) |
| `GET /__control/entra/state` | Current directory |

Faults still work on these paths, so a connection that fails at the right moment
is reachable:

```bash
# The next managed-tenant read comes back 403 — the "admin consent missing" path
curl -X POST localhost:4010/__control/faults -H 'content-type: application/json' \
  -d '{"operation":"GET /tenantRelationships/managedTenants/tenants","status":403,"remaining":1}'
```
