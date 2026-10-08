# Pin the bundled Postgres image to maintained pgvector

Card: 2de258e7 · PSA ticket alga-2026-0002635 · branch `feature/security-replace-abandoned-ankane-pgvector-lates`

Commit messages, PR title and docs must stay neutral (for example "Pin bundled Postgres to maintained pgvector image"). Do not reference an advisory or name specific CVEs in commit, PR or user-facing text until the advisory is published.

## Decision summary

| Topic | Decision |
|---|---|
| Image | `pgvector/pgvector:0.8.7-pg15-bookworm@sha256:47af0b65960b14f1c6945aa4ccae37836c632e9a6fe0eea9160936e616e5b2e9` (multi-arch OCI index; amd64 + arm64) |
| Source of truth | New `docker-compose.images.yaml`. Compose stacks `extends` it, CI resolves it through a reusable workflow, and tests read it through `scripts/lib/pinned-images.mjs`. The two Helm values copies are checked against it by a test and carry `LEVERAGE` markers. |
| Existing data dirs | A single script, `helm/files/postgres/update-extensions.sh`. It runs as a compose one-shot service and as a Helm Job gated on `db.enabled`. It is **not** a knex migration and **not** part of `setup/entrypoint.sh`. |
| Appliance | Nothing mirrors images today. The ref travels through chart defaults plus `profileValues`. The DB pull policy becomes `IfNotPresent` (safe because the ref is digest-pinned), and the appliance stops overriding the wait image. |
| redis / pgbouncer | Separate follow-up card, not this PR (see "Not doing"). |

### Image facts (verified 2026-10-02 on this host)

| | `ankane/pgvector:latest` (current) | `pgvector/pgvector:0.8.7-pg15-bookworm` |
|---|---|---|
| Created | 2023-10-11 | 2026-10-01 |
| PostgreSQL | 15.4 (Debian 15.4-2.pgdg120+1) | 15.19 (Debian 15.19-1.pgdg12+2) |
| glibc | 2.36-9+deb12u3 | 2.36-9+deb12u14 (same 2.36, so collation version unchanged) |
| pgvector | 0.5.1 | 0.8.7 (update scripts cover every step from 0.5.1 to 0.8.7) |
| `postgres` uid/gid, `PGDATA` | 999/999, `/var/lib/postgresql/data` | identical |
| Entrypoint | official `postgres:15` (supports `*_FILE`) | identical |

**Design probe.** I ran an in-place upgrade on a throwaway volume. The volume was created on ankane with `CREATE EXTENSION vector`, a `vector(3)` table, an HNSW index and a btree text index. On restart under 0.8.7-pg15 it came up cleanly. `pg_available_extensions` reported `vector 0.5.1 → 0.8.7`, and `ALTER EXTENSION vector UPDATE` succeeded. The `<->` ordering query returned the same row before and after. `datcollversion` and `pg_database_collation_actual_version` both stayed at `2.36`, and the log had no collation warnings.

We take 0.8.7 rather than the reporter's 0.8.6 because it is the newest 0.8.x build, it carries PG 15.19, and the `vector--0.8.6--0.8.7.sql` step is comments only.

## Upgrade notes audit (PG 15.5–15.19, pgvector 0.6.0–0.8.7)

I read the "Migration to Version 15.N" section of every release from 15.5 to 15.19, plus the pgvector CHANGELOG and its update SQL.

**Applies to every bundled cluster created before 15.7: the CVE-2024-4317 catalog fix.** Upgrading the binaries does not fix the `pg_stats_ext` / `pg_stats_ext_exprs` views in an existing cluster. You have to run `/usr/share/postgresql/15/fix-CVE-2024-4317.sql` in every database, including `template0` (which means temporarily allowing connections to it) and `template1`. The script ships in the new image and is safe to run more than once.
- Detection, verified: on ankane 15.4, `pg_get_viewdef('pg_catalog.pg_stats_ext_exprs') LIKE '%row_security_active%'` is false. On a fresh 15.19 initdb it is true.
- `update-extensions.sh` runs the fix only when that check is false in a database (step 3).

