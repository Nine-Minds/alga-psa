# Plan: keep operator secrets and env files out of the Docker build context

- Card: 7523461d-62a7-4290-82ba-7d881437cade · PSA ticket alga-2026-0002635
- Branch: `feature/security-keep-secrets-and-server-env-out-of-the`
- Base checked: `d6dc22c273` (main). Everything below was re-verified on this commit; the brief cited `e4fed8d41b`.
- Status: design only. Nothing in this document has been implemented yet.

Commit messages, the PR title and branch names must stay neutral ("docker build context hygiene"). Do not mention the advisory, its ID or how the exposure works until the advisory is published.

## 1. What the repo does today

### 1.1 The CE self-build path

- `scripts/set-image-tag.sh:54-67` runs `docker build -f Dockerfile.build .` from the repo root. It does this when no published image matches `HEAD`, or when the worktree is dirty (`:109-118`). The setup guide (`docs/getting-started/setup_guide.md:38-40`) tells operators to re-run the script on every upgrade.
- The same guide has operators write real secrets into `secrets/` at the repo root (`:43-103`, including `mkdir -p secrets/tenants`) and create `server/.env` with `cp .env.example server/.env` (`:111`).
- `Dockerfile.build:42` runs `COPY . .` in the `builder` stage. Whatever the context holds lands in that layer and in the BuildKit cache.
- `Dockerfile.build:68-89` then writes placeholder files over `/app/secrets/*` and copies `.env.example` over `/app/.env` and `/app/server/.env`. The real files remain in the earlier `COPY . .` layer. If a real secret's filename is not in the placeholder list (for example anything under `secrets/tenants/`), it also remains in the final builder filesystem.
- The final CE stage (`Dockerfile.build:92-161`) copies only named paths from `builder`, and none of them is `/app/secrets`. The shipped CE image is clean. The exposure is the builder layer and cache, plus anywhere that cache is exported.

### 1.2 What the root `.dockerignore` misses

There are two separate gaps:

1. There is no rule for `secrets`.
2. The env rules (`.env`, `.env.local`, `.env.*.local`, `.env.development`, `.env.production`) only match at the context root. Docker anchors `.dockerignore` patterns at the context root, so these rules don't match `server/.env`, `server/.env.local` or `ee/server/.env`.

This worktree shows the problem concretely: `secrets/` holds four real files, `server/.env.local` exists, and all of them are currently sent in the context.

There is a second effect. Next.js loads `server/.env*` during `next build` (`Dockerfile.build:62-66`, cwd `/app/server`), so the operator's `NEXT_PUBLIC_*` values get baked into locally built bundles. Published images are built from clean CI checkouts, so they never get these values. Section 6, Q1 covers this.

### 1.3 Other images built from the repo root

The root `.dockerignore` is the only ignore file consulted for every image built with context `.`. That covers:

- `Dockerfile.build`
- `ee/server/Dockerfile.build`
- `Dockerfile.dev`
- `Dockerfile.test`
- `setup/Dockerfile*`
- `ee/setup/Dockerfile.dev`
- `hocuspocus/Dockerfile`
- `services/{workflow-worker,email-service,ai-gateway}/Dockerfile`
- `redis/Dockerfile`
- `ee/temporal-workflows/Dockerfile`
- `tools/ai-automation/Dockerfile.test`

These come from the `docker-compose*.y*ml` files, `.github/workflows/e2e-fresh-install-tests.yaml` and `ee/temporal-workflows/scripts/deploy.sh`. Five of them run `COPY . .` and three run `COPY server/ ./server/`, so all of them pick up the same files.

**The EE image is worse than the CE image.** `ee/server/Dockerfile.build` runs `COPY . .` at `:45`, writes placeholders at `:66-83`, and then its final stage runs `COPY --from=builder /app/secrets ./secrets` at `:138`. So any real file under the context's `secrets/` that the placeholder list doesn't overwrite, such as `secrets/tenants/*` or any extra key, would ship inside the final EE image. The root-ignore fix closes this too. Section 6, Q2 covers it.

### 1.4 The per-directory `.dockerignore` files

None of these is consulted by any build in this repo. Every Dockerfile in those directories is built with the repo root as context, and BuildKit only reads `<context>/.dockerignore` or a sibling `<Dockerfile>.dockerignore`. There are no `*.Dockerfile.dockerignore` files.

