# Shared calendar provider emulator fixtures

These fixtures exercise the production Google and Microsoft adapters with isolated synthetic credentials. They do not read or modify the wired development database, existing provider rows, event mappings, or external calendars.

## Google Calendar

Run the adapter contract test from `server/`:

```bash
npx vitest run --config vitest.config.ts src/test/integration/googleCalendarEmulator.integration.test.ts
```

The test starts a stateful loopback emulator on an ephemeral port. Its `fixture-google-client`, `fixture-google-secret`, `fixture-refresh-token`, and `fixture-access-token` are synthetic test values. It asserts the adapter refresh request, authenticated event create/read/update requests, and persisted-token callback. The isolated provider ID is `google-emulator-fixture`; its tenant is `isolated-google-emulator-fixture`. Teardown closes the listener and discards its event state.

The shared OAuth WireMock service also has calendar-specific mappings in `test-config/wiremock-oauth/mappings/google-calendar.json`. When using the E2E compose stack, the mock listens at `http://localhost:8081`; configure only the test app process with `GOOGLE_CALENDAR_API_ROOT_URL=http://localhost:8081/` and `GOOGLE_OAUTH_TOKEN_URL=http://localhost:8081/token`. Never apply those endpoint overrides to a production process. The WireMock event response is a fixed fixture response; the stateful adapter test above is the create/read/update contract.

## Microsoft Graph

Run the real-adapter emulator suite:

```bash
npx vitest run --config vitest.config.ts src/test/integration/microsoftCalendarEmulator.integration.test.ts
```

It uses an ephemeral `EmulatorHost` and isolated provider configurations for both shared and enterprise adapters. The suite performs OAuth code exchange, token refresh, and actual Graph event requests, including create/read/update/delete. Its fixture provider ID and tenant are `calendar-provider` and `calendar-tenant`; each test resets only the in-memory emulator. It does not validate the persisted Microsoft provider tokens in the shared development database, and those rows and mappings must remain untouched.

## Wired development fixtures and cleanup

The wired Google provider row is `15b2d092-9fbc-4883-9ed7-0cda79350f52`, owned by Glinda in the Emerald tenant. It remains a separate database-scoped record; the integration tests above do not claim that it is active or connected. Do not delete it unless first verifying that its tenant-scoped provider row has no mappings and no provider-side copy. The two pre-existing Microsoft rows and their mapping IDs are outside this fixture cleanup boundary.
