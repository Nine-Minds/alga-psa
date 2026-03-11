# Scratchpad — Talos appliance GitOps Alga deployment

- Plan slug: `talos-appliance-gitops-alga-deployment`
- Created: `2026-03-10`

## What This Is

Working notes for the Talos appliance GitOps deployment path. This log captures design decisions, discovered repo constraints, and the commands/files needed to implement and validate the single-node appliance stack.

## Decisions

- (2026-03-10) Use Flux-managed GitOps for the Talos appliance instead of direct first-boot `helm upgrade --install` commands.
- (2026-03-10) Keep the runtime split across multiple Helm releases rather than forcing an umbrella-chart refactor now. Root `helm/` owns core services; EE worker charts remain separate.
- (2026-03-10) Treat "initial install" as "database not yet initialized" rather than "Helm release install" so restarts and release recreation stay safe.
- (2026-03-10) Simplify the operator entrypoint to one script: `bootstrap-site.sh` now handles the `msp` namespace, required bootstrap secrets, and profile apply. Missing values are prompted interactively when stdin is a TTY.

## Discoveries / Constraints

- (2026-03-10) This branch does not yet contain the `ee/appliance/` structure referenced by the Talos bootstrap skill, so the appliance scaffolding must be introduced here.
- (2026-03-10) The root chart already owns server, Postgres, Redis, Hocuspocus, and setup hooks, but PgBouncer exists only as Docker assets under `pgbouncer/`.
- (2026-03-10) `setup/entrypoint.sh` already performs the correct seed gate by checking for existing rows in `users`, which is the right behavior to preserve for the appliance bootstrap job.
- (2026-03-10) `helm/templates/postgres/secrets.yaml` currently generates DB credentials as a pre-install hook without preserving an existing secret, which is risky for reinstall against persisted volumes.
- (2026-03-10) The EE service charts (`workflow-worker`, `email-service`, `temporal-worker`) already exist and can be wired into a Flux profile without major chart restructuring.

## Commands / Runbooks

- (2026-03-10) `rg -n "talos|HelmRelease|cloud install|seed|bootstrap|setup" -S .`
- (2026-03-10) `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Talos appliance GitOps Alga deployment" --slug talos-appliance-gitops-alga-deployment`
- (2026-03-10) `helm template alga-core ./helm -n msp -f ee/appliance/flux/profiles/talos-single-node/values/alga-core.talos-single-node.yaml`
- (2026-03-10) `helm template pgbouncer ./ee/helm/pgbouncer -n msp -f ee/appliance/flux/profiles/talos-single-node/values/pgbouncer.talos-single-node.yaml`
- (2026-03-10) `helm template temporal ./ee/helm/temporal -n msp -f ee/appliance/flux/profiles/talos-single-node/values/temporal.talos-single-node.yaml`
- (2026-03-10) `helm template workflow-worker ./ee/helm/workflow-worker -n msp -f ee/appliance/flux/profiles/talos-single-node/values/workflow-worker.talos-single-node.yaml`
- (2026-03-10) `helm template email-service ./ee/helm/email-service -n msp -f ee/appliance/flux/profiles/talos-single-node/values/email-service.talos-single-node.yaml`
- (2026-03-10) `helm template temporal-worker ./ee/helm/temporal-worker -n msp -f ee/appliance/flux/profiles/talos-single-node/values/temporal-worker.talos-single-node.yaml`
- (2026-03-10) `kubectl kustomize ee/appliance/flux/profiles/talos-single-node`

## Validation Notes

- (2026-03-10) `helm template alga-core ./helm -n msp -f ee/appliance/flux/profiles/talos-single-node/values/alga-core.talos-single-node.yaml` succeeded.
- (2026-03-10) `helm template pgbouncer ./ee/helm/pgbouncer -n msp -f ee/appliance/flux/profiles/talos-single-node/values/pgbouncer.talos-single-node.yaml` succeeded.
- (2026-03-10) `helm template temporal ./ee/helm/temporal -n msp -f ee/appliance/flux/profiles/talos-single-node/values/temporal.talos-single-node.yaml` succeeded.
- (2026-03-10) `helm template workflow-worker ./ee/helm/workflow-worker -n msp -f ee/appliance/flux/profiles/talos-single-node/values/workflow-worker.talos-single-node.yaml` succeeded.
- (2026-03-10) `helm template email-service ./ee/helm/email-service -n msp -f ee/appliance/flux/profiles/talos-single-node/values/email-service.talos-single-node.yaml` succeeded.
- (2026-03-10) `helm template temporal-worker ./ee/helm/temporal-worker -n msp -f ee/appliance/flux/profiles/talos-single-node/values/temporal-worker.talos-single-node.yaml` succeeded.
- (2026-03-10) `kubectl kustomize ee/appliance/flux/profiles/talos-single-node` succeeded.
- (2026-03-10) Static contract checks confirmed:
  - `helm/templates/postgres/secrets.yaml` now uses `lookup` plus `helm.sh/resource-policy: keep`
  - `helm/templates/migration-hook.yaml` and `helm/templates/seed-hook.yaml` are disabled in favor of `helm/templates/jobs.yaml`
  - `helm/templates/jobs.yaml` passes `SETUP_RUN_MIGRATIONS` and `SETUP_RUN_SEEDS`
  - `setup/entrypoint.sh` reads admin credentials from env fallbacks and still performs a DB-state seed check
- (2026-03-10) `sh ee/appliance/scripts/deploy-app.sh --profile talos-single-node` fails clearly without kubeconfig as expected.
- (2026-03-10) `sh ee/appliance/scripts/bootstrap-site.sh --profile talos-single-node` fails clearly without kubeconfig as expected.
- (2026-03-10) `sh ee/appliance/scripts/bootstrap-site.sh --help` prints the simplified automation/interface contract.
- (2026-03-10) `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-10-talos-appliance-gitops-alga-deployment` succeeded.

## Links / References

- Design doc: `docs/plans/2026-03-10-talos-appliance-gitops-alga-deployment-design.md`
- Setup logic: `setup/entrypoint.sh`, `server/setup/create_database.js`
- Root chart: `helm/`
- EE charts: `ee/helm/workflow-worker`, `ee/helm/email-service`, `ee/helm/temporal-worker`
- Existing PgBouncer Docker assets: `pgbouncer/`
- Appliance Flux profile: `ee/appliance/flux/profiles/talos-single-node/`

## Open Questions

- Default image registry strategy for the appliance profile remains unresolved.