**pgvector.** `ALTER EXTENSION vector UPDATE` walks the whole chain from 0.5.1. No reindex or data rewrite is needed. The 0.6.0 step `ALTER TYPE vector SET (STORAGE = external)` only changes defaults for new columns. The 0.6.1 step drops and recreates the vector `-` operator. That would fail only if a view or `BEGIN ATOMIC` function depended on it. Our only vector function, `get_tickets_by_concept`, is plpgsql (no dependency records), and the repo has no `BEGIN ATOMIC` bodies.

**Conditional REINDEX notes. None apply to the Alga schema, checked by grep over `server/migrations` and `ee/server/migrations`:**

| Release | Index type the note covers | Alga schema |
|---|---|---|
| 15.5 | GiST; btree on `interval`; BRIN minmax-multi | none |
| 15.6 | GIN, only "if you suspect corruption" | GIN exists (tsvector, tags), but the note is conditional, so no action |
| 15.13 | BRIN bloom; self-referential FKs on partitioned tables | none |
| 15.14 | BRIN `numeric_minmax_multi_ops` | none |
| 15.19 | btree_gist float, ltree | none. `btree_gist` is deliberately avoided; see `server/migrations/20260912140000_*.cjs:16` |

The 15.9 and 15.13 partition-FK notes need DETACH PARTITION history, and the app does not partition tables in the bundled DB. The 15.19 notes (third-party logical decoding, pgcrypto PGP with legacy ciphers, psql COPY scripts) do not apply. The upgrade doc (step 7) still links the release notes so operators with custom objects can check.

## Changes, in implementation order

Line numbers are for `main@7fafd528c8`, the branch base.

### 1. Source of truth and resolver

- **New `docker-compose.images.yaml` (repo root).** Its header comment says it is the single source for pinned third-party images and lists the consumers.
  ```yaml
  services:
    pgvector:
      image: ${ALGA_PGVECTOR_IMAGE:-pgvector/pgvector:0.8.7-pg15-bookworm@sha256:47af0b65960b14f1c6945aa4ccae37836c632e9a6fe0eea9160936e616e5b2e9}
  ```
  - `ALGA_PGVECTOR_IMAGE` exists for operators who mirror registries.
  - I prototyped this with Compose v5.5.1. The default resolves through a two-level `extends` chain (`ce → base → images`) and through `../docker-compose.images.yaml` from `server/`. The override wins when set.
- **New `scripts/lib/pinned-images.mjs`.** No dependencies. It parses `services.<key>.image` defaults from the fragment and fails fast if any line is not the exact `${VAR:-ref}` shape or the ref is not `name:tag@sha256:<64 hex>`.
  - Exports `pinnedImages()` and `pinnedImage(key)`.
  - CLI: `node scripts/lib/pinned-images.mjs pgvector` prints the ref. `--github-output` prints `key=ref` lines.

### 2. Compose: every Postgres service extends the fragment

Replace each `image: ankane/pgvector:latest` with `extends: { file: <rel>/docker-compose.images.yaml, service: pgvector }`. All other keys stay as they are.

| File | Line | Notes |
|---|---|---|
| `docker-compose.base.yaml` | 176 | `ce`, `ee` and `prebuilt.ce`/`prebuilt.ee` reach this through their existing `extends: docker-compose.base.yaml` (ce.yaml:334, prebuilt.ce:344, prebuilt.ee:332, ee.yaml:409) |
| `docker-compose.prebuilt.base.yaml` | 97 | |
| `docker-compose.yaml` | 280 | |
| `docker-compose.e2e.yaml` | 106 | |
| `docker-compose.e2e-local.yaml` | 8 | |
| `docker-compose.e2e-simple.yaml` | 8 | |
| `docker-compose.e2e-with-worker.yaml` | 8 | |
| `docker-compose.playwright-deps.yaml` | 6 | |
| `docker-compose.playwright-workflow-deps.yml` | 3 | |
| `server/docker-compose.e2e-simple.yaml` | 8 | `file: ../docker-compose.images.yaml` |
| `server/docker-compose.e2e-with-worker.yaml` | 8 | `file: ../docker-compose.images.yaml` |
| `.github/docker-compose.yaml` | 3 | `file: ../docker-compose.images.yaml`; no workflow references this file, but convert it anyway |

The `extends` merge drops nothing because the fragment carries only `image`. Check this per file with `docker compose -f <files> config` in step 8.

