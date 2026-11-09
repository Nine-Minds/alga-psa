# Asset numbering environment repair

Database access is repaired. **Yes, this card can advance from Implement to Pull Request.** No asset-numbering implementation defect was established in this assignment. The complete Ryan walkthrough and review recording still belong to review preparation.

Verified on 2026-11-09 against implementation commit `781c0118a57adda3c163b31c57c2ad5ceeab3b6f`. Existing PR: [#4210](https://github.com/Nine-Minds/alga-psa/pull/4210). Existing customer ticket: [alga-2026-0003120](https://algapsa.com/msp/tickets/8ea5fb98-0142-429d-9896-14e510033663).

## Diagnosis

At assignment start, the checkout had already been rewired to `server_card_ee4611c9` on shared PostgreSQL at `127.0.0.1:5474`. A read-only connection using its own `card_ee4611c9` role succeeded. Both Glinda and QA existed as active internal users. That database had 590 public tables and 51 tenants. The role had neither superuser nor database-creation privileges. This established a scratch-provisioning gap, rather than a reason to rotate shared credentials.

The cancelled canonical-login condition also omitted `userType=internal` from its credentials POST. The current credentials provider passes this field to `authenticateUser`, which deliberately rejects a missing or non-interactive type before looking up the user. The logged rejection therefore did not establish that the database lacked an internal QA user. The repaired probe sends the same explicit user type as the MSP sign-in form. No authentication guard was relaxed.

## Environment changes

The application now uses dedicated PostgreSQL and Redis services under Compose project `asset-numbering-ee4611c9`. Their containers, network, volumes and credentials belong to this card.

| Resource | Current configuration |
| --- | --- |
| PostgreSQL | `asset-numbering-ee4611c9-postgres`, pgvector/PostgreSQL 15, loopback port `5501`, shared memory `1 GiB` |
| Database | `server_card_ee4611c9`, freshly migrated and seeded from this checkout |
| Migration/bootstrap role | `card_ee4611c9_admin`, administrator inside this dedicated container |
| Application role | `card_ee4611c9`, no superuser or `CREATEDB` privileges |
| Redis | `asset-numbering-ee4611c9-redis`, loopback port `6448`, separate authentication and volume |
| App | Board-owned `dev-server`, port `3578`, original card hostname |
| Compose configuration | `/home/robert/alga-card-envs/ee4611c9/compose.yaml` |
| App launch wrapper | `/home/robert/alga-card-envs/ee4611c9/start-app.cjs` |
| Local app/helper configuration | Checkout `server/.env.local` and `secrets/`; generated secrets remain uncommitted |
| Previous local configuration backup | `/home/robert/.alga-xo/environments/ee4611c9/before-repair-20261109/`, restricted to the owner |

The launch wrapper loads the card configuration before starting the normal `npm run dev` command. App and canonical login helper resolve the same database and password sources. All generated application secrets were replaced for this fresh environment. Container-mount inspection found no service mounting this checkout's secret directory before replacement. A separate credential-vault encryption key was added, and startup validated it after restart.

Bootstrap used the existing `scripts/bootstrap-playwright-db.ts`. An older migration expects a role literally named `postgres`; the dedicated container received a compatibility role with `NOLOGIN`. Bootstrap then completed successfully. Redis initially could not read its mounted configuration as its container user; its configuration is now readable inside the container while its host parent directory remains owner-only. The Docker CLI could not read a Compose file under the hidden XO directory, so the active Compose configuration lives in the non-hidden card environment directory above.

No shared database, pooler, role, credential or Redis service was changed. The earlier database on port `5474` was preserved. The existing card-owned Citus cluster (`asset-numbering-repair`) was used only for a new disposable verification database after checking its Compose ownership. No other card's credentials were used.

No product source changed. The versioned `.env.localtest` was restored after verification. The pre-existing `package-lock.json` diff remains excluded. This report and its evidence are the only repository changes in this assignment.

## Verification

- **Canonical helper:** `ensure-test-login.mjs` created QA in the fresh app database and copied Glinda's MSP Admin role.
- **Real HTTP sign-in after final restart:** credentials callback succeeded, followed by `/api/auth/session` naming `qa@emeraldcity.oz`, `user_type=internal`, and tenant `05d46c3f-c06d-42af-b090-45c9527b08aa`. Authenticated settings returned HTTP 200. See [access-verification.txt](access-verification.txt).
- **Browser sign-in and protected settings reads:** the MSP form established the QA session. Assets settings loaded its client-prefix data, legacy continuation review and `00001` preview without an alert. These data reads require `settings:read`; the database confirms QA holds MSP Admin. See [browser-settings.json](browser-settings.json) and [the settings screenshot](authenticated-asset-settings.png). An HTTP shell alone was not treated as proof of hydrated settings data.
- **Non-consuming settings visit:** the app database still has zero `ASSET` rows in `next_number` after both settings visits. Its five seeded asset claims remain intact. See [database-state.txt](database-state.txt).
- **Scratch provisioning and persistence:** 20 behavioral tests passed on the dedicated PostgreSQL service, in separate database `asset_numbering_test_card_ee4611c9`. They exercise concurrency, collision handling, reservations, settings locking, tenant separation and Level resync. See [persistence.txt](persistence.txt). The previously passed 55-test suite was not repeated.
- **Current migrations and actual numbering services:** both existing verification scripts passed against new disposable PostgreSQL and Citus databases. They exercise migration re-entry, preservation of legacy duplicates/blanks, binding enforcement, concurrency, reservation transfer, activation and independent ticket numbering. See [postgres-migrations.txt](postgres-migrations.txt), [citus-migrations.txt](citus-migrations.txt), and [database-versions.txt](database-versions.txt). The Citus service check covers allocation and reservation behavior; the settings-action race test remains PostgreSQL coverage.
- **Startup:** the final restart validated credential-vault encryption and reached the HTTP listener. See [startup-signals.txt](startup-signals.txt). Enterprise Temporal job-runner availability remains an existing startup warning; this assignment did not demonstrate live background integration delivery.

The app database contains one development tenant, three seeded clients and five seeded assets. Persistence tests use a different database and do not reset that browser baseline. No Ryan/customer inventory was copied into it.

## Handoff

The app remains running at `http://feature-asset-numbering-client-prefixes-and-paired-label.localhost:3578`. Its Alga Dev browser pane is `31c1b41d-1d80-4b4c-9463-80eb53853f14`, authenticated as QA on Assets settings.

To restore the card services after an intentional stop:

```bash
docker compose -f /home/robert/alga-card-envs/ee4611c9/compose.yaml up -d
alga-dev workflow-ensure-service --projectId=ee4611c9-de3b-4038-a6a5-da185fc2207a --name=dev-server --command='node /home/robert/alga-card-envs/ee4611c9/start-app.cjs' --cwd=/home/robert/alga-copies/feature-asset-numbering-client-prefixes-and-paired-label/server --readinessPort=3578 --readinessPath=/api/health --actor=agent:officer
```

The private environment directory also contains `login-probe.py` and `run-persistence.cjs`. The latter injects `server/.env.local` before running the focused persistence suite, so no secret-bearing edits to the versioned test env are needed. The login probe checks a real session; hydrated settings data is verified separately in the browser. If the XO installs another login condition, it must include `userType=internal`. The previous condition was cancelled and was not changed here.

Review preparation can now build the repeatable Ryan fixtures, run the full intake/paired-print/scan walkthrough and live integration demonstration, and capture its chaptered recording. Existing offline PDF and customer-procedure evidence remains under `../alga-2026-0003120-draft/`. Hardware scanner and physical printer validation remain outstanding. This repair does not claim those checks passed.

The card was not advanced, approved, merged, re-pointed or parked. No customer message was sent. The XO owns the next workflow transition; no captain action is needed for this environment repair.
