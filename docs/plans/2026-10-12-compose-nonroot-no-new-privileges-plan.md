# Run Compose Services Non-Root with no-new-privileges: Plan

PSA ticket: alga-2026-0002681. Branch: `feature/hardening-run-compose-services-non-root-with-no`.

## Goal

The application containers (server, setup, workflow-worker, email-service) and Redis run as a non-root uid. Every service in the deployment compose files sets `no-new-privileges`. Long-running app containers drop all Linux capabilities.

Any root work moves into one short-lived, capability-limited init container that exits before the app starts. That covers fixing ownership on volumes, bind mounts and secret files that older installs created as root. The same images keep working under helm and on the appliance, and those deployments get matching `securityContext` settings.

## Current state (verified on `d6dc22c273`)

### Images

| Image | Built from | Runtime user today | Notes |
|---|---|---|---|
| CE server (`ghcr.io/nine-minds/alga-psa-ce`) | `Dockerfile.build` | root (no `USER`) | `.next` is copied `--chown=1000:1000` (:118) and `/app/server` plus `tsconfig.json` are chowned to 1000 (:141), so it is already partly prepared for uid 1000. |
| EE server (`ghcr.io/nine-minds/alga-psa-ee`) | `ee/server/Dockerfile.build` | root | Same partial prep (:122, :154). The appliance and hosted run this image, not the CE one. |
| workflow-worker | `services/workflow-worker/Dockerfile` | root | `COPY --from=builder /app /app` (:194), so everything is root-owned. Base `node:22-bookworm-slim` has `node`=1000. Also shipped to hosted via nm-kube-config argo builds. |
| email-service | `services/email-service/Dockerfile` | root | Same pattern (:87). Base `node:20.19-alpine` has `node`=1000. Also shipped to hosted. |
| redis (compose) | `redis/Dockerfile` (`FROM redis:latest`) | root | `redis/entrypoint.sh:45` runs `exec redis-server` directly, which skips the official entrypoint's `setpriv` drop. Config is written to `/usr/local/etc/redis/redis.conf` world-readable, password included. There is no `dir` setting, so `save 20 1` writes `dump.rdb` into the root-owned WORKDIR `/app/redis`. |
| hocuspocus | `hocuspocus/Dockerfile` | root, then `gosu nodejs` | Starts as root to read 0600 secrets and drops privileges (`hocuspocus/entrypoint.sh:119`). |
| pgbouncer, postgres | upstream images plus wrappers | root, then a drop | Both read secrets as root before dropping (`postgres/alga-postgres-entrypoint.sh:92,119`). |
| server (dev stack) | `Dockerfile.dev` | root | Used by `docker-compose.ce.yaml`/`ee.yaml` without the prod overlay. It runs `npm run dev` and writes into `/app`. |

### Compose deployment paths

- **Prebuilt (the documented install):** `docker-compose.prebuilt.base.yaml` + `docker-compose.prebuilt.{ce,ee}.yaml`. The server extends `server/docker-compose.prebuilt.yaml`.
- **Source-built production:** `docker-compose.base.yaml` + `docker-compose.{ce,ee}.yaml` + `docker-compose.prod.yaml`. The prod overlay switches the server build to `Dockerfile.build`.
- **Source-built dev:** base + ce/ee, which uses `Dockerfile.dev`.
- **CI fresh-install:** `.github/workflows/e2e-fresh-install-tests.yaml` builds every image above from source.

There is no `security_opt` in any deployment-path compose file. The only one is in `docker-compose.test.yml:18`. No deployment service sets `user:` or `cap_drop`.

### What breaks if we only add `USER node`

The reporter's run worked because their host user was uid 1000 and they never wrote a tenant secret. In general, five things break:

