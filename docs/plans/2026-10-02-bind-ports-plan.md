# Bind Postgres, PgBouncer and Redis Host Ports Plan

## Goal

Stop publishing the data-plane services (Postgres, PgBouncer, Redis) on every host interface.

- **Deployment stacks** (prebuilt CE/EE, and the source-built `prod` overlay) publish none of them. The app and hocuspocus stay published because the reverse proxy needs them. Every other service already reaches the data plane over `app-network`.
- **Development and test stacks** publish them on `127.0.0.1` by default. One variable, `EXPOSE_INFRA_BIND_ADDR`, moves them to another address on purpose.
- Operators who need host access to the database get a shipped opt-in overlay that defaults to loopback, plus a documented recipe for reaching it safely from another machine.

This is a compose and docs change. No application code changes.

## Current state (verified on `7fafd528c8`)

Each data-plane service publishes `"${EXPOSE_X_PORT:-N}:N"` with no host IP. Docker binds these on `0.0.0.0` and `[::]`, and the rules it inserts are evaluated before ufw/firewalld rules.

| File:line | Service | Used by |
|---|---|---|
| `pgbouncer/docker-compose.yaml:13-14` | pgbouncer | extended by `docker-compose.prebuilt.base.yaml:122`, `docker-compose.base.yaml:203`, `docker-compose.e2e.yaml:146` |
| `docker-compose.prebuilt.base.yaml:104-105` | postgres | prebuilt CE/EE |
| `docker-compose.prebuilt.base.yaml:115-116` | redis | prebuilt CE/EE |
| `docker-compose.base.yaml:185-186` | postgres | extended by `docker-compose.prebuilt.ce.yaml:344`, `docker-compose.prebuilt.ee.yaml:332`, `docker-compose.ce.yaml:334`, `docker-compose.ee.yaml:409` |
| `docker-compose.base.yaml:197-198` | redis | extended by the same four files (`prebuilt.ce:365`, `prebuilt.ee:352`, `ce:354`, `ee:426`) |
| `docker-compose.base.yaml:168-169` | ai-gateway-postgres | source-built stacks only (base + ce/ee) |
| `docker-compose.yaml:178-179, 289-290, 302-303` | ai-gateway-postgres, postgres, redis | `make docker-up-ee` / `docker-up-ce` (`docker-compose.yaml` + base + ce/ee) |

`docker compose config` renders the following today:

- Prebuilt CE/EE: `postgres *:5432`, `pgbouncer *:6432`, `redis *:6379`.
- Source-built CE/EE (base + ce/ee, with or without `docker-compose.yaml`): the same three, plus `ai-gateway-postgres *:5433`.
- Fresh-install CI (`base:ce:prod:setup-ubuntu:imap-test:e2e-emulators`): `docker-compose.e2e-emulators.yaml:151-154` already does `ports: !reset []` on postgres and redis and routes them through `test-ingress` on `127.0.0.1`. PgBouncer is not reset, so `*:6432` is still published in CI.
- `docker-compose.e2e.yaml` `pgbouncer-test` publishes both `*:6432` and `*:6433`. Its own `6433:6432` is appended to the `6432:6432` it inherits through `extends`. This is the merge behavior described next.

**Merge semantics.** `extends` and `-f` overrides append to `ports:`. They never replace it. A service that extends a base publishing a port can only drop that port with `ports: !reset []`, which needs Compose 2.24 or later. The documented minimum for prebuilt installs is **Compose v2.20** (`docs/getting-started/setup_guide.md:12`, `README.md`). So the shipped prebuilt stack must not depend on `!reset`.

## Design decisions

**D1. Publishing is a topology decision, so the shared service definitions publish nothing.** Remove the `ports:` entries for postgres, redis and pgbouncer from the three files every stack inherits: `pgbouncer/docker-compose.yaml`, `docker-compose.base.yaml` and `docker-compose.prebuilt.base.yaml`. Each topology file then adds what it needs. This is the only way the prebuilt stack ends up with zero data-plane ports on Compose 2.20, because those definitions reach it through `extends`, which appends. It also fixes the `pgbouncer-test` double publish for free.

**D2. Dev topology files add loopback-bound ports.** `docker-compose.ce.yaml`, `docker-compose.ee.yaml` and `docker-compose.yaml` publish:

```yaml
- "${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:${EXPOSE_DB_PORT:-5432}:5432"         # postgres
- "${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:${EXPOSE_PGBOUNCER_PORT:-6432}:6432"  # pgbouncer
- "${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:${EXPOSE_REDIS_PORT:-6379}:6379"      # redis
```