### 3. Extension update for existing bundled data dirs

**New `helm/files/postgres/update-extensions.sh`** (POSIX `sh`, `set -eu`). It is the single script for both runtimes. It lives inside the chart because Helm `.Files.Get` cannot reach outside the chart, while compose can bind-mount from `./helm/...`. The contract:

1. **Credentials.** `PGHOST` is required. `PGUSER` defaults to `postgres`. Use `PGPASSWORD`, or read `PGPASSWORD_FILE` when set.
2. **Wait for the new binary.** Read `expected` from the local `postgres --version`, minus the `postgres (PostgreSQL) ` prefix. Poll `SHOW server_version` until it equals `expected`, with a deadline of `UPDATE_EXTENSIONS_TIMEOUT_SECONDS` (default 900), then fail with a clear message.
   - Because the job always runs the same image as the DB, it never needs its own version config.
   - In Helm this keeps it from talking to the old pod during a StatefulSet roll.
3. **CVE-2024-4317 fix.** For each database (`SELECT datname FROM pg_database`, including templates):
   - If the `row_security_active` check from the audit is false, run `fix-CVE-2024-4317.sql` with `ON_ERROR_STOP=1`.
   - For `template0`, wrap the run in `ALTER DATABASE template0 WITH ALLOW_CONNECTIONS true/false`, and use a `trap` so it is always reset.
   - Log each database it fixes.
4. **Extension update.** For each database `WHERE datallowconn` (this includes `template1`), find `pg_available_extensions` rows where `installed_version IS NOT NULL AND installed_version <> default_version`, and run `ALTER EXTENSION <quote_ident> UPDATE` for each. Log `[db] ext from -> to`.
   - We update every out-of-date extension, not just `vector`. The job's purpose is "bring a bundled cluster in line with the image it now runs".
   - The bundled image ships only contrib plus vector, and contrib versions do not change within PG 15 minors, so in practice this updates `vector`.
5. **Errors.** Any failure exits non-zero. Following `docs/AI_coding_standards.md`, there is no silent fallback.
6. **Fresh volumes.** Every check is a no-op on a fresh volume, and so is a re-run.

**Compose wiring:**
- **`docker-compose.base.yaml`: new service `postgres-extension-update`.**
  - Image: `extends: docker-compose.images.yaml/pgvector`.
  - Entrypoint: `["/bin/sh", "/opt/alga/update-extensions.sh"]`.
  - Script mount: bind `./helm/files/postgres/update-extensions.sh` read-only.
  - Environment: `PGHOST=postgres`, `PGUSER=postgres`, `PGPASSWORD_FILE=/run/secrets/postgres_password`.
  - Other keys: `secrets: [postgres_password]`, `restart: "no"`, network `app-network`, `depends_on: postgres (service_started)`.
  - It targets the bundled `postgres` service by name. It never touches an external `DB_HOST`.
- **`docker-compose.prebuilt.base.yaml`.** Declare `postgres-extension-update` by `extends` from `docker-compose.base.yaml`. Confirm with `docker compose config` that `depends_on`, `secrets` and `networks` survive the `extends`; if they don't, restate them.
- **Every compose `setup` service** (`docker-compose.ce.yaml:87`, `docker-compose.ee.yaml:133`, `docker-compose.prebuilt.ce.yaml:97`, `docker-compose.prebuilt.ee.yaml:87`) gets `depends_on: postgres-extension-update: condition: service_completed_successfully`.
  - Migrations then always see the reconciled cluster, and a failure shows up at `up` time instead of drifting silently.
  - `docker-compose.prod.yaml` and `docker-compose.setup-ubuntu.override.yaml` only overlay `setup`, so their `depends_on` merges; check this with `config`.