1. **Host secret files are unreadable.** `scripts/generate-secrets.sh:58` and `docs/getting-started/setup_guide.md:103` create `secrets/*` with mode 0600, owned by whoever ran setup: root under `sudo`, 1001 on GitHub runners, and so on. Compose file secrets are bind mounts that keep the host owner and mode, so uid 1000 cannot read them. Every entrypoint reads them, starting with the compose `entrypoint:` override `cat /run/secrets/db_password_server` (`docker-compose.prebuilt.ce.yaml:69`).
2. **Tenant-secret writes are refused.** No CE compose sets `SECRET_FS_BASE_PATH`, so the store root is `/run/secrets` (`packages/core/src/lib/secrets/fsSecretCore.ts:192-200`). `ensureWriteBasePath` refuses a root that the running uid does not own (`fsSecretCore.ts:325-328`). Docker creates `/run/secrets` as root, and only `./secrets/tenants` is bind-mounted below it (`docker-compose.prebuilt.ce.yaml:54-56`, `:286-288`). Today root passes this check only by accident.
3. **The `files_data` volume is root-owned.** A new named volume copies the ownership of the image directory, but `/data/files` does not exist in the image, so the volume starts as `root:root 0755`. On existing installs, every file in it is root-owned.
4. **The workflow-worker's local storage is unwritable.** Neither worker sets `STORAGE_LOCAL_BASE_PATH`, so the default is `<cwd>/tmp/storage` (`server/src/config/storage.ts:37-39`). For the worker that is `/app/services/workflow-worker/tmp/storage`, which is root-owned. Email-attachment actions (`services/workflow-worker/src/actions/registerEmailAttachmentActions.ts`) would fail with EACCES.
5. **Redis cannot write.** Its config path and its RDB directory are root-owned. With `stop-writes-on-bgsave-error yes`, a failed BGSAVE makes Redis reject writes.

### Adjacent existing bug (affects scope, see Open question 2)

The prebuilt CE and EE server mounts `files_data:/data/files` but never sets `STORAGE_LOCAL_BASE_PATH` (only `docker-compose.ce.yaml:37` does). Uploads therefore go to `/app/server/tmp/storage` in the container layer, not the volume, and are lost when the container is recreated. The workflow-worker has neither the mount nor the variable.

### no-new-privileges and snap Docker (verified on this workstation)

On Ubuntu 26.04 with Docker installed as a **snap** (Docker 29.8.0, runc 1.5.1), any container started with `no-new-privileges` fails immediately with `exec ...: operation not permitted`. That includes `busybox id` run as root. The kernel audit log shows `apparmor="DENIED" operation="exec" info="no new privs" profile="snap.docker.dockerd"`: the snap's AppArmor confinement cannot transition to the container profile once NNP is set. `apparmor=unconfined` and `seccomp=unconfined` do not help. The Ubuntu Server installer offers the docker snap, so some customers will be on it. Making the setting unconditional would leave those installs unable to start any container. Apt and docker-ce installs are not affected.

`cap_drop: [ALL]` with `--user 1000` works on the same host.

### Helm and appliance (summary)

- `helm/values.yaml:153-162`: `podSecurityContext: {}` and `securityContext: {}`, with the hardening example commented out. The templates already wire both into the server pod and its init container (`helm/templates/deployment.yaml:97-98,124-125,188-189`). `ee/helm/workflow-worker/values.yaml:133,136` and `ee/helm/email-service/values.yaml:160-161` are also `{}`.
- Once the images get `USER node`, every pod without a `runAsUser` runs as 1000. That covers hosted (`nm-kube-config/alga-psa/sebastian.values.yaml:111-119` is commented out) and the appliance.
- **Appliance:** it runs the EE server image with `persistence.mountPath: /data/files` on a local-path PVC. local-path is hostPath-backed, so `fsGroup` does not apply. Existing files are root-owned.
- **Appliance shared tenant secrets:** a hostPath at `/var/lib/alga-appliance/tenant-secrets` with `DirectoryOrCreate` (`helm/values.yaml:536-538`). It is created root 0755 and written by three consumers: server, email-service and temporal-worker. temporal-worker is already pinned to `runAsUser: 0` because of this (`ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml:19-25`). The ownership check in `fsSecretCore` means all three must run as the **same uid**.
- **Helm Redis** uses the official `redis:latest` with a `command:` override that writes `/etc/redis/redis.conf` and runs `redis-server` directly (`helm/templates/redis/statefulSet.yaml:38`). It runs as root regardless of `redis/Dockerfile`, which is only used by compose and CI.
- The only chown init container today is in the appliance control plane (`ee/appliance/control-plane/manifests/workload.yaml:56-72`: root, `cap_add: CHOWN` only). That is the pattern to copy.
- There are no helm test hooks. The appliance smoke scripts (`ee/appliance/tests/local-utm-smoke.sh`, `kubernetes-hosted-fresh-install-smoke.sh`) check HTTP, login and seeded users, but not uid.

