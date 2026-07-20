# Microsoft Graph emulator

Minimal OAuth and Microsoft Graph surface for inbound-email smoke tests. It is
stateful only in memory and is not intended for production use.

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

The control API under `/__control` can register OAuth clients, seed messages,
expire access tokens, revoke refresh tokens, inject faults, and inspect live
subscriptions. `npm test` starts an isolated emulator and verifies the OAuth
client pin, message listing, subscription validation handshake, and notification
push flow.