**Helm wiring (`helm/`, chart `sebastian`, also used by the appliance):**
- **New `helm/templates/postgres/extension-update-job.yaml`**, rendered only when `.Values.db.enabled`. Prod, hosted and hosted-env-dev all set `db.enabled: false` in `~/nm-kube-config`, so managed Citus/StackGres is never targeted.
- **Name: `db-extension-update-<10-char sha256 of (db image ref + script)>`.**
  - This is a plain Job, not a hook. A hook failure would fail the Helm upgrade, which stalls Flux with `RetriesExceeded` on the appliance, where `alga-core.yaml` deliberately has no remediation.
  - Hashing the name means a new image or script creates a fresh Job, and Helm deletes the old one because it is no longer in the manifest. This avoids the immutable-`spec.template` upgrade error.
  - An unchanged revision is a no-op apply.
  - No `ttlSecondsAfterFinished`: the completed or failed Job stays as evidence. If Helm recreates a missing Job, the re-run is harmless.
- **Spec.**
  - Image: the DB image ref helper (step 4), with the DB pull policy.
  - Command: `["/bin/sh", "-c"]`, with the script inlined via `.Files.Get "files/postgres/update-extensions.sh"`.
  - Environment: `PGHOST=db` (the `helm/templates/postgres/service.yaml` name), `PGUSER=postgres`, and `PGPASSWORD` from secret `db-credentials` / `DB_PASSWORD_SUPERUSER`. That is the same source the StatefulSet uses at `statefulSet.yaml:36-40`.
  - Pod settings: `backoffLimit: 6`, `restartPolicy: OnFailure`, `activeDeadlineSeconds: 1800`, `namespace: {{ include "sebastian.namespace" . }}`.

### 4. Helm image refs with digest support

- **`helm/templates/_helpers.tpl`: new `sebastian.imageRef` helper.** It takes a dict of `repository`/`tag`/`digest` and renders `repo[:tag][@digest]`. It fails (`required`/`fail`) if `repository` is empty, and also if `digest` is set but does not match `^sha256:[0-9a-f]{64}$`.
- **`helm/values.yaml:307-311`, `db.image`.** Set `repository: pgvector/pgvector`, `tag: "0.8.7-pg15-bookworm"`, `digest: "sha256:47af…e2e9"`, `pullPolicy: IfNotPresent`. Add the marker `# LEVERAGE: friction pinned-third-party-images — Helm values cannot read docker-compose.images.yaml; scripts/tests/pinned-images.test.mjs enforces equality`.
- **`helm/templates/postgres/statefulSet.yaml:32-33`.** Use the helper. Replace the hard-coded `imagePullPolicy: Always` with `.Values.db.image.pullPolicy`.
  - With a digest pin, `IfNotPresent` is exact. It also stops every appliance DB restart from needing docker.io, which the appliance egress preflight never checks.
  - Leave the `.bak` files alone.
- **`helm/templates/deployment.yaml:2-4,119`.** The wait-for-bootstrap image is resolved in this order:
  1. the explicit `setup.waitForBootstrap.image.name` (plus tag and new optional `digest`);
  2. otherwise, if `.Values.db.enabled`, the DB image ref;
  3. otherwise `setup.image`, which is today's fallback.

  The init container only runs `psql`. On the appliance the DB image is already on the node, and SaaS (`db.enabled: false`) renders unchanged. Add `digest: ""` under `setup.waitForBootstrap.image` in `helm/values.yaml:66-72`.
- **`ee/helm/email-service/templates/deployment.yaml:73` and `values.yaml:166-171`.** Add an equivalent local helper, or inline `name:tag@digest`, and set `name: pgvector/pgvector`, `tag: 0.8.7-pg15-bookworm`, `digest: sha256:…`. This is a separate chart, so it is a second drift-tested copy with the same `LEVERAGE` marker.

### 5. Appliance

- **`ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml:24-28`.** Delete the `setup.waitForBootstrap.image` override (`ankane/pgvector:latest`); keep `pullPolicy`. Step 4's fallback now resolves the wait image to the pinned DB image, so the profile carries no image copy.
  - The DB image reaches appliances through the republished `sebastian` chart (`reconcileStrategy: Revision`, `ee/appliance/flux/base/releases/alga-core.yaml`).
  - If the new values ever apply against an old chart during promotion, the old chart falls back to `setup.image`, which also has `psql`. Both orders are safe.
