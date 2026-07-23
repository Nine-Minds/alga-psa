# Temporal Worker Nodemailer Packaging Design

## Problem

The Temporal worker image build for the marketing fan-out change reaches its runtime
import guard, then fails because `@alga-psa/marketing/lib/sequences` imports the
`@alga-psa/email` package root. That root eagerly loads SMTP support, which imports
`nodemailer`, but the Temporal worker's own runtime dependency graph does not install
`nodemailer`.

## Decision

Declare `nodemailer@^9.0.3` as a direct runtime dependency of
`ee/temporal-workflows` and update that workspace's lockfile. Build and copy the
already-declared `@alga-psa/types` and `@alga-psa/event-bus` package exports that the
email root bundle loads at runtime. This closes the same narrow dependency graph
using the final image's existing module-resolution path.

Do not copy another package's complete `node_modules` tree into the final image and
do not refactor marketing or email package exports as part of this deployment fix.

## Validation

1. Run the focused Temporal marketing workflow and registration tests.
2. Build the Temporal worker's production Docker target. Its existing marketing
   runtime import guard must pass.
3. Deploy the resulting image and verify:
   - all 10 worker replicas become ready without restarts;
   - the image contains the compiled marketing workflow and activities;
   - exactly three `marketing-fanout:*` schedules exist;
   - all legacy per-tenant marketing schedules are removed;
   - fan-out executions start and tenant activities complete without the old
     missing-handler error.

## Scope Protection

Commit only the Temporal worker manifest, its local lockfile, this design note, and
any directly necessary focused test. Preserve unrelated root `package.json` and
`package-lock.json` worktree changes.
