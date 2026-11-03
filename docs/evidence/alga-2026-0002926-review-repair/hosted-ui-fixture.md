# Hosted Stripe ownership UI fixture

This fixture is isolated to PostgreSQL database `alga_stripe_tenant_test` at
`127.0.0.1:55472`. It does not write the installation `license_state`
singleton. Its absence selects hosted licensing; all three scenario tenants
resolve to Pro through `resolveTenantTier`.

The committed fixture manifest is
[`hosted-ui-fixture.json`](hosted-ui-fixture.json). It contains the deterministic
tenant, login, product, price, and Stripe customer IDs, but no password hash,
password, application secret, or database password.

## Prepare and verify

Use the already migrated isolated database only. Keep the local Stripe emulator
running during preparation and later UI checks; its customer/product state is
in memory and the preparation command reseeds it deterministically.

In one terminal, start the emulator:

```sh
node packages/emulators/host/dist/cli.js serve \
  --control-port 9500 --port stripe=4050 \
  -m @alga-psa/emulator-stripe
```

In another terminal, load the local application secret and explicitly target the
isolated database. `SECRET_READ_CHAIN=env` makes the fixture password hash use
the same `NEXTAUTH_SECRET` that the later app process will use.

```sh
set -a
source server/.env.local
set +a
export SECRET_READ_CHAIN=env
export DB_HOST=127.0.0.1 DB_PORT=55472 DB_NAME_SERVER=alga_stripe_tenant_test
export DB_USER_SERVER=postgres DB_PASSWORD_SERVER=stripe_tenant_test
export DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=stripe_tenant_test
export STRIPE_API_BASE_URL=http://127.0.0.1:4050 STRIPE_SECRET_KEY=sk_test_algasim
export STRIPE_UI_FIXTURE_PASSWORD='LocalOnly-Stripe2926!'
npx tsx scripts/prepare-stripe-ownership-hosted-ui-fixture.ts prepare
```

`prepare` refuses a non-loopback host, another database/port, a missing owner
FK, a nonempty `license_state`, or a non-simulator Stripe key/URL. It seeds the
Stripe emulator's test config, deterministic Pro product/price, and three
customers. It hashes the fixture-only password with the local application
secret, creates one hosted Pro tenant and real MSP Admin credentials per case,
reconciles the canonical permission catalog, then adds the customer mappings
and authoritative bindings. The deleted customer is created with matching
metadata and then deleted remotely; the mismatched customer's metadata names
the matching scenario tenant while its local mapping/binding belong to the
mismatched scenario tenant.

Rerun the read-only readiness check at any time with the same environment:

```sh
npx tsx scripts/prepare-stripe-ownership-hosted-ui-fixture.ts verify
```

The script checks credentials with the application password verifier, verifies
the Admin `account_management:update` grant, calls the real licensing resolver,
checks the validated owner FK and each mapping/binding, and reads each remote
customer from the simulator. The tested price ID is
`price_sec2926_sec2926hosteduiv1_pro_monthly`; the master tenant ID is in the
manifest.

## UI validation steps for an authorized later run

The current task prohibits starting the application server, so these browser
checks have not been executed. For a later authorized run, keep the emulator
alive, reuse the isolated DB and fixture password environment above, and add:

```sh
export MASTER_BILLING_TENANT_ID=2a36f1e1-8215-57fb-917e-2435a3a7d557
export STRIPE_PRO_PRICE_ID=price_sec2926_sec2926hosteduiv1_pro_monthly
export STRIPE_WEBHOOK_SECRET=whsec_algasim
export NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_algasim
export NEXTAUTH_URL=http://localhost:3000
```

Then start the EE app using the repository's dev-stack procedure, sign in at
`/auth/signin`, and open `/msp/licenses/purchase`. The three credentials share
the fixture-only password above:

```sh
NODE_OPTIONS=--max-old-space-size=14336 npm run dev --workspace sebastian-ee
```

| Case | Login | Expected ownership behavior |
| --- | --- | --- |
| Matching | `stripe-owner-matching-sec2926hosteduiv1@example.invalid` | Submit one additional license. The action succeeds and the emulator records a Checkout session for `cus_sec2926_sec2926hosteduiv1_matching`. Stop before completing payment. |
| Remote metadata mismatch | `stripe-owner-mismatched-sec2926hosteduiv1@example.invalid` | Submit one additional license. The action displays its failure state; no new Checkout session is recorded. |
| Deleted customer | `stripe-owner-deleted-sec2926hosteduiv1@example.invalid` | Submit one additional license. The action displays its failure state; no new Checkout session is recorded. |

Inspect the emulator's `checkout-sessions` state before and after each rejected
case and the application logs for the ownership refusal. This local simulator
validates the server Stripe API calls; it does not replace Stripe.js or prove
that the embedded payment iframe can complete a charge.

Read the emulator state with:

```sh
node packages/emulators/host/dist/cli.js state stripe checkout-sessions \
  --url http://127.0.0.1:9500
```

## Verification captured

Prepared and re-verified on 2026-11-03 against the isolated migrated database
and the local simulator. All three cases passed credential verification,
permission verification, hosted Pro resolution, local owner binding, and remote
customer state checks. No application server was started; browser/UI validation
remains outstanding.