- **`ee/appliance/ubuntu-iso/tests/t001-build-smoke.test.mjs:246`.** Replace the literal with `pinnedImage('pgvector')`, imported from `scripts/lib/pinned-images.mjs` via `repoRoot`. In the same T006b render, assert:
  - the `db` StatefulSet image equals the pinned ref and its pull policy is `IfNotPresent`;
  - exactly one `Job` named `db-extension-update-*` exists, with no `helm.sh/hook` annotation, the pinned image, `PGHOST=db`, and the password from `db-credentials`/`DB_PASSWORD_SUPERUSER`.
- **New appliance-lane test** (same directory; the lane has `helm`). Render `helm/` with `--set db.enabled=false` and assert:
  - no `db-extension-update` Job and no StatefulSet;
  - the wait-for-bootstrap image equals `setup.image` (the SaaS shape is unchanged).
- **Email-service render.** Assert the email-service chart's `wait-for-bootstrap` image equals the pinned ref when `waitForBootstrap.enabled=true`.
- **Pipeline: no change needed.**
  - Nothing in `ee/appliance` mirrors, airgaps or pre-pulls third-party images. k3s pulls from docker.io.
  - `profileValues` and `imageDigests` in the release manifest cover first-party images only. Setting the ref via chart defaults is the consistent path.
  - `ee/docs/plans/2026-09-05-production-regression-prevention/evidence/rendered-release-component-inventory.json` is a dated historical snapshot that no script regenerates. Leave it.

### 6. CI

- **New reusable workflow `.github/workflows/pinned-images.yml`.**
  - Trigger: `on: workflow_call`. One job, `resolve`.
  - Steps: `actions/checkout@v4` with sparse checkout of `docker-compose.images.yaml` and `scripts/lib/pinned-images.mjs`, then `node scripts/lib/pinned-images.mjs --github-output >> "$GITHUB_OUTPUT"` (no `npm ci`).
  - Exposes `outputs.pgvector`.
  - Why this works: `jobs.<id>.services.<id>.image` accepts the `needs` context (but not `env`), so it gives a single repo-file source with no workflow copies.
- **Consumers.** Add a job `images: uses: ./.github/workflows/pinned-images.yml`. Each consuming job adds `images` to `needs`, ANDs `needs.images.result == 'success'` into its `if:`, and sets `image: ${{ needs.images.outputs.pgvector }}`.
  - `integration-tests.yml:59`, `:302`, `:469` (jobs `integration-tests`, the infrastructure shard job, `workspace-db-tests`). The `images` job must have **no** `if:`, so the nightly schedule, where `check-changes` is skipped, still resolves.
  - `workspace-tests.yml:17` (`enterprise-integration`).
  - `validate-tenant-management.yaml:58`.
  - The nesting depth is `production-regression → integration-tests → pinned-images`, which is within GitHub's limit.
- **`citus-migration-smoke.yml:11-16`.** Reword the comment to say "the pinned pgvector image (docker-compose.images.yaml)".

### 7. Drift guard and docs

- **New `scripts/tests/pinned-images.test.mjs`.** The node-tooling lane auto-discovers it via `scripts/lib/test-discovery.mjs:28`. It asserts:
  1. The fragment parses, and every ref is `name:tag@sha256:<64hex>`.
  2. No `git ls-files` path outside `docs/plans/` and `ee/docs/plans/` contains `ankane/pgvector`.
  3. No tracked file other than the fragment and those plan dirs contains a literal `pgvector/pgvector:` image ref. This forces compose, workflows and docs through the source.
  4. `helm/values.yaml` `db.image` and `ee/helm/email-service/values.yaml` `waitForBootstrap.image` recompose to exactly `pinnedImage('pgvector')`. Use the root `yaml` dependency.
- **`docs/getting-started/setup_guide.md` "Upgrading" (around line 459).**
  - Add a short "Database image changes" note:
    - the bundled Postgres image is digest-pinned;
    - on the first `up` after upgrading, the `postgres-extension-update` service brings installed extensions in line and logs what it changed;
    - how to check it: `docker compose … logs postgres-extension-update`, and `SELECT extname, extversion FROM pg_extension` per database;
    - the manual equivalent for operators who run their own Postgres: `ALTER EXTENSION vector UPDATE` in each database;
    - a link to the PG 15 release notes for custom objects.
  - Keep it neutral: "moves to the maintained pgvector image".