`docker-compose.ce.yaml` gets a `pgbouncer` entry (`extends: docker-compose.base.yaml / pgbouncer` plus `ports`), matching the one `docker-compose.ee.yaml:431` already has. Where `docker-compose.yaml` and `ce`/`ee` both declare the same entry, the strings are identical and Compose de-duplicates them. This was confirmed by rendering.

**D3. `ai-gateway-postgres` is a Postgres, so it gets the same treatment.** Bind it to loopback in place (`docker-compose.base.yaml:169`, `docker-compose.yaml:179`). It never appears in prebuilt stacks, so it can stay in `base.yaml`.

**D4. The variable is `EXPOSE_INFRA_BIND_ADDR`, not a generic `EXPOSE_BIND_ADDR`.** It controls only the data-plane services. The app, hocuspocus, temporal, minio and the rest are untouched. A generic name would suggest otherwise. The `EXPOSE_*_PORT` names stay as they are, so existing `.env` files keep working.

**D5. The source-built production overlay resets the ports.** `docker-compose.prod.yaml` adds `ports: !reset []` for `postgres`, `redis`, `pgbouncer` and `ai-gateway-postgres`. Production publishes nothing, the same as prebuilt. The cost is Compose 2.24 or later for that path, which the docs will state. CI already runs 2.24 or later, because `e2e-emulators.yaml` uses `!reset`. An older Compose fails to parse the file with an explicit error. It does not silently fall back to publishing.

**D6. Ship an opt-in overlay, `docker-compose.expose-infra.yaml`.** It holds the same three loopback-default entries as D2. Operators add it as the **last** `-f`. Because nothing upstream publishes, appending gives exactly these bindings on any Compose version, and it works on prebuilt CE/EE, on the prod overlay (after the reset) and on the dev stacks (where it de-duplicates). This keeps the "deliberate and safe" path to a single flag instead of hand-written YAML.

**D7. Test-only compose files bind to loopback too.** They run on developer machines with well-known test passwords. The host-side consumers (Playwright, integration tests, `scripts/workflow-runtime-v2-compose-smoke.mjs`) connect through `localhost`/`127.0.0.1`. Containers that need these services reach them by service name over the compose network. `docker-compose.playwright-workflow-deps.yml` only uses `host-gateway` to call the host app.

**D8. A regression guard enforces the policy in CI.** Add a `node:test` file that renders the stack combinations with `docker compose config --format json` and asserts the expected bindings. It follows the `*-guard.yml` pattern (`secret-bootstrap-guard.yml`). `docker compose config` needs neither secrets nor images, so the guard is cheap.

## Changes, in order

Make each phase its own commit. Use neutral commit messages, for example `compose: bind data-plane ports to loopback by default`.

### Phase 0: out-of-repo prerequisite (nm-skills, land first)

nm-skills `skills/alga-local-wirein/scripts/wire_to_env.py:299` parses `docker ps` ports with `re.search(r"0\.0\.0\.0:(\d+)->(\d+)", mapping)`. With loopback binding, every infra mapping becomes `127.0.0.1:N->N/tcp`. The regex then matches nothing, so wire-in loses its live port detection. It falls back to the `.env` port, and its cross-project "franken-environment" detection stops working.

- Change it to accept any host address: `r"(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]*\]|::):(\d+)->(\d+)"`. That covers `0.0.0.0`, `127.0.0.1`, `[::]`, `::` and specific IPs. Keep the first match per container port. Update the format comment at `:295`.
- The change is backward compatible with existing `0.0.0.0` stacks, so it can ship before this branch merges. One review stack already shows the bug: its Redis is published on `127.0.0.1`, and the current regex misses it.
- In the same repo, `alga-local-wirein/SKILL.md:649-675` has a "prebuilt infra only" recipe that connects to `localhost:5432`/pgbouncer on a prebuilt stack. Change it to add `-f docker-compose.expose-infra.yaml` as the last file.

### Phase 0b: board readiness probes (alga-dev, outside this card; merge gate)

This is the cross-host consumer the card asked us to rule out, and there is one.

