# Current-checkout verification (2026-11-21)

The checks below ran against PR #4459 checkout `60645bd2464d3db92ac65a91e8b7f79360e5dddd`. The checked source files are byte-for-byte unchanged from PR base `4ef99e75d5d0535fa815a0daf51e9e76fe87ba9f`; this PR contains review documentation/evidence changes only. The historical browser walkthrough is separately identified as `d17622d44fc011c45061041f61d221e113223e6b` and is not current-revision runtime evidence.

## Commands and results

| Command | Result | Scope |
| --- | --- | --- |
| `npm -w packages/co-managed test -- --run src/__tests__/routingDeliveryReauth.test.ts src/__tests__/sharedWorkProjection.test.ts` | Passed, 51 tests | Recipient redaction projections, aliases, hidden conversation suppression, fresh routing authorization, sponsor identity validation, normalized current email, and captured ledger recipient. Unit authorization/database doubles are used. |
| `npx vitest run --config scripts/dev/co-managed-fixtures/vitest.config.ts` | Passed, 12 tests | Fixture behavior using isolated test doubles. |
| `npm run fixtures:co-managed -- --only notification --verify` | Passed, read-only | Current dedicated notification fixture prerequisites, credentials, current runtime ticket permissions, and independent redaction policies. No fixture mutation. |
| `cd server && npx vitest run src/test/integration/ticketCommentAttachmentsIntegration.test.ts --coverage.enabled=false --maxWorkers=1` | Passed, 68 tests | Migrated PostgreSQL integration file with test-owned SMTP sinks. Includes attachment reconstruction followed by fresh comment authorization/projection, recipient-specific email in both recipient orders, a production routing-recovery path that changes sponsor email and policy and completes the original captured-address ledger row, and live PgBoss recovery to an ephemeral SMTP sink. The routing recovery MIME capture uses Nodemailer stream transport; it is not external SMTP delivery. |
| `cd server && npx vitest run src/test/unit/internal-notifications/internalCommentMentionAudience.test.ts --coverage.enabled=false --maxWorkers=1` | Passed, 6 tests | Persisted in-app subscriber payloads in restricted and unrestricted cases. Consumer payload tests use isolated persistence/query doubles; they do not claim a new browser or database-persisted notification. |
| `npm -w packages/co-managed run typecheck` | Passed | Co-managed package typecheck. |
| `NODE_OPTIONS=--max-old-space-size=12288 npm -w server run typecheck` | Failed, exit 134 | TypeScript process exhausted the 12 GiB V8 heap without diagnostics. About 20 GiB was available before starting; host availability changed during the run. |
| `NODE_OPTIONS=--max-old-space-size=16384 npm -w server run typecheck` | Incomplete, terminated with exit 143 | A fresh resource check showed 26 GiB `MemAvailable` at launch, but concurrent host workloads caused sustained paging (swap approached full and `vmstat` showed heavy swap I/O). The process was terminated to limit shared resource contention; this is not a TypeScript diagnostic result. |

The application server was not started, restarted, or built. Current browser behavior, live comment persistence/delivery, automatic recovery scheduling, and external vendor SMTP remain unverified. `alga-dev --help`, the checkout, and the exposed tool catalog provide no supported `security-finding-resolved` acceptance mechanism, so security acceptance remains unverified.