- **`server/src/test/integration/journeys/README.md:136`.** Use `"$(node scripts/lib/pinned-images.mjs pgvector)"` instead of the literal image.
- **`server/src/test/integration/billing/invoiceStatusManagement.integration.test.ts:474`.** Change the comment's "ankane/pgvector" to "the pinned pgvector image".

### 8. Local verification (Draft Implementation runs these before pushing)

- **Compose config.** Run `docker compose -f … config --images` for every combination used in docs and CI:
  - `base+ce`, `base+ee`, `prebuilt.base+prebuilt.ce`, `prebuilt.base+prebuilt.ee`;
  - the `e2e*` and `playwright*` files, both `server/` files, and `.github/docker-compose.yaml`;
  - the e2e-fresh-install `COMPOSE_FILE` list (`e2e-fresh-install-tests.yaml:249`).

  Each must show the pinned ref, plus `postgres-extension-update` wherever there is a `setup`.
- **Helm render.** `helm template` for `helm/` with the default values, the appliance profile, and `db.enabled=false`, and for `ee/helm/email-service`.
- **Tests.** `node scripts/run-node-tooling-tests.mjs` (or just the new test) and `node scripts/run-appliance-tests.mjs`.
- **Script edge cases.** Run `update-extensions.sh` against:
  - an ankane volume, which must fix CVE-2024-4317 in all DBs including `template0`, update vector, and leave `template0` back at `datallowconn=false`;
  - a fresh 0.8.7 volume, where it must be a no-op;
  - a second run, also a no-op;
  - a wrong password, where it must exit non-zero.
- **Inventory checks.** Check that `scripts/verify-repository-inventory.mjs` and `scripts/verify-node-workflow.mjs` still accept the new `images` job and test file.

## Acceptance test: in-place CE upgrade (required)

Run this on an isolated compose project (unique `APP_NAME`, unique ports), never on the card's shared `alga-psa-local-test`.

1. **Old stack.** Check out `main` and bring up the CE stack the way the setup guide does (`prebuilt.base + prebuilt.ce`; if no published image fits, build it with `base + ce`). Let `setup` migrate and seed.
2. **Vector fixture.** CE migrations do not create `vector` (only EE `ai_schema` does), so as superuser in `server` run:
   - `CREATE EXTENSION vector`;
   - create a `vector(3)` table with rows, plus an HNSW index.

   Also log in once as the seeded admin.
3. **Record the baseline:**
   - `SHOW server_version` (15.4);
   - `extversion` per database (vector 0.5.1);
   - the `row_security_active` check (false);
   - `datcollversion`;
   - a nearest-neighbour query result;
   - row counts for a few app tables.
4. **Upgrade.** Run `down` (no `-v`), check out the branch, then `up -d`.
5. **Verify:**
   - `postgres-extension-update` exited 0, and its log shows the CVE fix per database and `vector 0.5.1 -> 0.8.7`;
   - the server is 15.19;
   - vector is 0.8.7, and the CVE check is now true in every database, including `template0`/`template1`;
   - `template0` has `datallowconn=false`;
   - the nearest-neighbour result and row counts are unchanged;
   - `pg_database_collation_actual_version = datcollversion`;
   - the postgres log has no collation warnings;
   - `setup` completed;
   - the app login works in the browser.
6. **Idempotence.** Run `down`/`up` again. The one-shot logs nothing to do, and the stack is healthy.
7. **EE.** Repeat steps 1–5 with `base + ee` so the real `vectors` table and `get_tickets_by_concept` exist. Recommended; EE is where vector is actually used.
8. **Appliance (recommended, not gating).** On the libvirt appliance VM (`alga-appliance-local` skill):
   - upgrade an installed appliance to a chart built from this branch;
   - check that the `db-0` pod restarted on the pinned digest and that the `db-extension-update-*` Job completed with the same log lines;
   - check that the app is healthy.

Record the evidence (commands and outputs) on the card.

## Not doing (deliberately)

- **No knex migration and no change to `setup/entrypoint.sh`.**
  - The setup entrypoint is baked into the setup image (`setup/Dockerfile:15,33`), which Helm also runs (`helm/values.yaml:49`).
  - Managed prod runs StackGres/Citus with its own pgvector build and has `db.enabled: false`. Nothing here may touch it.
