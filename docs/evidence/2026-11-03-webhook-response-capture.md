# Webhook response capture validation

Implementation: `a8cc86ce1b15465505d413c4fc1d7f634ca79ee2`.
Baseline: `6d43dafde74087add7bfafd4c795fac96c2cbe36`.
PSA ticket: `alga-2026-0003097`.

## Finding and fix

At the baseline, `sendWebhookTest` passes the configured URL to
`performWebhookDeliveryRequest`. `sendWithValidatedRedirects` reads the entire
response with `response.text()` before delivery truncates it. The finding is
confirmed in `server/src/lib/actions/webhookActions.ts:423`,
`server/src/lib/webhooks/transport.ts:134`, and
`server/src/lib/webhooks/delivery.ts:148` at that revision.

The transport now calls `readBoundedResponseText`. The reader decodes Undici's
decompressed response stream incrementally, limits the returned text to 8,192
UTF-16 code units, and cancels the remaining body when capture reaches the limit.
The existing request abort signal still covers body consumption. The limit
preserves the previous JavaScript string slicing behavior; it is not an 8,192-byte
limit on UTF-8 or UTF-16 data.

Review `server/src/lib/webhooks/responseBody.ts:8` and
`server/src/test/integration/webhookResponseBodyLimit.test.ts` first.

## Behavioral verification

From `server/`:

```sh
npx vitest run \
  src/test/integration/webhookResponseBodyLimit.test.ts \
  src/test/integration/webhookDelivery.ssrf.realSocket.test.ts \
  src/test/integration/webhookDelivery.ssrf.hostname.test.ts \
  src/test/integration/webhookDelivery.ssrf.test.ts \
  --coverage.enabled=false
```

Result: exit 0, four files and 17 tests passed. The five new socket tests cover
capture and cancellation of an oversized stream, a UTF-8 character split across
chunks, gzip expansion, timeout during consumption, and response read failure.
The other 12 tests cover the existing SSRF behavior.

For the negative control, only `transport.ts` was temporarily replaced with the
baseline version. The following test exited 1 with `TimeoutError` after three
seconds because `response.text()` continued reading the never-ending response:

```sh
npx vitest run src/test/integration/webhookResponseBodyLimit.test.ts \
  --coverage.enabled=false -t 'captures the exact character boundary'
```

The committed transport was restored in a `finally` block before running the
passing suite above. No mutation was committed.

## Typecheck and build

The full server typecheck completed with exit 0 and no diagnostics:

```sh
NODE_OPTIONS=--max-old-space-size=16384 \
  npm run typecheck -- --incremental false
```

A focused check also passed with exit 0. Its temporary configuration extends
`server/tsconfig.json`, sets `noEmit: true` and `incremental: false`, and checks
`responseBody.ts`, `transport.ts`, `delivery.ts`, and the new socket test.
This includes the test file that the full server configuration excludes.

The production community build completed with exit 0, including all 74 static
pages and build tracing:

```sh
NODE_OPTIONS=--max-old-space-size=12288 NEXT_BUILD_CPUS=2 \
  NEXT_DIST_DIR=.next-webhook-validation \
  EDITION=community NEXT_PUBLIC_EDITION=community npm run build
```

This invokes the server's `next build --webpack` script. The build reported
warnings about scheduling exports, dynamic dependencies, Edge Runtime APIs,
and cache serialization. It completed successfully without changes to those
areas. Next's configuration skips type validation during builds, so the separate
successful full typecheck above is the type-validation evidence. The temporary
build output was removed after verification.

## Workflow evidence

The exact template commands for `psa-ticket-linked` and `psa-ticket-id-recorded`
both exited 0 against current workflow state. That state contains
`psaTicketLink=created-internal` and
`psaTicketId=3bcea6e8-2b0f-4466-b542-64000ea33c65`. Workflow run
`34a76cc6-67c2-4eda-8d41-9d1b618d0ecb` also records both checks passing on
November 3, 2026. No ticket or note was duplicated.

The workflow engine defines `security-finding-resolved` as an agent review that
requires each finding to be fixed with a behavioral regression or refuted with
file-and-line evidence. The installed definition is in
`service/index.mjs:85262` of release `20261104000126-g692866e297`. This card's
effective checks do not currently include that label. The command verification
runner rejected this active run because it requires a completed run with settled
outputs. The code review and regression evidence above are available for that
gate; no formal gate pass is asserted here.

No approved plan is committed under `docs/plans/` on this branch. The untracked
design pointer has no implementation specification. Workflow spec state remains
`psaSpecOutcome=skipped-no-spec` and `psaSpecPaths=[]`.

Detailed local logs and exit codes are in `/tmp/webhook-validation/`:
`pre-fix-regression.log`, `regressions.log`, `focused-typecheck.log`,
`typecheck.log`, `build.log`, and `workflow-checks.json`. Command exit codes are
stored in matching `.exit` files. The app server was not started.