- The alga-dev hub checks card-service readiness from the hub machine, not from the card's host. `ghostty-pane-ide/src/main/workflow/WorkflowCardServiceService.ts` `observeReadiness()` (around `:750-761` on `origin/fix/approval-gate-recognizes-its-answer`) builds `tcp://<router.hostAddress(hostId)>:<port>`. `HostRouter.hostAddress()` (`:495-504`) returns the host's **tailnet address** for any remote host.
- `xo/reference/card-services.md:34` and the "Prepare Human Review" template tell agents to register databases and caches with a port-only TCP readiness check. They do: `KV_wf-card-services` holds `review-postgres` (5472), `review-pgbouncer`/`review-dependencies` (6472) and `review-redis` (6380), and one was still live at 2026-10-03T00:13Z.
- Once a review stack is recreated from a checkout that contains this change, those ports are bound to `127.0.0.1`. The hub's `tcp://<host tailnet address>:<port>` probe then fails, the service is marked `failed`, and the health sweep retries and eventually blocks the card.

Required before merge. One of:
1. **Preferred:** run port-only (TCP) readiness on the service's own host (through the host agent), so the hub never needs network access to a host-local dependency. This is the correct layer. A dependency bound to loopback is healthy if it answers on its host.
2. **Interim, guidance only:** change `card-services.md` and the "Prepare Human Review" template so data-plane dependencies are registered either with no readiness port or behind the existing pattern: a small `/health` HTTP wrapper, bound on its own port, that checks `127.0.0.1:<db port>` locally. Several review environments already do this, and it keeps working under loopback binding.

Neither option is in this repo or this card. Hand it to the XO to schedule on the board.

What the board does that is **not** affected:
- `xo/wire-up.sh:86-88` runs on the card's host and forces `DB_HOST`/`REDIS_HOST=127.0.0.1`.
- `AlgaGlindaReset.ts:227,246` connects to `127.0.0.1` on the checkout's host.
- The `stack-up` verifier only curls the dev server.

### Phase 1: shared definitions stop publishing (D1)

1. `pgbouncer/docker-compose.yaml:13-14`: delete the `ports:` block.
2. `docker-compose.base.yaml:185-186` (postgres) and `:197-198` (redis): delete the `ports:` blocks.
3. `docker-compose.base.yaml:168-169` (ai-gateway-postgres): change it to `"${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:${EXPOSE_AI_GATEWAY_DB_PORT:-5433}:5432"` (D3).
4. `docker-compose.prebuilt.base.yaml:104-105` (postgres) and `:115-116` (redis): delete the `ports:` blocks. Leave the `EXPOSE_DB_PORT`/`EXPOSE_REDIS_PORT` entries in the shared environment anchor (`:64-66`) alone. They are inert, and removing them is unrelated churn.

### Phase 2: dev topologies add loopback ports (D2, D4)

1. `docker-compose.ce.yaml:334-357`: add the D2 `ports:` to the `postgres` and `redis` services, directly after each `extends` block. Before `networks:` (`:359`), add:
   ```yaml
   pgbouncer:
     extends:
       file: docker-compose.base.yaml
       service: pgbouncer
     ports:
       - "${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:${EXPOSE_PGBOUNCER_PORT:-6432}:6432"
   ```
2. `docker-compose.ee.yaml:409-434`: add the D2 `ports:` to `postgres`, `redis` and `pgbouncer`.
3. `docker-compose.yaml:179, 290, 303`: prefix each with `${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:`. The strings must be byte-identical to the ce/ee ones so they de-duplicate.
4. `.env.example:269-273`: add `EXPOSE_PGBOUNCER_PORT=6432` (currently missing) and a commented `EXPOSE_INFRA_BIND_ADDR=127.0.0.1` explaining that it controls only postgres, pgbouncer and redis, and that `0.0.0.0` exposes them to every network the host is on.
5. Leave `docker-compose.e2e-emulators.yaml:151-154` as it is. Its `!reset []` still frees `127.0.0.1:5432` and `127.0.0.1:6379` for `test-ingress`. PgBouncer now renders as `127.0.0.1:6432` in CI, which does not conflict with `test-ingress`.

### Phase 3: production overlay and opt-in overlay (D5, D6)

1. `docker-compose.prod.yaml`: append `postgres`, `redis`, `pgbouncer` and `ai-gateway-postgres` entries, each with `ports: !reset []`, plus a one-line comment pointing at `docker-compose.expose-infra.yaml`.
2. New `docker-compose.expose-infra.yaml`, with a header comment giving its purpose, usage and the last-`-f` requirement:
   ```yaml
   services:
     postgres:
       ports:
         - "${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:${EXPOSE_DB_PORT:-5432}:5432"
     pgbouncer:
       ports:
         - "${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:${EXPOSE_PGBOUNCER_PORT:-6432}:6432"
     redis:
       ports:
         - "${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:${EXPOSE_REDIS_PORT:-6379}:6379"
   ```

