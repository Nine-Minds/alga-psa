# Scratchpad

## Decisions

- Users choose the initial admin password on the appliance setup screen.
- Do not revive `server/seeds/dev`; production appliance should create a real tenant/admin and then run onboarding seeds.
- Store initial tenant values in a Kubernetes Secret for the bootstrap Job.

## Validation

- `cd ee/appliance/status-ui && npm run build`
- `PATH="<fake-flux>:$PATH" node --test ee/appliance/host-service/tests/setup-engine.preflight.test.mjs ee/appliance/host-service/tests/setup-engine.workflow.test.mjs ee/appliance/host-service/tests/t003-first-boot-smoke.test.mjs ee/appliance/host-service/tests/status-engine.test.mjs`

## Relevant files

- `ee/appliance/status-ui/app/setup/page.tsx`
- `ee/appliance/host-service/setup-engine.mjs`
- `ee/appliance/host-service/server.mjs`
- `helm/templates/appliance-bootstrap-configmap.yaml`
- `helm/templates/jobs.yaml`
- `server/scripts/create-tenant.ts`
- `ee/server/src/lib/testing/tenant-creation.ts`
