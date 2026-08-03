# CE Source Compose Persistence and Target Parity Plan

## Goal

Make the source-built Community Edition compose stack retain customer data across ordinary `docker compose down/up`, align the CE make target with the development-image behavior of EE, and make the getting-started documentation describe files that actually exist.

## Current code

- `docker-compose.ce.yaml` builds the server/setup image from `Dockerfile.build` and extends base services without adding PostgreSQL or application-file persistence.
- `docker-compose.base.yaml` defines PostgreSQL without a data volume; only the AI gateway database currently has a named volume.
- `Makefile` exposes separate `docker-up-ee` and `docker-up-ce` targets.
- `docs/getting-started/docker_compose.md` contains the stale CE-Dockerfile claim.

## Implementation

1. In `docker-compose.ce.yaml`, add CE-owned named volumes `postgres_data` and `files_data` at the top level.
2. Override/extend the CE `postgres` service to mount `postgres_data:/var/lib/postgresql/data`.
3. Mount `files_data` at the canonical application persistent-files directory for every CE service that reads or writes those files, matching the prebuilt CE compose contract. Confirm the path from the prebuilt compose before editing; do not guess.
4. Change the source CE server/setup build definitions and `make docker-up-ce` path to use `Dockerfile.dev` consistently with `docker-up-ee`, while retaining `EDITION=community` and CE service selection.
5. Correct `docs/getting-started/docker_compose.md` to name the shared development Dockerfile and explain that named volumes survive `down` but are removed by explicit `down -v`.
6. Keep volume names compose-project scoped and avoid external/global volumes.

## Verification

- `docker compose -f ... config` resolves both mounts and the expected Dockerfile.
- Start CE, create a database sentinel and representative uploaded/generated file, run ordinary down/up, and prove both survive.
- Run `down -v` only in an isolated test project and confirm documented destructive behavior.
- Compare CE and EE make targets/build args for intended parity without changing edition flags.

## Out of scope and risks

- Do not retrofit persistence into every base-compose consumer; scope is the CE source path.
- Do not rename existing prebuilt-stack volumes or alter production deployment storage.
- File-volume mount ownership must match the runtime UID; verify writes after recreation.