- **No PostgreSQL major upgrade.** We stay on 15 and bookworm, so no `pg_upgrade` and no collation change. PG 15 reaches end of life in November 2027, so file a follow-up card for the 15 → 17 path (bundled compose, Helm and appliance), which needs `pg_upgrade` or dump/restore tooling.
- **No redis or pgbouncer pinning in this PR.** File one follow-up card instead.
  - `redis/Dockerfile` (`FROM redis:latest`), `helm/values.yaml:293-297` (`redis:latest`) and CI's `redis:7-alpine` disagree today. `redis:latest` is now Redis 8, which has a licence change. Picking the pinned major (7.4, 8.x or Valkey) is a product and licensing decision, not a mechanical pin.
  - `pgbouncer/Dockerfile` (`FROM edoburu/pgbouncer:latest`) is a mechanical pin, but it ships in the same images as redis.
  - The follow-up reuses this card's mechanism. Add keys to `docker-compose.images.yaml`; for Dockerfiles, use `ARG` with the value passed by compose `build.args`, and extend the drift test to cover them.
- **No changes to `~/nm-kube-config`** (separate repo, separate PR). File a follow-up for:
  - `hosted-env-dev/values-hosted-env.yaml:159` (it has `db.enabled: false`, but the stale override should go);
  - `postgres-pgvector/01-statefulSet.yaml:22`;
  - `postgres-training/01-statefulSet.yaml:22`;
  - `e2e-testing/alga-psa-e2e-{workflow,full-workflow,k8s-native-workflow}.yaml`;
  - confirming that the StackGres clusters carry the CVE-2024-4317 view fix (they were most likely initdb'd after 15.7, but check).
- **No mirroring of third-party images to ghcr, and no airgap bundle.** The appliance already pulls third-party images from docker.io, and the egress preflight only probes ghcr. That is a separate hardening item; the `IfNotPresent` change reduces exposure meanwhile. Mention it in the follow-up.
- **No other image pins.** Leave `ai-gateway-postgres: postgres:16-alpine`, CI `greenmail`/`redis` and similar unpinned. They are out of scope; the new fragment is where they would go.
- **No regeneration of the historical evidence JSON**, and no edits to `.bak` templates.

## Risks

| Risk | Mitigation |
|---|---|
| `extends` does not carry `depends_on`/`secrets` across files in some Compose version | Restate those keys explicitly where `config` shows them dropped. The e2e-fresh-install lane downloads a pinned Compose version (`e2e-fresh-install-tests.yaml:358`), so verify with that version too. |
| A failing one-shot now blocks `setup` and therefore the stack | Intended (fail fast, clear log). The script is idempotent and verified against an old volume, a fresh volume and a re-run. The upgrade doc explains how to read its log. |
| The Helm Job runs before the DB pod has rolled | It waits until `server_version` matches its own binary (same image), with a deadline. |
| The Job fails on the appliance | It is not a hook, so the Helm upgrade and Flux are unaffected. A failed Job stays visible. Draft Implementation should check whether `ee/appliance/operator/lib/status.mjs` shows failed Jobs in `msp`, and note it on the card if it doesn't. |
| Toggling `template0` connections leaves it open after a crash | Use a `trap` to reset it. The test checks `datallowconn=false` afterwards. The script re-checks and resets on every run. |
| `IfNotPresent` keeps a stale image | Not possible with a digest-pinned ref. Bumping the pin changes the digest, which forces a pull. |
| Containerd reports a runtime `imageID` as `docker.io/pgvector/pgvector@sha256:…`; unwired release-evidence scripts (`scripts/lib/release-test-evidence.mjs`, `kubernetes-release-observations.mjs`) compare strings exactly | Not wired into CI today. Note it for whoever wires them: normalize registry prefix and tag before comparing. |
| A GitHub `services.image` from an empty `needs` output gives an opaque error | Gate consuming jobs on `needs.images.result == 'success'`. The resolver fails fast on a malformed fragment. |
| CI lanes not normally triggered by this diff (validate-tenant-management only runs on migration changes) | Run it via `workflow_dispatch`, and dispatch `integration-tests` with `suite=full`, on the branch before review. |
| Docker Hub rate limits on new digest pulls in CI | Same exposure as today's `latest` pulls. No change. |
