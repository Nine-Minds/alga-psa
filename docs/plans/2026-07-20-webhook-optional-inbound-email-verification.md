# Webhook-Optional Inbound Email Verification

Verified on 2026-07-21 in the `improve/premise-microsoft-polling`
worktree. These results cover the initial implementation plus the silence
detection concurrency/idempotency mitigation.

## Focused automated tests

Command (run from `server/`):

```sh
npx vitest run \
  src/test/unit/email/EmailWebhookMaintenanceService.test.ts \
  src/test/unit/email/MicrosoftGraphAdapter.subscription.test.ts \
  src/test/unit/email/microsoftPollingWiring.contract.test.ts \
  src/test/unit/components/EmailProviderCard.test.tsx \
  src/test/integration/microsoftWebhookUnifiedQueue.integration.test.ts \
  --coverage.enabled=false --silent=passed-only
```

Result: **5 files passed, 22 tests passed**.

Coverage includes Graph validation-versus-auth classification, healthy polling
fallback, polling reconciliation, daily recovery, Test Connection recovery
wiring, Temporal schedule wiring, webhook delivery stamping/queue ingress,
healthy UI status, and the following silence-detector guards:

- an overlapping run that loses the `last_sync_at` compare-and-set does not
  enqueue or increment;
- a safety-margin retry can be re-enqueued but is not counted as a new silent
  run;
- a webhook counter reset that wins the conditional mode-transition update
  prevents subscription deletion.

## Typechecks and builds

Commands (run from the repository root unless noted):

```sh
NODE_OPTIONS=--max-old-space-size=8192 \
  npx nx run @alga-psa/shared:typecheck --output-style=static

npx nx run @alga-psa/integrations:typecheck --output-style=static

NODE_OPTIONS=--max-old-space-size=12288 \
  npx nx run server:typecheck --output-style=static

cd ee/temporal-workflows && npm run build

cd server && \
  NODE_OPTIONS=--max-old-space-size=12288 \
  EDITION=enterprise NEXT_PUBLIC_EDITION=enterprise \
  npm run build:enterprise
```

Result: **all passed**. The EE Next.js build completed with the repository's
existing webpack warnings. Server typechecking exhausted the 4 GB and 8 GB
Node heaps in earlier attempts and passed at 12 GB; this branch already had the
same documented memory requirement for the EE production build.

## Isolated migration exercise

The migration was executed against a disposable PostgreSQL database created on
the wired stack's direct PostgreSQL port (5472), not against the ahead-of-branch
shared application database. The exercise:

1. created a minimal pre-migration `microsoft_email_provider_config` table;
2. inserted one row with a subscription and one without;
3. ran migration `up`;
4. verified all four columns, the `webhook`/`polling` backfill, the zero counter
   default, and the delivery-mode check constraint;
5. ran migration `down` and verified all four columns were removed;
6. dropped the disposable database and confirmed no `alga_ms_poll_verify_%`
   databases remained.

Result: **PASS isolated migration up/backfill/constraint/down**.

The full branch migration directory still cannot be validated against the
wired `alga-psa-local-test` application database because that database contains
migrations from newer branches that are absent from this checkout.