## Design decisions

**D1. The runtime uid is 1000:1000 (`node`) for every service that reads Alga's app secrets: server, setup, workflow-worker, email-service and Redis.**
One uid owns the secret files, the files volume and the tenant store, so a single ownership rule covers all of them. 1000 is already the `node` user in all three Node base images, and both server Dockerfiles already chown to it. Redis runs as 1000 rather than the image's `redis` user (999) because it has to read `redis_password`, which is a 0600 file shared with the app services. A file can have only one owner, and 999 would force group-readable (0640) secrets on the host. See Open question 1.

**D2. Bake the user into the images (`USER 1000:1000`), not into compose `user:`.**
Then `docker compose exec <svc> id` reports uid 1000, and helm/k8s pick up the same default. The dev image `Dockerfile.dev` stays root: it builds and writes into `/app` at runtime, and the dev stack is not a deployment path. Because the server and setup user lives in the image, `docker-compose.ce.yaml` needs no `user:` line, and the prod overlay picks up the non-root user automatically through `Dockerfile.build`.

**D3. Root work happens only in a one-shot `runtime-permissions` init service, never in the long-running containers.**
This beats the hocuspocus pattern (start as root, then drop). That pattern leaves PID 1's entrypoint shell running as root and makes `docker compose exec` default to root. It also needs SETUID/SETGID/DAC_OVERRIDE capabilities in a container that stays up.

The init container runs on every `docker compose up`:

