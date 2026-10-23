# CE Postgres: require password authentication, and repair existing data directories

Status: design (not implemented) · Branch: `feature/security-critical-remove-trust-auth-from-ce-post` · Ticket: alga-2026-0002635

## Goal

The CE prebuilt Postgres accepts network connections only with a password, and stays that way:

- **Fresh installs** initialise with `md5` for every non-loopback connection.
- **Existing installs** whose data directory was created with `trust` are repaired automatically on the next `up`, without locking the app out.
- **No regression path.** If a `trust` rule shows up again in `pg_hba`, the stack refuses to start instead of serving.

This card covers Postgres (5432) only. PgBouncer (6432) is a sibling card. The two must merge and ship together, because fixing either one alone leaves the other port open.

## What the code does today (verified against this worktree)

| Location | Fact |
|---|---|
| `docker-compose.prebuilt.ce.yaml:344-364` | The `postgres` service `extends` `docker-compose.base.yaml` and sets `POSTGRES_HOST_AUTH_METHOD: trust` at **line 353**. |
| `docker-compose.base.yaml:175-188` | `command: postgres -c password_encryption=md5` and `POSTGRES_INITDB_ARGS: --auth-host=md5 --auth-local=md5`. It sets no `POSTGRES_HOST_AUTH_METHOD`, so the image entrypoint uses `password_encryption`, which is `md5`. |
| `docker-compose.prebuilt.base.yaml:96-107` | Defines its own `postgres` (no `extends`) with `POSTGRES_HOST_AUTH_METHOD: md5`. In the documented CE combo (`-f prebuilt.base -f prebuilt.ce`), the CE file's `trust` overrides it. I confirmed this with `docker compose config`. |
| `ankane/pgvector:latest` (PG 15.4) entrypoint | On a fresh data dir it appends `host all all all $POSTGRES_HOST_AUTH_METHOD` to `pg_hba.conf`. The loopback lines come first and use md5 (from initdb args), so the appended line covers every *other* address, including the Docker network and anything that reaches the published port. |
| Same entrypoint | Under `trust` it accepts an **empty** `POSTGRES_PASSWORD`. Otherwise it always passes `--pwfile`, so `postgres` normally *does* have the secret's password. I confirmed both in a disposable container: with a secret present, `postgres` got an `md5…` hash; with an empty secret, the role had no password. |
| `setup/entrypoint.sh` (bind-mounted into the CE `setup` container) | Connects as `postgres` with `secrets/postgres_password` and runs `server/setup/create_database.js`. That script re-applies `app_user`'s and `hocuspocus_user`'s passwords from their secrets with `ALTER USER … PASSWORD` **on every run** (`ensureLoginRole`, `setupHocuspocusDatabase`). It never resets the `postgres` password. |
| `pgbouncer/entrypoint.sh` | Builds `userlist.txt` with **md5** hashes of `app_user` and `postgres` from the secrets. PgBouncer uses these hashes to log in to Postgres. Today Postgres never checks them, because it trusts the network. |
| `ee/setup/entrypoint.sh:36-80` | EE already has `check_postgres_md5_auth`, which fails setup on any non-md5 host rule. CE setup has no equivalent. |
| `.github/workflows/e2e-fresh-install-tests.yaml:249` | CI's fresh-install job uses `docker-compose.base.yaml:docker-compose.ce.yaml:docker-compose.prod.yaml:…`. **It never loads `docker-compose.prebuilt.ce.yaml`.** Its "upgrade" stage is a *schema* upgrade from a v1.5.0 database, not a data-directory upgrade. A green run today proves nothing about this bug. |

Deploy paths that do **not** use trust: `helm/`, `ee/helm/` (PgBouncer defaults to `scram-sha-256`), `ee/appliance/`, `docker-compose.base.yaml`, `docker-compose.ce.yaml`, `docker-compose.prebuilt.base.yaml` (EE prebuilt), and the CI compose overlays. `pgbouncer/pgbouncer.ini.template:8` (`auth_type = trust`) is the sibling card. A repo-wide grep for `HOST_AUTH_METHOD`, `auth_type`, `auth-host`, `pg_hba` and `trust` found nothing else in compose, helm, appliance or setup scripts.

## Decisions