### Phase 4: test stacks bind to loopback (D7)

Prefix each data-plane mapping with `${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}:`. Leave the port numbers unchanged.

- `docker-compose.e2e.yaml:117, 137, 165`. After Phase 1, `pgbouncer-test` publishes only `6433`, which is what `.env.e2e` and the comments intend. Nothing references `localhost:6432` for the e2e stack (searched).
- `docker-compose.e2e-local.yaml:17, 37, 62`
- `docker-compose.e2e-simple.yaml:17, 37` and `server/docker-compose.e2e-simple.yaml:17, 37`
- `docker-compose.e2e-with-worker.yaml:17, 37` and `server/docker-compose.e2e-with-worker.yaml:17, 37`
- `docker-compose.playwright-deps.yaml:13, 25`
- `docker-compose.playwright-workflow-deps.yml:9, 22`
- `docker-compose.test-citus.yaml:13`
- `ee/temporal-workflows/docker-compose.yaml:61`
- `scripts/tests/test-compose.yml:7`

### Phase 5: regression guard (D8)

1. New `scripts/tests/compose-port-exposure.test.mjs` (`node:test`, no npm dependencies). It runs `docker compose -p guard <files> config --format json` with dummy values for the variables that are `:?`-required (`NEXT_PUBLIC_BASE_URL`, `E2E_CALLBACK_TLS_DIR`) and asserts the following:
   - `prebuilt.base + prebuilt.ce` and `prebuilt.base + prebuilt.ee`: no `ports` entry on `postgres`, `pgbouncer` or `redis`, and no `ports` entry with `target` 5432, 6432 or 6379 on any service. The target check catches a new data-plane service added with a published port. Don't assert "nothing but server/hocuspocus publishes": `prebuilt.ee` `workflow-worker` publishes a container-only `"3000"`, which is out of scope here.
   - `base + ce + prod` and `base + ee + prod`: same assertion for postgres, pgbouncer, redis and ai-gateway-postgres.
   - `base + ce`, `base + ee`, `docker-compose.yaml + base + ee`: every postgres, pgbouncer, redis and ai-gateway-postgres port has `host_ip == "127.0.0.1"`.
   - With `EXPOSE_INFRA_BIND_ADDR=0.0.0.0`, the dev render shows `0.0.0.0`. This proves the variable is wired through.
   - `prebuilt.base + prebuilt.ce + expose-infra`: exactly one `127.0.0.1` binding each for 5432, 6432 and 6379.
   - Every test compose file listed in Phase 4: no data-plane port without a `127.0.0.1` host IP. Supply dummy values for any variable a file needs in order to render on its own.
2. New `.github/workflows/compose-port-exposure-guard.yml`, modeled on `secret-bootstrap-guard.yml`, running on `pull_request` and on pushes to `main`. Ubuntu runners ship Compose v2.24 or later. Print `docker compose version` in the job for traceability.

### Phase 6: documentation

Follow `alga-tech-doc-writing` conventions. Write it as operator guidance. Do not frame it as an incident.

1. `docs/getting-started/setup_guide.md:193-195`: rewrite **Network Exposure**.
   - By default only `server` (3000) and `hocuspocus` (1234) are published. Postgres, PgBouncer and Redis are reachable only on the compose network.
   - Explain why a host firewall alone is not enough: Docker's published-port rules are evaluated before ufw/firewalld. Filtering a published port needs the `DOCKER-USER` chain, so the safe default is to not publish at all.
   - **Host access (same machine):** append `-f docker-compose.expose-infra.yaml` as the last file, which binds to `127.0.0.1`. Show the full command and how to verify it with `docker ps --format '{{.Names}}\t{{.Ports}}'`.
   - **Remote access:** prefer an SSH tunnel to the loopback port (`ssh -L 5432:127.0.0.1:5432 host`). If a direct bind is really needed, set `EXPOSE_INFRA_BIND_ADDR` to one private or VPN interface address, never `0.0.0.0`, and restrict it in `DOCKER-USER`.
   - **Merge semantics:** override files and `extends` add to `ports:` and never replace it. Removing a published port in your own override needs `ports: !reset []` (Compose 2.24 or later). Show a short example. This recipe is mainly for narrowing the dev stacks or the app ports.
   - **Maintenance without host ports:** `docker compose exec postgres psql …` and the existing `pg_dump` backup/restore commands already use `docker exec`, so they are unaffected.