| File | Content | Used as context by | Gap if someone uses it as context |
|---|---|---|---|
| `server/.dockerignore` | `*.env*` | nothing in repo or nm-kube-config | `secrets-playwright/` (git-ignored local Playwright secret store) |
| `ee/server/.dockerignore` | `.env*` | nothing | none material |
| `setup/.dockerignore` | root-style copy | nothing (`setup/Dockerfile*` built from `.`) | none: no secrets live under `setup/` |
| `hocuspocus/.dockerignore` | `node_modules`, `npm-debug.log` | nothing (`hocuspocus/Dockerfile` built from `.`) | none: no secrets live under `hocuspocus/` |
| `ee/runner`, `packages/emulators`, `docker/dev-env` | own contexts | yes | no operator secrets in those trees |

The Argo builds in `~/nm-kube-config` (for example `e2e-testing/...k8s-native-workflow.yaml:722`, `runner/runner-build-workflow.yaml:66`) build from fresh clones, which contain no operator files. They are out of scope.

### 1.5 Do any builds need files under the paths being excluded?

No:

- No Dockerfile `COPY`s or `ADD`s `secrets/` or any `.env*` except `.env.example`, which must stay in the context. No `--mount=type=secret` points at those paths.
- `git ls-files` shows no tracked file named `.env`, `.env.local`, `.env.*.local`, `*.pem` or `*.key`. The tracked env files are `.env.example`, `.env.e2e`, `.env.localtest`, `.env.runner*`, `compose.env`, `server/.env.e2e`, `ee/server/.env.{example,test}` and `ee/temporal-workflows/.env.{e2e,example,test}`. None of them matches the new rules.
- Six tracked source directories are named `secrets`:
  - `packages/core/src/secrets`
  - `packages/core/src/lib/secrets`
  - `server/src/app/api/secrets`
  - `server/src/app/msp/settings/secrets`
  - `server/src/components/settings/secrets`
  - `shared/workflow/secrets`

  Docker anchors `.dockerignore` patterns at the context root, so `/secrets` matches only the top-level operator directory. `**/secrets` would remove all six directories and break the build. It must not be used.
- At runtime, secrets reach containers through compose `secrets:` and bind mounts to `/run/secrets/*` (`docker-compose.ce.yaml:53-61,137-144`; `server/entrypoint.sh:14`; `server/dev-entrypoint.sh:17`). Env values come from host-side `--env-file server/.env` interpolation. Neither depends on what is in the image.

## 2. Change set

### 2.1 Root `.dockerignore`

Replace the `# Environment variables` block with the block below. Leave `.env.example` reachable. Put the block after the `!…/dist` and `!server/.next` negations, or make sure no later `!` rule re-includes any of these paths (the last matching rule wins).

```dockerignore
# Operator-written secrets and local env files. These must never enter an
# image build context.
# .dockerignore patterns are anchored at the context root (unlike .gitignore):
# `/secrets` matches only the top-level operator directory. Do NOT widen it to
# `**/secrets`: real source directories use that name (packages/core/src/secrets,
# packages/core/src/lib/secrets, server/src/app/api/secrets,
# server/src/app/msp/settings/secrets, server/src/components/settings/secrets,
# shared/workflow/secrets).
/secrets
/.secrets
/secrets-playwright
server/secrets-playwright
# Env files at any depth (server/.env, ee/server/.env, ...). .env.example and
# the tracked .env.e2e / .env.test / .env.localtest fixtures stay in context.
**/.env
**/.env.local
**/.env.*.local
**/.env.development
**/.env.production
**/.env*.bak*
server/.env.localtest
# Written by scripts/set-image-tag.sh after each build; not a secret, but it
# would otherwise invalidate the COPY . . cache on every run.
.env.image
**/*.pem
```

The env patterns use `**/` deliberately. Operators write these names in several places (`server/`, `ee/server/`, `ee/temporal-workflows/`), and no tracked file matches them. That is a different situation from `secrets`, where tracked source directories share the name.

### 2.2 `server/.dockerignore`

Append `secrets-playwright` as defense in depth, in case anyone ever builds with `server/` as the context. Leave `ee/server`, `setup` and `hocuspocus` unchanged; section 1.4 explains why. Note in the PR that they were checked and are inert.

### 2.3 Regression guard: `scripts/tests/docker-build-context.test.mjs`

This is a pure `node:test` file modeled on `scripts/tests/compose-port-exposure.test.mjs`. It tests real Docker matching semantics instead of reimplementing them.