1. **Auth method: `md5`, not `scram-sha-256`.** Everything in this stack is md5 today: `password_encryption=md5` in base, `--auth-host=md5 --auth-local=md5`, the PgBouncer userlist hashes, and EE's `check_postgres_md5_auth`. Moving to SCRAM means re-hashing every role and changing how PgBouncer obtains secrets. That is a separate hardening card. Switching method inside a security fix would make the upgrade riskier without closing anything more.
2. **Repair inside the `postgres` container, before the server listens.** A wrapper entrypoint fixes the data directory and then `exec`s the stock `docker-entrypoint.sh`. The card suggested a setup-time step plus `pg_reload_conf()`. I rejected that because:
   - The setup container cannot write `$PGDATA/pg_hba.conf`. It is in another container's volume, and the only way in over SQL is superuser server-side file writes, which is the very capability we are trying to take away.
   - The server would already be listening with `trust` for the whole time before setup ran.
   - Setup is optional: operators can skip it, and partial `up`s skip it.

   Done pre-start, there is no exposure window and no reload is needed.
3. **Before rewriting, make the superuser password match `secrets/postgres_password`.** The new rule makes the `postgres` role's password matter for network logins. Nothing has ever enforced that it matches the secret, so an operator who regenerated secrets after the first init would be locked out the moment the trust rule goes: setup would loop in `wait_for_postgres` forever. That drift is what the existing "Postgres authentication loop" troubleshooting section describes. The secret file is what setup, PgBouncer and hocuspocus all authenticate with, so syncing the role to it is the only lockout-free option. We write the pre-computed hash `md5(password || username)`, so plaintext never appears in SQL. It matches what PgBouncer computes.
4. **Do not touch `app_user` or `hocuspocus_user` in the wrapper.** `create_database.js` already owns those passwords and re-syncs them from their secrets on every setup run, and all v1.6.0 installs ran it. Duplicating that in the wrapper would split ownership. The wrapper only *reports* login roles with a NULL password.
5. **Fail closed.** The wrapper exits non-zero, and the container does not serve, if any of these hold:
   - the superuser secret is empty
   - the socket-only maintenance server will not start
   - the password sync fails
   - any `trust` rule survives the rewrite
   - `POSTGRES_HOST_AUTH_METHOD=trust` is set in the environment

   CE setup also refuses to proceed if `pg_hba_file_rules` reports any `trust` rule. There is no bypass flag: network-reachable trust is never a valid configuration for this product.
6. **Install the wrapper on the shared postgres definitions:** `docker-compose.base.yaml` and `docker-compose.prebuilt.base.yaml`. Putting it on CE prebuilt only would be narrower.
   - The hazard belongs to the volume, not to a compose variant.
   - Base is what CE prebuilt `extends`, and CI's fresh-install job loads it, so CI exercises the wrapper's no-op path on every run.
   - On a healthy data dir the wrapper is a single `awk` pass followed by `exec`.
   - `prebuilt.base` has its own postgres definition, so it needs the same two lines. That repetition gets a `// LEVERAGE: pattern` marker (see "Not doing").
7. **Ship it as a bind-mounted script from the repo checkout, not a custom image.** This follows the existing pattern: CE already bind-mounts `./setup/entrypoint.sh` and `./scripts`, and the setup guide has operators run from a clone. Run it as `entrypoint: ["/bin/bash", "/usr/local/bin/alga-postgres-entrypoint.sh"]` so a lost exec bit (Windows checkouts) does not matter. Add a `.gitattributes` rule `postgres/*.sh text eol=lf` so CRLF checkouts cannot break it.

## Changes, in order

### 1. `postgres/alga-postgres-entrypoint.sh` (new)

A Bash wrapper, validated in a spike during this session (see "Evidence"). Behaviour:

1. If `POSTGRES_HOST_AUTH_METHOD` is `trust`, log and `exit 1`. This prevents a fresh init from writing the line in the first place.
2. Resolve the hba path. Default to `$PGDATA/pg_hba.conf`, but honour `hba_file` if `postgresql.conf` overrides it (`postgres -C hba_file`, run as postgres).
3. **Fast path.** If `$PGDATA/PG_VERSION` is missing (fresh install) or the hba has no `trust` rule, go straight to `exec docker-entrypoint.sh "$@"`.
   - Detection must be **field-aware**, not a blind `grep trust`, because a database or user could be named `trust`.
   - Ignore comment and blank lines.
   - The method is field 4 for `local` lines, and field 5 for `host*` lines, or field 6 when field 5 is a bare IP followed by a netmask.