2. `docs/getting-started/setup_guide.md` **Upgrading** (`:459`): add a note that upgrading recreates postgres, pgbouncer and redis without host ports. Data in `postgres_data` is untouched. Anything on the host that connected to `localhost:5432/6432/6379` needs the overlay.
3. `docs/getting-started/setup_guide.md:457`: remove the stray `cies` line left from an earlier edit.
4. `docs/getting-started/setup_guide_windows.md:186-188`: same Network Exposure rewrite. On Docker Desktop, `127.0.0.1` bindings are reachable from Windows and WSL `localhost`.
5. `docs/getting-started/docker_compose.md`: state the port policy (base definitions publish nothing; ce/ee bind to loopback; prod resets), the Compose 2.24 or later requirement for the prod overlay, and `EXPOSE_INFRA_BIND_ADDR`.
6. `docs/getting-started/development_guide.md`: a short note that infra ports are loopback-only. Setting `EXPOSE_INFRA_BIND_ADDR` is needed only when another machine or a container on another network must reach them. Containers on `app-network` should use service names.
7. `ee/docs/extension-system/local-development.md:329, 500`: `RUNNER_DEBUG_REDIS_URL=redis://host.docker.internal:6379` cannot reach a loopback-bound port (`host-gateway` is the bridge IP, not `127.0.0.1`). Document attaching the runner to `app-network` and using `redis://redis:6379`, or setting `EXPOSE_INFRA_BIND_ADDR` for that session.

## Internal tooling audit

These results come from a sweep of the nm-skills library, the alga-dev board and its XO state, existing card-review environments, nm-kube-config and this repo. "Loopback" means the dev-stack default. "Unpublished" means the prebuilt/prod default.

| Consumer | Loopback | Unpublished | Action |
|---|---|---|---|
| Board TCP readiness probe from hub over tailnet (`observeReadiness`/`hostAddress`) | **breaks** | breaks | Phase 0b, merge gate |
| `wire_to_env.py:299` regex that matches only `0.0.0.0` | **degrades silently** (falls back to `.env`; `--discover` drops stacks with no `server/.env`; cross-project detection off) | breaks | Phase 0 |
| `alga-local-wirein/SKILL.md:649-675` prebuilt-infra recipe | fine | breaks (prebuilt) | Phase 0: use the `expose-infra` overlay |
| Review `/health` wrapper services (check `127.0.0.1:<port>` on the host) | fine | n/a (dev stacks stay published) | none |
| `xo/wire-up.sh`, `AlgaGlindaReset.ts`, `stack-up` verifier | fine | n/a | none |
| `alga-env-manager/find_ports.py`, `alga-test-env-setup/detect_ports.py`, `find_open_port.py`, `dev-env.sh` | fine (address-agnostic) | n/a | none |
| `alga-env-prebuilt` (uses `docker exec … psql`) | fine | fine | none |
| nm-kube-config e2e Argo workflows | not affected | not affected | none |
| Fresh-install CI (goes through `test-ingress` on `127.0.0.1` and `docker exec`) | fine | fine | none |
| `scripts/workflow-runtime-v2-compose-smoke.mjs` (`127.0.0.1:<port>`, base+ee) | fine | n/a | none |
| `ee/server/playwright.config.ts` (`localhost`) | fine (Node 22, `localhost` → `127.0.0.1`) | n/a | none |
| `ee/docs/extension-system/local-development.md` runner debug Redis through `host.docker.internal` | breaks if pointed at compose Redis | n/a | Phase 6.7 docs |

The sweep did not cover the hub machine's live XO state and installed build, or the second card host. That host also had a since-concluded `review-dependencies` TCP readiness on 6472. Phase 0b removes the dependence regardless of host.

## Verification

**Static** (local and CI): the Phase 5 guard passes, and the render matrix above matches. All of this was prototyped against a scratch copy before this plan was written:
- Prebuilt CE/EE: no data-plane ports.
- Prebuilt plus `expose-infra`: three `127.0.0.1` bindings.
- Base + ce/ee, and `docker-compose.yaml` + base + ce/ee: `127.0.0.1` for postgres (5432), pgbouncer (6432), redis (6379) and ai-gateway-postgres (5433).
- `EXPOSE_INFRA_BIND_ADDR=0.0.0.0` flips all four.
- Base + ce + prod: none.
- Fresh-install CI combo, CE and EE: only `test-ingress` on `127.0.0.1`.