1. Create a synthetic context under the repo's git-ignored `tmp/`, not `os.tmpdir()`. Snap-packaged Docker cannot read the host `/tmp`; the compose guard notes the same limitation. Copy the root `.dockerignore` into it, then create these fixture files:
   - **Must be excluded:** `secrets/postgres_password`, `secrets/tenants/t1/x`, `.secrets`, `secrets-playwright/a`, `server/secrets-playwright/a`, `.env`, `server/.env`, `server/.env.local`, `server/.env.production.local`, `server/.env.local.bak1`, `server/.env.localtest`, `ee/server/.env`, `ee/server/.env.local`, `ee/temporal-workflows/.env`, `.env.image`, `certs/x.pem`.
   - **Must be included:** a file inside each of the six real `…/secrets/` source directories, `.env.example`, `ee/server/.env.example`, `server/.env.e2e`, `.env.localtest`, `ee/server/.env.test`, `server/src/index.ts`.
2. Run `printf 'FROM scratch\nCOPY . /\n' | docker buildx build -f - --output type=local,dest=<out> <ctx>`. This needs no base image pull, and with `-f -` BuildKit applies `<ctx>/.dockerignore`. Walk `<out>` and assert both lists.
3. Run these static checks on the real repo:
   - No `.dockerignore` in the repo contains a `**/secrets` or `secrets/**`-at-depth rule.
   - No `<Dockerfile>.dockerignore` exists next to a Dockerfile that is built with the root context. Such a file would silently override the root rule set.
   - `git ls-files` returns nothing that the new exclude patterns would match. This catches a future tracked `.env` that a build needs.
4. If `docker` or `buildx` is missing, fail when `CI` is set and skip with a clear message locally.

Add a CI job: `.github/workflows/docker-build-context-guard.yml`, named "Docker Build Context Guard", with the same triggers and shape as `compose-port-exposure-guard.yml`. Run it with `node --test scripts/tests/docker-build-context.test.mjs`.

### 2.4 Not in scope for this card

- No change to `Dockerfile.build` or `ee/server/Dockerfile.build` logic. See Q2.
- No setup-guide wording change while the advisory is unpublished. See Q3.

## 3. Acceptance verification (implementer runs these and records the output in the PR)

Create canaries first, and remove them afterwards:

```bash
echo canary-ctx-7523 > secrets/zz_ctx_canary
mkdir -p secrets/tenants/zz && echo canary-ctx-7523 > secrets/tenants/zz/key
printf 'CTX_CANARY=canary-ctx-7523\nNEXT_PUBLIC_CTX_CANARY=canary-ctx-7523\n' >> server/.env      # back up first if present
printf 'CTX_CANARY=canary-ctx-7523\n' > server/.env.local.canary-test && cp server/.env.local.canary-test ee/server/.env
```

1. **Context listing on the real repo.** Run the same `FROM scratch` / `COPY . /` buildx command against `.`, with output to `tmp/ctx-probe`. Assert:
   - no `secrets/` at the top level
   - no `server/.env`, `server/.env.local` or `ee/server/.env`
   - all six source `secrets/` directories are present
   - `.env.example` is present
2. **CE builder stage via the real script.** The canaries make the worktree dirty, so `./scripts/set-image-tag.sh` builds `<sha>-local`. Then run:
   ```bash
   docker build -f Dockerfile.build --target builder -t ctxprobe:builder .   # cache hit
   docker run --rm --entrypoint sh ctxprobe:builder -c '
     ls -la /app/secrets; ls -a /app/server | grep -i env;
     grep -rIl canary-ctx-7523 /app/secrets /app/server/.next /app/server/.env* /app/.env* 2>/dev/null; echo "grep-exit=$?"'
   ```
   Expected results:
   - `/app/secrets` holds only the 16 placeholders, with no `zz_ctx_canary` and no `tenants/`.
   - `/app/server` has only `.env` (the `.env.example` copy) and `.env.e2e`.
   - The canary grep finds nothing, including inside `.next` bundles. This proves `NEXT_PUBLIC_CTX_CANARY` was not baked in.