4. **Repair path.**
   1. Read the superuser password from `$POSTGRES_PASSWORD_FILE` (fall back to `$POSTGRES_PASSWORD`). Strip CR/LF. If it is empty, `exit 1` with a pointer to the docs.
   2. Create a `mktemp -d` directory with mode 700, owned by postgres. Inside it, write a temporary hba containing only `local all <superuser> trust`.
   3. Start a maintenance server with `pg_ctl -w -t 60 -o "-c listen_addresses='' -c unix_socket_directories=<tmpdir> -c hba_file=<tmpdir>/hba -c password_encryption=md5"`. It has no TCP listener, and its socket sits in a private directory, so nothing outside this process can connect.
   4. Log any `pg_authid` login roles whose `rolpassword IS NULL` (report only).
   5. Run `ALTER ROLE :"u" WITH PASSWORD :'h'` through psql on stdin, where `h = 'md5' || md5(pw || user)`. Use psql variables so quoting is safe. Note that variable interpolation does **not** work with `psql -c`; that matters during implementation.
   6. Stop the maintenance server with `pg_ctl -m fast -w stop`.
   7. Back up the hba to `pg_hba.conf.pre-trust-removal` (mode 600, inside `$PGDATA`) and log the path.
   8. Rewrite every `trust` method on `local` and `host*` lines to `md5` with the same field-aware awk. Also drop the image's two `# warning trust is enabled…` / `# see …auth-trust…` comment lines. Write to a temp file in the same directory, set owner postgres and mode 600, then `mv` it over the original.
   9. Re-run detection. If any `trust` rule remains, `exit 1`.
   10. Log one summary line: what changed, the backup path, and that the superuser password was synced.
5. If the container runs as root, run every server-side command through `gosu postgres`; otherwise run them directly. This supports a compose `user:` override. The image ships `/usr/local/bin/gosu`.

### 2. `docker-compose.prebuilt.ce.yaml`

- **Line 353:** replace `POSTGRES_HOST_AUTH_METHOD: trust` with `POSTGRES_HOST_AUTH_METHOD: md5`. Simply deleting it would fall back to md5 through `prebuilt.base` or the base `password_encryption`. Stating it explicitly keeps the file correct when someone uses it on its own, and it documents intent.
- The wrapper `entrypoint` and its volume come from base through `extends`. **Verify** with `docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml config postgres` that `entrypoint`, the bind mount, `postgres_data` and `command` all resolve. Only declare them here if the merge drops them.

### 3. `docker-compose.base.yaml:175-188` and `docker-compose.prebuilt.base.yaml:96-107`

Add to each postgres service:

```yaml
    entrypoint: ["/bin/bash", "/usr/local/bin/alga-postgres-entrypoint.sh"]
    volumes:
      - ./postgres/alga-postgres-entrypoint.sh:/usr/local/bin/alga-postgres-entrypoint.sh:ro
```

`command` stays as it is in base. In `prebuilt.base` the image default `postgres` carries through. Then verify the rendered config for each documented combo:

- CE prebuilt: `prebuilt.base + prebuilt.ce`
- EE prebuilt: `prebuilt.base + prebuilt.ee`
- The CI combo
- `docker-compose.yaml` and the dev stacks

Each one should show the wrapper, and volumes should merge rather than replace each other.

### 4. `setup/entrypoint.sh`: a guard that fails closed

Add `assert_no_trust_auth` and call it right after `wait_for_postgres` in `main()` (`setup/entrypoint.sh:110`). It runs one query as `postgres` against the admin host (with the same PgBouncer-to-direct fallback logic):

```sql
SELECT line_number, type, database, user_name, address, auth_method
FROM pg_hba_file_rules
WHERE auth_method = 'trust' OR error IS NOT NULL;
```

Any rows mean: log them, print the fix and a pointer to the setup guide, then `exit 1`. `server` depends on `setup` completing, so a regressed data dir can never reach a serving app. The rule is trust-only on purpose, so it does not import EE's stricter md5-only policy into CE.

Mark the near-duplicate of EE's `check_postgres_md5_auth` with `# LEVERAGE: pattern pg-hba-auth-check — CE and EE setup entrypoints each query pg_hba_file_rules; a shared setup lib would own this`.

### 5. `.gitattributes`

Add `postgres/*.sh text eol=lf`.

### 6. Tests: `scripts/tests/ce-postgres-auth.test.sh` plus a CI job

This is the piece that makes "CI fresh-install and upgrade paths are green" mean something for this bug. It is a self-contained Docker harness with its own compose project, throwaway secrets and named volume. It runs the real `postgres` service from `-f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml`, so it tests the compose wiring and not just the script.

