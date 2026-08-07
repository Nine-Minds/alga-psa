# Emulator suite (algasim)

Emulators for the external services Alga integrates with. Use them to run
integration and E2E tests without vendor accounts, and to smoke-test
integration flows by hand. Design decisions and history live in
[docs/plans/2026-07-26-emulator-suite-design.md](../../docs/plans/2026-07-26-emulator-suite-design.md).

## Run everything

```bash
cd packages/emulators/suite && npm run build && npm start
```

This starts every emulator on its default port and the console at
<http://localhost:9500>:

| Emulator | Package | Port | Emulates |
| --- | --- | --- | --- |
| `msgraph` | `@alga-psa/emulator-msgraph` | 4010 | Microsoft login (OAuth2) + Graph v1.0 mail, subscriptions, change notifications, Teams; Bot Framework connector + its OpenID/JWKS |
| `qbo` | `@alga-psa/emulator-qbo` | 4020 | Intuit OAuth + QBO v3 company API (query, CDC, void/delete, SyncTokens, credits) |
| `webhook-sink` | `@alga-psa/emulator-webhook-sink` | 4030 | Any webhook receiver; records requests, echoes Graph validation tokens |
| `smtp-sink` | `@alga-psa/emulator-smtp-sink` | 4040 | SMTP capture (MailHog stand-in) |

The control API and console share port 9500. Override ports with
`ALGASIM_CONTROL_PORT` and `ALGASIM_PORT_<ID>` (e.g. `ALGASIM_PORT_SMTP_SINK`).

To run a subset, or your own set of emulator modules:

```bash
node packages/emulators/host/dist/cli.js serve \
  -m @alga-psa/emulator-qbo -m @alga-psa/emulator-msgraph \
  --scenarios packages/emulators/suite/scenarios
```

### As a container

```bash
packages/emulators/build-image.sh          # builds algasim:dev
docker compose -f packages/emulators/compose.yml up
```

The image contains only the built packages and their public npm
dependencies; it never needs the monorepo at runtime.

## Point Alga at the emulators

Emulators speak the vendors' real wire protocols. Redirect Alga with env
overrides:

| Vendor | Env vars |
| --- | --- |
| Microsoft | `MICROSOFT_LOGIN_BASE_URL=http://localhost:4010`, `MICROSOFT_GRAPH_BASE_URL=http://localhost:4010/v1.0` |
| Teams / Bot Framework | The two Microsoft vars above, plus `TEAMS_BOT_OPENID_CONFIG_URL=http://localhost:4010/v1/.well-known/openidconfiguration` and `TEAMS_BOT_SERVICE_URL_ALLOWLIST=http://localhost:4010` |
| QBO | `QBO_OAUTH_AUTHORIZE_URL=http://localhost:4020/connect/oauth2`, `QBO_OAUTH_TOKEN_URL=http://localhost:4020/oauth2/v1/tokens/bearer`, `QBO_API_BASE_URL=http://localhost:4020/v3/company` |
| Webhooks | Point the integration's webhook/notification URL at `http://localhost:4030/<any path>` |
| SMTP | Configure the SMTP provider with host `localhost`, port `4040`, no TLS |

Both Teams vars are off by default and ignored entirely under
`NODE_ENV=production`, so they cannot loosen a deployed trust boundary.
`TEAMS_BOT_OPENID_CONFIG_URL` moves *discovery only*: the emulator generates
an RSA keypair, publishes a JWKS, and RS256-signs the activities it injects,
so the app's signature, issuer, and audience checks all still run.
`TEAMS_BOT_SERVICE_URL_ALLOWLIST` takes exact origins (comma-separated, no
wildcards) and is what lets the bot send back to the emulator.

Restarting the emulator mints a fresh keypair. While the override is set the
app re-discovers the JWKS every 30s (instead of the 12h production cache), so
a restart heals on its own — no need to restart the app.

### Teams round trip

```bash
# The bot's own credentials, so its client_credentials token grant succeeds.
algasim seed msgraph client -p '{"clientId":"<TEAMS_BOT_APP_ID>","clientSecret":"<TEAMS_BOT_APP_PASSWORD>"}'

# Point the emulator at your app, and match TEAMS_BOT_APP_ID.
algasim action msgraph configure -p '{
  "botTargetUrl": "http://localhost:3000/api/teams/bot/messages",
  "botServiceUrl": "http://localhost:4010",
  "botAppId": "<TEAMS_BOT_APP_ID>"
}'

# An external/guest client identity, then an inbound message from them.
algasim seed msgraph teams-user -p '{"id":"guest-1","displayName":"Wanda","userType":"Guest"}'
algasim seed msgraph bot-activity -p '{
  "text": "My printer is on fire",
  "fromAadObjectId": "guest-1",
  "conversationId": "a:conversation-1",
  "conversationType": "personal"
}'

# Read back what the bot sent, adaptive cards and all.
algasim state msgraph bot-activities
algasim state msgraph activity-notifications
```

