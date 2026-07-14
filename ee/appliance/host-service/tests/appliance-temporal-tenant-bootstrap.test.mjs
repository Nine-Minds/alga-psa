import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('appliance bootstrap delegates initial tenant creation to local Temporal', () => {
  const bootstrap = read('helm/templates/appliance-bootstrap-configmap.yaml');
  const jobs = read('helm/templates/jobs.yaml');
  const values = read('helm/values.yaml');

  assert.match(
    bootstrap,
    /Creating initial appliance tenant and admin user \(Temporal tenantCreationWorkflow\)/
  );
  assert.match(bootstrap, /node \/app\/server\/scripts\/appliance-create-tenant\.mjs/);
  assert.doesNotMatch(bootstrap, /npx tsx \/app\/server\/scripts\/create-tenant\.ts/);

  assert.match(jobs, /- name: TEMPORAL_ADDRESS[\s\S]*setup\.applianceBootstrap\.temporal\.address/);
  assert.match(jobs, /- name: TEMPORAL_NAMESPACE[\s\S]*setup\.applianceBootstrap\.temporal\.namespace/);
  assert.match(jobs, /- name: TEMPORAL_TASK_QUEUE[\s\S]*setup\.applianceBootstrap\.temporal\.taskQueue/);
  assert.match(values, /address: ""/);
  assert.match(values, /namespace: "default"/);
  assert.match(values, /taskQueue: "tenant-workflows"/);
});

test('appliance bootstrap remains concurrent so Temporal can start while it waits', () => {
  const jobs = read('helm/templates/jobs.yaml');
  const algaCoreRelease = read('ee/appliance/flux/base/releases/alga-core.yaml');
  const background = read('ee/appliance/flux/base/background/kustomization.yaml');

  assert.match(jobs, /if not \.Values\.setup\.applianceBootstrap\.enabled/);
  assert.match(jobs, /"helm\.sh\/hook": post-install,post-upgrade/);
  assert.match(algaCoreRelease, /install:[\s\S]*disableWait: true/);
  assert.match(algaCoreRelease, /upgrade:[\s\S]*disableWait: true/);
  assert.match(background, /\.\.\/releases\/temporal\.yaml/);
  assert.match(background, /\.\.\/releases\/temporal-worker\.yaml/);
});

test('appliance Temporal client uses an idempotent fixed workflow execution', () => {
  const client = read('server/scripts/appliance-create-tenant.mjs');

  assert.match(client, /const workflowId = 'appliance-initial-tenant'/);
  assert.match(client, /workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY'/);
  assert.match(client, /taskQueue/);
  assert.match(client, /skipCustomerTracking: true/);
  assert.match(client, /skipWelcomeEmail: true/);
  assert.match(client, /emailProvider: 'smtp'/);
  assert.match(client, /tenantId/);
  assert.match(client, /password/);
});

test('Temporal worker image includes package exports required by tenant setup', () => {
  const dockerfile = read('ee/temporal-workflows/Dockerfile');
  const dockerignore = read('.dockerignore');

  assert.match(dockerfile, /WORKDIR \/app\/packages\/core\s+RUN npm run build/);
  assert.match(dockerfile, /WORKDIR \/app\/packages\/db\s+RUN npm run build/);
  assert.match(
    dockerfile,
    /COPY --from=development \/app\/packages\/core\/dist \/app\/packages\/core\/dist/
  );
  assert.match(
    dockerfile,
    /COPY --from=development \/app\/packages\/db\/dist \/app\/packages\/db\/dist/
  );
  assert.match(dockerfile, /WORKDIR \/app\/packages\/email\s+RUN npm install --ignore-scripts && npm run build/);
  assert.match(
    dockerfile,
    /COPY --from=development \/app\/packages\/email\/dist \/app\/packages\/email\/dist/
  );
  assert.match(dockerfile, /import\('@alga-psa\/email\/providerConfig'\)/);
  assert.match(dockerignore, /!packages\/email\/dist\/\*\*/);
});

test('EE application image requires onboarding seed runtime package exports', () => {
  const dockerfile = read('ee/server/Dockerfile');
  const dockerignore = read('.dockerignore');

  assert.match(dockerfile, /test -f \/app\/packages\/core\/dist\/index\.js/);
  assert.match(dockerfile, /test -f \/app\/packages\/db\/dist\/index\.js/);
  assert.match(dockerignore, /!packages\/core\/dist\/\*\*/);
  assert.match(dockerignore, /!packages\/db\/dist\/\*\*/);
});

test('appliance temporal-worker hashing matches the appliance app without changing hosted defaults', () => {
  const applianceValues = read('ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml');
  const workerDefaults = read('ee/helm/temporal-worker/values.yaml');
  const appDefaults = read('helm/values.yaml');

  assert.match(applianceValues, /encryption:[\s\S]*iterations: "1000"/);
  assert.match(workerDefaults, /encryption:[\s\S]*iterations: "10000"/);
  assert.match(appDefaults, /crypto:[\s\S]*iteration: 1000/);
});

test('app images package the production appliance admin reset entrypoint', () => {
  const prebuilt = read('ee/server/Dockerfile');
  const built = read('ee/server/Dockerfile.build');
  assert.match(prebuilt, /COPY \.\/server\/scripts\/ \.\/server\/scripts\//);
  assert.match(built, /COPY --from=builder \/app\/server\/scripts\/ \.\/server\/scripts\//);
  assert.match(read('server/scripts/appliance-reset-admin-password.mjs'), /resetInitialAdminPassword/);
});