- **Image:** the server image (CE or EE, matching the stack).
- **Privileges:** `user: "0:0"`, `restart: "no"`, `security_opt: [no-new-privileges:${ALGA_NO_NEW_PRIVILEGES:-true}]`, `cap_drop: [ALL]`, `cap_add: [CHOWN, FOWNER, DAC_OVERRIDE, SETUID, SETGID]`. (Implementation note: SETUID/SETGID were added to the first draft's list because the final readability check runs `setpriv --reuid 1000` so it sees what the app will see. The container stays one-shot and runs with `no-new-privileges`.)
- **Script:** `/usr/local/bin/alga-runtime-permissions`, baked into both server images at a path the `./scripts` bind mount cannot shadow. Source lives at `scripts/runtime-permissions.sh`.

The script is idempotent and cheap to repeat, because it only touches entries that are not already uid 1000:

1. **`files_data`** (mounted at `/data/files`): `chown 1000:1000` on the root and on every entry not owned by 1000. Modes stay as they are. This performs the upgrade chown for existing installs.
2. **Tenant store** (`./secrets/tenants`, mounted at `/data/tenants`): chown to 1000, directories 0700, files 0600, never following symlinks. These are the semantics `scripts/repair-secret-permissions.sh --apply --uid 1000` already defines. The init script should call that logic rather than restate it, so the repair script also gets copied into the image.
3. **App secret files** (`./secrets/*` regular files, mounted at `/host-secrets`): chown to 1000:1000 with mode 0600, not following symlinks. The script then checks that uid 1000 can read each one (`setpriv --reuid 1000 --regid 1000 --clear-groups test -r`). If a file is still unreadable, for example on a filesystem that refuses chown, it fails with a clear message naming the file and the fix. This changes host ownership of `secrets/*` to uid 1000 (see Upgrade and operator impact). Root on the host can still read them. postgres, pgbouncer and hocuspocus read them as root before dropping privileges, so they are unaffected.

Every app service gets `depends_on: runtime-permissions: condition: service_completed_successfully`.

Precedent: `docker-compose.e2e-emulators.yaml:36-45` already runs a root `worker-test-state` init and then the server as `user: '1000:1000'`.

**D4. The tenant store stays at `/run/secrets/tenants`, and the image owns `/run/secrets`.**
`Dockerfile.build`, `ee/server/Dockerfile.build` and the two worker Dockerfiles add `install -d -o 1000 -g 1000 -m 0700 /run/secrets`. Verified on this host: Docker keeps the image-defined owner and mode of `/run/secrets` when it bind-mounts secret files and `./secrets/tenants` beneath it (uid 1000, 0700). The non-root process could read the secret and create files in the directory. As a result, `ensureWriteBasePath` passes without changing `fsSecretCore` or `SECRET_FS_BASE_PATH`, and app-secret reads keep resolving `/run/secrets/<name>`.

The alternative, pointing `SECRET_FS_BASE_PATH` elsewhere, would also move app-secret reads (`FileSystemSecretProvider.getAppSecret` reads `<basePath>/<name>`). That would mean either copying app secrets into a volume, as the e2e harness does, or splitting the provider's read and write roots. Both are more machinery for no gain here.

**D5. `no-new-privileges` defaults to on, with a single documented opt-out.**
Every service in the deployment-path compose files gets `security_opt: ["no-new-privileges:${ALGA_NO_NEW_PRIVILEGES:-true}"]`. This covers the app services, redis, postgres, postgres-extension-update, pgbouncer and hocuspocus. The privilege drops in postgres, pgbouncer and hocuspocus (`gosu`/`setpriv` from root) still work under NNP, because dropping privileges is not a gain.

Setting `ALGA_NO_NEW_PRIVILEGES=false` is the documented workaround for snap-installed Docker. The setup guide gets a preflight check, `snap list docker 2>/dev/null`, and an explanation.

Each file defines the list once in an `x-hardening` anchor. Anchors do not cross files, so the shape repeats per file; mark it `// LEVERAGE: pattern compose-hardening-anchor`, next to the existing `postgres-auth-entrypoint` marker.

**D6. `cap_drop: [ALL]` applies to the non-root long-running services only:** server, workflow-worker, email-service and redis, in the prebuilt files and the prod overlay. With no root process left, these services need no capabilities: Node and Redis bind ports above 1024, and Chromium already runs `--no-sandbox --disable-setuid-sandbox`.

The setup service also gets `cap_drop: [ALL]`. It writes only under the 1000-owned `/app/server` (EE `combined-migrations`, `knexfile-ee.cjs`).

The dev-stack server and setup (`Dockerfile.dev`, root) do **not** get `cap_drop`. A root process without DAC_OVERRIDE cannot read secret files owned by uid 1000.

Implementation note: in the `base+ce|ee+prod` overlay the `setup` service still builds from the dev image (root), so it does not get `cap_drop` there either. Only prebuilt `setup` (production image, uid 1000) drops all capabilities.

postgres, pgbouncer and hocuspocus keep their default capability set in this change. Each needs SETUID/SETGID/CHOWN to drop privileges, and minimizing that is a follow-up.

**D7. Redis.**
- `redis/Dockerfile`:
  - Pin `FROM redis:8.10` instead of `latest`. The pinned image ships `setpriv` and drops to `redis` in its own entrypoint.
  - `install -d -o 1000 -g 1000 -m 0700 /usr/local/etc/redis /data`, then `USER 1000:1000`.
- `redis/entrypoint.sh`:
  - Write the config with `umask 077` (0600).
  - Add `dir /data`.
  - Fail clearly if `/run/secrets/redis_password` is unreadable.
- Compose redis keeps no data volume, so data survives a restart but not a recreate, exactly as today. Adding a volume would change behavior and is out of scope.
- Helm Redis (official image) is aligned separately in D9.

**D8. Fix the storage path so non-root workers can write it.**
Set `STORAGE_LOCAL_BASE_PATH: /data/files` on the prebuilt CE and EE server, and add `files_data:/data/files` plus the variable to workflow-worker in every deployment compose file. Without this, D2 changes the worker's email-attachment path from silently writing to the container layer into failing with EACCES.

The prebuilt server change also fixes the adjacent bug: uploads land in the volume instead of the container layer. Uploads already in a running container's layer are lost on any recreate today, so this does not make upgrades worse. The release note should say so. See Open question 2.

**D9. Helm and appliance alignment.**
- **`helm/values.yaml` defaults:**
  - `podSecurityContext: {runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, fsGroupChangePolicy: OnRootMismatch, seccompProfile: {type: RuntimeDefault}}`.
  - `securityContext: {runAsNonRoot: true, allowPrivilegeEscalation: false, capabilities: {drop: [ALL]}}`.
  - The same defaults go into `ee/helm/workflow-worker` and `ee/helm/email-service` values.
- **New optional init container `fixPermissions`** in the server, email-service and temporal-worker charts:
  - Default off.
  - Runs `alga-runtime-permissions` from the server image as root, with `allowPrivilegeEscalation: false`, `capabilities: {drop: [ALL], add: [CHOWN, FOWNER, DAC_OVERRIDE]}`.
  - Targets the files PVC mount and the tenant-secret mounts (`/shared-tenant-secrets`, `/var/lib/alga/tenant-secrets`).
  - This replaces fsGroup for hostPath and local-path volumes, where kubelet does not apply it.
  - The setup Job (`helm/templates/jobs.yaml`) gets the same `securityContext` defaults.
- **Appliance profile values** (`ee/appliance/flux/profiles/single-node/values/*.yaml`):
  - Enable `fixPermissions` for alga-core and email-service.
  - Change temporal-worker from `runAsUser: 0` to 1000:1000, so all three tenant-secret consumers share a uid (`fsSecretCore` requires it).
  - The temporal-worker image's own user is a system `temporal` uid (`ee/temporal-workflows/Dockerfile:204-206`), so running it as 1000 needs its writable paths checked. See Open question 3.
- **Helm Redis** (`helm/templates/redis/statefulSet.yaml`):
  - Run as 999:999 with `fsGroup: 999`.
  - Write the config to an `emptyDir` at `/etc/redis` instead of the image path.
  - Add a root init container (CHOWN only) that chowns `/data` on the local-path PVC for existing appliance installs.
  - Helm Redis gets its password from a k8s Secret, so it needs no shared 0600 file and can use the image's own user.
- **Hocuspocus's `redis:latest` init container** only runs `redis-cli`. It gets the same non-root `securityContext`.
- **Hosted (nm-kube-config):** this repo cannot change it, but hosted pods start running as uid 1000 when the images change. Before the images reach production, deploy to a hosted dev environment and check vault/secret reads, S3 storage, and PDF and preview generation. If anything there writes to a root-owned path, set `runAsUser` explicitly in `sebastian.values.yaml` in nm-kube-config. That is a coordinated change, flagged under Rollout.

## Upgrade and operator impact

- **Existing compose installs:** `runtime-permissions` runs on the first `up` after the upgrade. It chowns `files_data`, `secrets/tenants` and `secrets/*` to uid 1000, and no manual step is needed.
  - If the host operator is uid 1000 (the common case), nothing visible changes.
  - Operators with a different uid need `sudo` to edit `secrets/*` afterwards.
  - The docs gain a short "Container user" section covering this, the `ALGA_NO_NEW_PRIVILEGES` opt-out, and a manual alternative: `sudo chown -R 1000:1000 secrets` plus `scripts/repair-secret-permissions.sh --apply --uid 1000`.
- **macOS/Windows Docker Desktop:** bind-mount ownership is virtualized there. The readability check in D3 step 3 is the safety net, and it fails loudly rather than letting the app start broken. Verify on Docker Desktop.
- **`/tmp` leftovers:** directories root created under `/tmp` (for example `/tmp/preview-cache`) survive `docker compose restart` but not a recreate. The image change forces a recreate, so this is not an issue.
- **Hosted and appliance:** the uid change reaches them through the EE and worker images, gated by D9 and the hosted verification step.

## Implementation steps

1. **`scripts/runtime-permissions.sh`:** new, idempotent, never follows symlinks. Reuses `repair-secret-permissions.sh` for the tenant store. Covered by a shell test under `scripts/tests/` that uses a tmp dir with mixed ownership (run as root in a container).
2. **Server images** (`Dockerfile.build`, `ee/server/Dockerfile.build`):
   - Create `/data/files` and `/run/secrets` owned by 1000 (0700 for secrets).
   - Copy in `alga-runtime-permissions` and the repair script.
   - Set `ENV HOME=/home/node`.
   - Add `USER 1000:1000` before `ENTRYPOINT`.
   - Check that `npm start` and `npx knex` work without a writable `/app`. npm logs go to HOME.
3. **Worker images** (`services/workflow-worker/Dockerfile`, `services/email-service/Dockerfile`): `install -d -o 1000 -g 1000 -m 0700 /run/secrets`, `install -d -o 1000 -g 1000 /data/files`, then `USER 1000:1000`. The `/app` tree stays root-owned and read-only to the process.
4. **Redis:** `redis/Dockerfile` and `redis/entrypoint.sh` per D7.
5. **Compose deployment files:**
   - Files: `docker-compose.prebuilt.base.yaml`, `docker-compose.prebuilt.ce.yaml`, `docker-compose.prebuilt.ee.yaml`, `docker-compose.base.yaml`, `docker-compose.ce.yaml`, `docker-compose.ee.yaml`, `docker-compose.prod.yaml`, plus the services they extend: `server/docker-compose.prebuilt.yaml`, `hocuspocus/docker-compose.yaml`, `pgbouncer/docker-compose.yaml`.
   - Add the `runtime-permissions` service and its `depends_on` edges, `security_opt` per D5, `cap_drop` per D6, and the storage fixes per D8.
   - In the source-built dev stack, the server image is `Dockerfile.dev`. Copy the script into that image too, at the same path, so `runtime-permissions` behaves the same in every stack. The dev stack's workers are uid 1000 and need it.
   - Confirm with `docker compose config` for each documented combination that the merged result has exactly one `security_opt` entry per service. `extends` appends lists, so a duplicate is the main thing to catch.
6. **CI and test stacks:**
   - `e2e-fresh-install-tests.yaml` runs the stack with `base:ce:prod:setup-ubuntu:imap-test:e2e-emulators` and `chmod 444 secrets/*` (:301). That keeps working, but the job should now exercise `runtime-permissions` instead of relying on 444.
   - Check that `docker-compose.e2e-emulators.yaml`'s `user: '1000:1000'` and `SECRET_FS_BASE_PATH` overrides still compose cleanly.
   - Add an assertion step that runs `docker compose exec -T <svc> id -u` and expects `1000` for server, workflow-worker, email-service and redis.
7. **Helm and appliance** per D9, including `helm template` snapshots for the default and appliance values.
8. **Docs:**
   - `docs/getting-started/setup_guide.md` and `docker_compose.md`: container user, upgrade note, snap Docker opt-out.
   - Fix `.env.example:78` (`LOG_DIR_PATH=/path/to/logs`, which uid 1000 cannot create if someone enables file logging) to a path under `/app/server/logs`.

## Test plan

| # | Scenario | How | Pass criteria |
|---|---|---|---|
| T1 | Fresh prebuilt CE install | build images locally, tag them as the prebuilt tags, generate secrets as a non-1000 host user, `up -d` | `docker compose exec <svc> id -u` is `1000` for server, workflow-worker, email-service and redis. `runtime-permissions` exits 0. Login works. |
| T2 | Upgrade | bring up the stack from `main` images (root) and create data: an upload, a tenant secret (e.g. an RMM integration credential), a workflow run, an inbound email. Then switch to the branch images and `up -d`. | Old uploads are readable and new uploads land in `files_data` (in the volume, not the container layer). Saving the tenant secret again works. Email and workflows run. No EACCES or `UnsafeSecretLocationError` in logs. |
| T3 | File uploads, previews, PDF | upload an image and a PDF, view previews, generate an invoice PDF | Previews render and Chromium launches as uid 1000 with `cap_drop: ALL`. |
| T4 | Email | IMAP inbound via `docker-compose.imap-test.yaml` (GreenMail), plus outbound notification | A ticket is created from the email and the attachment is stored. |
| T5 | Workflows | trigger a workflow with an email-attachment action | Completes. The attachment is written to `/data/files`. |
| T6 | Redis | `docker compose exec redis id -u` returns 1000, `CONFIG GET dir` returns `/data`, `BGSAVE` succeeds, and `redis.conf` is mode 0600 | All true. |
| T7 | NNP effective | `docker inspect` shows `no-new-privileges:true` on every service. `grep NoNewPrivs /proc/1/status` in each container shows 1. | All true. |
| T8 | NNP opt-out | `ALGA_NO_NEW_PRIVILEGES=false` on snap Docker (this workstation) | The stack starts. With the default on snap Docker it fails exactly as documented. |
| T9 | Source-built prod and dev | base+ce+prod and base+ce | prod: app services are 1000. dev: the server is still root and starts. Workers are 1000 in both. |
| T10 | Helm | `helm template` diffs, then install into a kind/k3d cluster with default values | Pods run as 1000, there are no CrashLoopBackOffs, and redis runs as 999. |
| T11 | Appliance | `ee/appliance/tests/local-utm-smoke.sh` on an existing-install VM upgraded in place, plus a fresh ISO install (alga-appliance-local skill) | Smoke passes. Shared tenant-secret writes from server, email-service and temporal-worker all succeed. Upload works. |
| T12 | Hosted dev | deploy EE and worker images to a hosted dev env | Log in, upload, PDF, email ingest and workflow all work as uid 1000. |

T1–T7 and T9 need a Docker host where NNP works. This workstation runs snap Docker, so either run them with the opt-out (which covers non-root and `cap_drop`) and repeat T7 on an apt/docker-ce host or VM, or run them in the appliance libvirt VM.

## Rollout

- Ship as a single PR. The image `USER` change and the compose init service have to land together, because compose installs break if the images change without the init service.
- The EE and worker image changes reach hosted on the next deploy. Hold the merge until T12 passes, or land the nm-kube-config `runAsUser` pin first if T12 finds an issue.
- Commit messages, the PR title and the branch name stay neutral: they describe hardening, not the report.

## Out of scope

- Non-root for postgres, pgbouncer and hocuspocus. They already drop privileges themselves. This change only adds NNP to them.
- A Redis persistence volume for compose.
- `readOnlyRootFilesystem`. That needs every `/tmp` and HOME write moved to an emptyDir or tmpfs, which is a separate pass.
- Dev-stack (`Dockerfile.dev`) non-root.

## Open questions

1. **Redis uid.** The card asks for Redis to drop to the `redis` user. This plan runs compose Redis as uid 1000 instead, because it reads the same 0600 `redis_password` file as the app (D1/D7). Helm Redis still runs as the `redis` user (999). Is uid 1000 acceptable, or should compose Redis be 999 with group-readable (0640, group 1000) secrets and `group_add`?
2. **Storage path fix (D8).** Setting `STORAGE_LOCAL_BASE_PATH=/data/files` on the prebuilt server fixes a separate data-persistence bug: uploads currently go to the container layer. This plan folds it in because non-root otherwise breaks the worker's attachment writes. Should it be split into its own card that merges first?
3. **Appliance temporal-worker uid.** Aligning the shared tenant-secret hostPath requires temporal-worker to run as 1000 instead of root (today) or its image `temporal` user. Its writable paths have not been checked yet. If they need root, the alternative is to pin all three appliance consumers to `runAsUser: 0` for now. That keeps the appliance at its current posture and leaves compose and helm defaults hardened.