| # | Scenario | Assertions |
|---|---|---|
| T1 | **Fresh install** | No non-comment `trust` in `pg_hba.conf`. Passwordless `psql -w` from a sibling container on `app-network` fails with `fe_sendauth: no password supplied`. `psql` with the secret succeeds. The wrapper logs that it took the fast path. |
| T2 | **Upgrade from v1.6.0 layout** | Initialise the volume with the v1.6.0 postgres env (`POSTGRES_HOST_AUTH_METHOD=trust`, base initdb args, md5 command), create `app_user` with its secret's password, then `up` with the new compose. Trust is gone. The backup exists with mode 600. Passwordless fails. `postgres` with the secret works. |
| T3 | **Upgrade with drifted superuser secret** | Same as T2, but rotate `secrets/postgres_password` before the upgrade `up`. The new secret works after repair, which proves no lockout. |
| T4 | **Idempotency** | Restart after T2. No repair log lines; `pg_hba.conf` is byte-identical. |
| T5 | **Fail closed: empty secret** | A trust data dir plus an empty secret makes the container exit non-zero, and port 5432 never accepts connections. |
| T6 | **Fail closed: trust env** | A fresh volume with `POSTGRES_HOST_AUTH_METHOD=trust` exits non-zero before initdb. |
| T7 | **Setup guard** | Against a server with a manually inserted trust rule (reloaded), `setup/entrypoint.sh`'s guard exits 1. With the rule removed, it passes. |
| T8 | **App through PgBouncer after upgrade** (with the sibling card) | After T2, bring up `pgbouncer` and `setup`. Setup completes. `app_user` and `postgres` connect *through 6432* with their secrets. This proves Postgres accepts PgBouncer's md5 userlist hashes now that it actually checks them. |

CI wiring: add a `ce-postgres-auth` job, on `paths:` covering `docker-compose*.yaml`, `postgres/**`, `setup/entrypoint.sh`, `pgbouncer/**` and the test itself. Either put it in a new small workflow or append it to `e2e-fresh-install-tests.yaml`. It needs only Docker and the public `ankane/pgvector` image (plus the PgBouncer build for T8), so it runs in a few minutes. The existing fresh-install job must also stay green: it now exercises the wrapper's fast path through base.

### 7. Manual end-to-end check before merge

Use the `alga-prebuilt-env-manager` skill:

1. Bring up an isolated **v1.6.0** CE prebuilt stack (`git checkout v1.6.0` compose, published image), log in, and create a ticket.
2. Switch the compose and scripts to this branch, together with the PgBouncer card, then `down` and `up`.
3. Confirm all of the following:
   - Postgres logs show the repair.
   - Setup completes.
   - The server is healthy, login works and the ticket is still there.
   - Hocuspocus reconnects.
   - Passwordless `psql` to 5432 from the host and from a sibling container fails.
   - `grep -v '^#' $PGDATA/pg_hba.conf` shows no trust.

### 8. Documentation

All public wording must stay neutral until the advisory is published (see "Risks").

- **`docs/getting-started/setup_guide.md`, "Upgrading" (line 459): new subsection "Postgres authentication (upgrading from v1.6.0 or earlier)".** It should cover:
  - On first start, the `postgres` container rewrites legacy `trust` entries in `pg_hba.conf` to `md5`.
  - It resets the `postgres` role's password to `secrets/postgres_password` and keeps a backup at `$PGDATA/pg_hba.conf.pre-trust-removal`.
  - The log line to look for.
  - A manual check: `docker compose … exec postgres sh -c 'grep -v "^#" "$PGDATA/pg_hba.conf" | grep -v "^$"'`.
  - A manual fix for anyone running Postgres outside this compose: set every `trust` method to `md5`, make sure the roles have passwords, then `SELECT pg_reload_conf();`.
  - What the two fail-closed errors mean.
- **Same file, "Troubleshooting → Postgres authentication loop" (line 255):** note that the repair syncs the superuser password once, and add the "setup refused: trust rule present" error.
- **Same file, "Security Checklist" (line 334):** add "`pg_hba.conf` has no `trust` entries".
- **`docs/getting-started/setup_guide_windows.md`:** mirror the Upgrading subsection (line 385) and the checklist line (line 325).
- **Release notes.** These live in GitHub Releases, not in the repo. Draft the text in the PR description for the release owner. Publishing it is outside this card and should follow the advisory timeline.

### Suggested commit sequence

All messages neutral:

1. `fix(compose): require password auth for CE Postgres`. Covers the `prebuilt.ce` env change, the wrapper, the base and prebuilt.base wiring, and `.gitattributes`.
2. `fix(setup): refuse to run against a Postgres that allows passwordless connections`. Covers the setup guard.
3. `test(compose): CE Postgres auth fresh-install and upgrade harness`. Covers the harness and the CI job.
4. `docs: Postgres authentication upgrade notes`.