## Drive them

Every emulator exposes two surfaces: the **vendor surface** above, and a
uniform **control surface**. The CLI, the console, and test helpers are all
clients of the control surface, so anything one can do, all can.

```bash
alias algasim='node packages/emulators/host/dist/cli.js'

algasim catalog                                        # everything available
algasim seed qbo customer -p '{"name":"Acme Rockets"}'
algasim action msgraph expire-access-tokens
algasim arm qbo transport:error -p '{"status":503,"rate":0.5}'
algasim disarm qbo transport:error
algasim state webhook-sink requests
algasim clock advance 32d                              # virtual time: token expiry, billing periods
algasim reset msgraph                                  # state + all faults
algasim scenario run my-setup.yaml
```

The same operations over HTTP:

```
GET  /control/catalog
POST /control/:emulator/actions/:name        body = params
POST /control/:emulator/faults/:name/arm     body = params
POST /control/:emulator/faults/:name/disarm
GET  /control/:emulator/state/:view
POST /control/:emulator/seed/:name           body = params
POST /control/:emulator/reset
POST /control/clock/advance                  {"duration":"32d"}
POST /control/scenario                       body = scenario JSON
POST /control/scenarios/:name/run
```

### Faults

Three tiers, so most failure modes cost nothing to support:

- **Transport** (`transport:latency`, `transport:error`, `transport:connection-reset`)
  come free with every HTTP emulator via host middleware.
- **Protocol** — token expiry and revocation actions on `msgraph` and `qbo`.
- **Domain** — emulator-specific, e.g. `msgraph` `operation-fault` (fail
  `"GET /me"` or `"POST /v3/conversations/{id}/activities"` N times, for
  Graph throttling and bot-connector failures), QBO stale SyncTokens
  produced by out-of-band `receive-payment`/`apply-credit` actions.

### Scenarios

Declarative YAML that seeds, acts, arms, and advances the clock by registry
name — identical behavior from CI setup code, the CLI, and the console's run
button. See [suite/scenarios/](suite/scenarios/) for examples:

```yaml
name: delinquent-customer
steps:
  - seed: qbo/customer
    params: { name: Slowpay Inc }
  - seed: qbo/invoice
    params: { customerId: customer-1, amountCents: 90000 }
  - advance: 45d
  - arm: qbo/transport:latency
    params: { ms: 2000 }
```

### Virtual clock

All emulator time flows through one host clock. `algasim clock advance 2h`
expires OAuth tokens; `32d` crosses billing periods and subscription
expirations. Runs are reproducible: the host PRNG is seeded (`--seed`).

## Write an emulator

A package under `packages/emulators/<vendor>` exports an `EmulatorPackage`:

```ts
const myEmulator: EmulatorPackage<MyCore> = {
  id: 'vendor',
  displayName: 'Vendor',
  defaultPort: 40xx,
  createCore: (env) => new MyCore(env),   // pure state machine; time via env.clock
  wire(router, core) { /* the vendor's real HTTP routes */ },
  register(reg, core) { /* actions, faults, state views, seeders */ },
};
```

Rules that keep the suite coherent:

- **Core is pure.** No I/O, no wall time (`env.clock`), no `Math.random()`
  (`env.rng`). Unit tests inject the core directly at the service seam —
  billing's QBO tests are the model.
- **Controls are declarations.** One `reg.action(...)` with a zod schema and
  the CLI command, console form, and HTTP endpoint all exist. Never build
  client-side support for an emulator.
- **Wire is faithful.** Real routes, real auth handshakes, real error
  envelopes. If Alga needs an env override to reach the emulator, add it at
  the client (see `microsoftGraphEndpoints.ts` and `qboClientService.ts`).
- **Non-HTTP protocols** implement `serve()` instead of `wire()` (see
  `smtp-sink`).

Add the package to `SUITE_EMULATORS` in [suite/src/index.ts](suite/src/index.ts)
and to the `PACKAGES` list in [build-image.sh](build-image.sh).