**Runtime acceptance:**
1. **Fresh CE prebuilt install** in a clean checkout, with an isolated compose project and the published `latest` image (the images are unchanged):
   - `docker ps --format '{{.Names}}\t{{.Ports}}'` shows no binding for 5432, 6432 or 6379.
   - The `setup` container completes, and login with the seeded admin works.
   - Hocuspocus connects through `:1234`.
   - Repeat the check with `-f docker-compose.expose-infra.yaml` and confirm three `127.0.0.1` bindings, plus `psql -h 127.0.0.1` working from the host.
2. **Dev stack**: bring up an isolated source-built project. Do not use the shared `alga-psa-local-test` project (see Risks). Then:
   - Confirm the `127.0.0.1` bindings.
   - Run the patched `wire_to_env.py` against it and confirm it detects postgres, pgbouncer and redis from `docker ps`, without falling back to `.env`.
   - Start `npm run dev` and load a page that hits the DB and Redis.
3. **CI**: the fresh-install E2E workflow (CE and EE matrix) and the new guard are green.

## Deliberately not doing

- **Postgres and PgBouncer authentication settings.** Owned by sibling cards. This change is independent of them and does not touch `POSTGRES_HOST_AUTH_METHOD`, `pg_hba` or PgBouncer `auth_type`.
- **App and hocuspocus ports** (`server` 3000, `hocuspocus` 1234). The reverse proxy needs them. Binding them to loopback would break the documented Nginx Proxy Manager/"docker host" setups.
- **Other dev services that publish on all interfaces**: temporal (7233/8088), ai-gateway (8081), minio, imap-test, mailhog, and hocuspocus with an unset `EXPOSE_HOCUSPOCUS_PORT` (random host port). These are not data stores and are outside this card. They are listed here as a candidate follow-up.
- **Removing `extends: docker-compose.base.yaml` from `prebuilt.ce/ee`.** The duplication between `prebuilt.base` and `base` is real. But untangling it changes the effective postgres `command`/initdb arguments, which belong to the sibling auth card. D1 makes the duplication harmless for ports.
- **IPv6 loopback (`[::1]`) bindings.** A second mapping fails on hosts with IPv6 disabled. See the risks for why IPv4-only is fine.
- **A daemon-wide `"ip": "127.0.0.1"` in `daemon.json`.** That is host policy, not repo config.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Wire-in stops seeing infra ports (the `0.0.0.0`-only regex) | Phase 0 lands first and is backward compatible. Verification step 2 proves it. |
| The board hub's TCP readiness probes reach review-stack DB/Redis ports over the tailnet | Phase 0b is a merge gate. Do not paper over it by setting `EXPOSE_INFRA_BIND_ADDR=0.0.0.0` on card hosts: that re-exposes the desktop on every network it is on. Binding to the tailnet IP alone would break local wire-in, which uses `127.0.0.1`. |
| The shared `alga-psa-local-test` stack is recreated with loopback ports while other cards are wired to it | Local wired dev servers connect through `/etc/hosts` names that resolve to `127.0.0.1`, so they keep working. Even so, don't recreate the shared stack from this branch. Validate in an isolated project, and let the stack pick up the change on its next normal recreate after merge. |
| Existing prebuilt operators relied on `host:5432` for BI tools or host-side `pg_dump` | Upgrade note plus the one-flag `expose-infra` overlay. Backup docs already use `docker exec`. |
| Clients using `localhost` resolve to `::1` first and get refused | Node 20 and later default to `autoSelectFamily` (Happy Eyeballs), libpq tries every address, and wire-in writes `127.0.0.1` host aliases. The docs recommend `127.0.0.1` in connection strings. |
| `!reset` in `prod.yaml` on Compose older than 2.24 | It fails loudly at parse time and never silently publishes. The docs state the minimum. Prebuilt does not use `!reset`, so its v2.20 minimum is unchanged. |
| A dev container reaching infra through `host.docker.internal` (extension runner debug Redis) | Documented in Phase 6.7. The only in-repo occurrence is in docs. |
| Port list drifts back later (a new service, or someone re-adds `ports:` to a base file) | Phase 5 guard in CI. |
| The change reaches a stack only when it is recreated from a checkout that contains it | Review and card stacks running older branches keep their current bindings until they are rebased or recreated. Expect Phase 0b symptoms to appear gradually after merge, not all at once. |
| Container recreation on upgrade (port config hash changes) | Expected and brief. Named volumes persist. The EE dev postgres has no named volume, but Compose carries anonymous volumes across a recreate. Note this in the PR description. |