## Deliberately NOT doing

- **SCRAM migration.** Out of scope; see decision 1. It should be a follow-up card covering Postgres, PgBouncer userlist generation and `password_encryption` together.
- **PgBouncer `auth_type`.** That is the sibling card. This card's T8 verifies the server side of the PgBouncer-to-Postgres hop, but does not change `pgbouncer.ini.template`.
- **Port publishing / binding 5432 to 127.0.0.1.** That is the sibling card. With this card, an exposed port still requires a password.
- **Syncing `app_user` and `hocuspocus_user` passwords in the wrapper.** `create_database.js` owns them (decision 4).
- **Continuous superuser-password drift repair.** The sync runs only during the one-time trust repair. After that, a drifted secret behaves as it does today, which the troubleshooting doc covers.
- **Changing `prebuilt.base`'s postgres to `extends` base** to remove the duplicated wrapper lines. That would also change EE prebuilt's initdb args. It is worth doing, but it is a behaviour change outside this card, so it gets a LEVERAGE marker instead.
- **Helm and appliance.** Audited; no trust anywhere. No change.
- **A bypass flag for the guards.** See decision 5.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Lockout after repair.** A role's stored password does not match what clients send. | The superuser is synced from the secret before the rewrite (T3). `app_user` and `hocuspocus_user` are re-synced by every setup run, which v1.6.0 installs already ran. The wrapper also reports NULL-password login roles. T8 and the manual v1.6.0 check cover the whole app. |
| **Operator changed the `postgres` password on purpose** and uses it outside the stack. | The sync overwrites it with the secret. Their stack's own components already used the secret, so the role only worked because of trust. The sync is logged loudly and documented. |
| **Hash format mismatch with PgBouncer:** a SCRAM-stored password cannot be used with PgBouncer's md5 userlist. | Base forces `password_encryption=md5`. The sync writes an explicit md5 hash. Setup's `ALTER USER` runs under md5. T8 proves the hop. |
| **Hocuspocus starts before setup** (it depends only on redis) and fails auth briefly if its password is out of sync. | Same exposure as any secret rotation today. Setup re-syncs, and hocuspocus is optional (`REQUIRE_HOCUSPOCUS=false`). The manual check confirms it reconnects. |
| **Wrapper breaks Postgres start for everyone** (base is shared by dev and CI). | The fast path is one awk pass followed by `exec` of the stock entrypoint with unchanged args. CI's fresh-install job exercises it. T1 and T4 are the regression tests. |
| **Bind-mount fragility** on Windows (CRLF, exec bit). | `.gitattributes` forces LF. Invoking through `/bin/bash` sidesteps the exec bit. `setup/entrypoint.sh` already relies on the same mechanism. |
| **Compose merge drops the `entrypoint` or volume** in some file combo. | Step 3 verifies `docker compose config` for every documented combo. The T-series uses the real CE combo. |
| **Maintenance server cannot start** (unclean shutdown, disk full). | `pg_ctl -w -t 60` and a non-zero exit mean the container restarts or stays down rather than serving with trust. Recovery is in the docs. |
| **Disclosure before the advisory is published.** The repo is public. Pushing this branch, the plan, the docs or the test names would reveal the weakness. | Commit messages and docs stay neutral, with no GHSA id and no exploit detail. **The branch has not been pushed** (confirmed with `git ls-remote`). The captain should decide between developing in the advisory's temporary private fork and a coordinated, neutrally worded public PR before anything is pushed. That is a board decision, so it is flagged for the XO. |

## Evidence gathered during design

- `docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml config postgres` renders `POSTGRES_HOST_AUTH_METHOD: trust`, initdb args `--auth-host=md5 --auth-local=md5`, and command `postgres -c password_encryption=md5`.
- Disposable `ankane/pgvector:latest` container with the CE env: `pg_hba.conf` ends with `host all all all trust`, and `postgres` has an md5 password from the secret.
- Spike of the wrapper (throwaway, not committed):
  - Started from a trust-initialised volume, then rotated the secret.
  - Repair logged.
  - The hba last line became `host all all all md5`, and the backup was written.
  - Passwordless `psql` to the container IP failed with `fe_sendauth: no password supplied`.
  - The *new* secret connected as superuser.
  - A restart produced no repair output.
- The existing dev stack (`alga-psa-local-test`, which has no trust env) already shows `host all all all md5`. Removing the env yields md5 as expected.