3. **CE image runs.** Bring up the prebuilt CE stack with `docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image up -d`, using the compose project isolation from the `alga-env-prebuilt` skill and the card's ports. Confirm that the server is healthy and that login works.
4. **EE final image.** Run `docker build -f ee/server/Dockerfile.build -t ctxprobe:ee .`, then `docker run --rm --entrypoint sh ctxprobe:ee -c 'ls -R /app/secrets'`. Expect placeholders only, with no canary.
5. **Dev stack still boots.** `Dockerfile.dev` no longer bakes in `server/.env` or `.env.local`. Rebuild and boot the dev stack once with the `alga-env-dev` flow and confirm the server comes up. Compose supplies env through `environment:`, so this is expected to work, but it needs to be proven.
6. Run `node --test scripts/tests/docker-build-context.test.mjs`. It should pass, and it should fail if `/secrets` is removed from `.dockerignore`. Check this by temporarily reverting the line.
7. Remove the canaries and restore `server/.env`.

## 4. Commit plan (neutral wording)

1. `build: exclude local secrets and env files from docker build context`: root `.dockerignore` and `server/.dockerignore`.
2. `test: guard docker build context exclusions`: the test and the CI workflow.

PR title: "Docker build context hygiene for local secrets and env files".

## 5. Risks

- **Rules that are too broad.** These would make a build fail with a missing file. The tracked-file check in 2.3 and the include fixtures mitigate this, as does a full CE and EE build in section 3.
- **Behavior change for local builds** (Q1).
- **Old BuildKit cache on operator machines** still holds earlier layers. This change does not fix that (Q3).

## 6. Open questions

- **Q1. Should local self-builds stop baking `server/.env`?** Today a local `set-image-tag.sh` build bakes the operator's `NEXT_PUBLIC_*` values from `server/.env` into the client bundle. One example is `NEXT_PUBLIC_HOCUSPOCUS_URL=ws://localhost:1234` copied from `.env.example`, which actually defeats the production auto-derive of `wss://<host>/hocuspocus`. After this change, local builds behave like published images, which never see `server/.env`.
  - **Recommendation:** accept this. It is the correct behavior and makes local and published images converge.
  - **Needs confirmation** that no CE self-build workflow depends on build-time `server/.env`.
- **Q2. Should the EE image stop shipping `/app/secrets`?** `ee/server/Dockerfile.build:138` puts the builder's `/app/secrets` (placeholders) into the final EE image. Before this fix, unmatched real context secrets would ship with it. This plan closes the leak at the context. Whether the EE image should carry a `secrets/` directory at all is a separate hardening decision.
  - **Recommendation:** check whether a sibling card from the same split covers it. If none does, raise a new card. XO decision.
- **Q3. What should operators do about existing build caches?** Operators who already self-built still have secret-bearing layers in their BuildKit cache. Telling them to run `docker builder prune` belongs in the release notes or the advisory remediation text once the advisory is published. It should not go into the setup guide now. Captain or XO to decide where that wording lives.
- **Q4. Is excluding `**/*.pem` acceptable?** Nothing tracked matches it today. It is cheap protection against stray TLS keys. Should `*.key` be excluded too? Nothing tracked matches that either. Not proposed by default.

## 7. Verification (run on the draft commits, with fresh canaries)

- Guard test: `node --test scripts/tests/docker-build-context.test.mjs` passes (6/6). With the `/secrets` line removed from `.dockerignore` it fails (2 failing tests); the line was restored.
- §3.1 context probe of the real repo (`type=tar`): no top-level `secrets/`, no `server/.env`, `server/.env.local`, `ee/server/.env` or `.env.image`; all six source `secrets/` directories and `.env.example` present; canary grep over the context empty.
- §3.2 `./scripts/set-image-tag.sh` built `<sha>-local`; `--target builder` inspection: `/app/secrets` holds the 16 placeholders only (no canary file, no `tenants/`); `/app/server` has `.env` (the `.env.example` copy) and `.env.e2e`; canary grep over `/app/secrets`, `/app/server/.next`, `/app/server/.env*`, `/app/.env*` found nothing.
- §3.3 the locally built CE image ran in an isolated prebuilt compose project on ports 43000/45432/41234/46379/46432 (scratch copy of the compose files under `tmp/`, generated secrets): setup exited 0, `/api/healthz` reported healthy, and a credentials login as the seeded admin returned a session and `/msp/dashboard` 200. The login password was set in the scratch DB for the test; production-mode logs do not print one.
- §3.4 `ee/server/Dockerfile.build` built; `ls -R /app/secrets` shows the 16 placeholders only, no canary.
- §3.5 `Dockerfile.dev` builds to completion with `server/.env*` excluded. The dev stack was not rebooted.
