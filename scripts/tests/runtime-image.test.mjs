import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

// One runtime image definition per edition: Dockerfile (community) and
// ee/server/Dockerfile (enterprise). Everything that runs the application in a
// container, from the browser lane's candidates to the published images and
// the compose stack, is built from them; Dockerfile.build only produces the
// build artifacts they package. These checks keep a second runtime image from
// creeping back in.
const read = file => readFileSync(file, 'utf8');
// The compose files use Compose's `!reset` tag, which js-yaml does not know.
const composeSchema = yaml.DEFAULT_SCHEMA.extend(['sequence', 'mapping', 'scalar'].map(kind => new yaml.Type('!reset', { kind, construct: data => data })));
const stages = text => [...text.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gm)].map(([, image, name]) => ({ image, name }));

test('the browser lane tests the production Dockerfiles, compiled on the runner', () => {
  const workflow = yaml.load(read('.github/workflows/e2e-fresh-install-tests.yaml'));
  const servers = workflow.jobs['build-images'].strategy.matrix.include.filter(entry => entry.prebuild);
  assert.deepEqual(servers.map(entry => [entry.service, entry.edition, entry.dockerfile]),
    [['server', 'community', 'Dockerfile'], ['server-ee', 'enterprise', 'ee/server/Dockerfile']]);
  const steps = workflow.jobs['build-images'].steps;
  const build = steps.find(step => step.name === 'Build the production application on the runner');
  assert.ok(build && build.if === 'matrix.prebuild', 'the application is compiled on the runner before packaging');
  assert.ok(steps.indexOf(build) < steps.findIndex(step => step.name?.startsWith('Build and export')));
  for (const entry of servers) {
    const runtime = stages(read(entry.dockerfile)).at(-1).image;
    assert.match(runtime, /^node:(\d+\.\d+\.\d+)-alpine$/, `${entry.dockerfile} runs on a pinned Alpine Node image`);
    assert.equal(entry.node, runtime.match(/^node:([\d.]+)-alpine$/)[1], `${entry.service} compiles on the Node version its image runs on`);
  }
});

test('server candidates are labelled and tagged with their source tree for reuse after merge', () => {
  const workflow = yaml.load(read('.github/workflows/e2e-fresh-install-tests.yaml'));
  const steps = workflow.jobs['build-images'].steps;
  const tree = steps.find(step => step.id === 'tree');
  assert.match(tree.run, /git rev-parse 'HEAD\^\{tree\}'/);
  const build = steps.find(step => step.id === 'export_image');
  assert.match(build.with.labels, /com\.nineminds\.source-tree=\$\{\{ steps\.tree\.outputs\.tree \}\}/);
  assert.match(build.with.labels, /org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/);
  const tag = steps.find(step => step.name === 'Tag the candidate with its source tree');
  assert.equal(tag.if, "env.IMAGE_TRANSPORT == 'registry' && matrix.prebuild");
  assert.match(tag.run, /imagetools create --tag "\$REGISTRY_REFERENCE:tree-\$TREE" "\$REGISTRY_REFERENCE@\$BUILD_REPORTED_DIGEST"/);
  // After the identity record, so the record binds the run's own tag.
  assert.ok(steps.indexOf(tag) > steps.findIndex(step => step.name === 'Record actual published candidate image identity'));
});

test('the artifact builders build and export, and never run', () => {
  for (const file of ['Dockerfile.build', 'ee/server/Dockerfile.build']) {
    const text = read(file);
    const last = stages(text).at(-1);
    assert.deepEqual(last, { image: 'scratch', name: 'artifacts' }, `${file} ends in the artifacts stage`);
    assert.doesNotMatch(text, /^(ENTRYPOINT|CMD|EXPOSE)\b/m, `${file} defines no runtime`);
    assert.match(text, /COPY --from=builder \/artifacts \//);
    assert.match(text, /cp -R \/app\/server\/\.next \/artifacts\/server\/\.next/);
  }
  const exporter = read('scripts/export-production-artifacts.sh');
  assert.match(exporter, /--target artifacts/);
  assert.match(exporter, /--output "type=local,dest=\."/);
});

test('the compose stack and the local tag script build the runtime image, not a second one', () => {
  const compose = yaml.load(read('docker-compose.prod.yaml'), { schema: composeSchema });
  assert.equal(compose.services.server.build.dockerfile, 'Dockerfile');
  assert.equal(compose.services.server.build.args, undefined, 'the production Dockerfile takes no build arguments');
  const tagScript = read('scripts/set-image-tag.sh');
  assert.match(tagScript, /export-production-artifacts\.sh" community/);
  assert.match(tagScript, /-f Dockerfile \\/);
  assert.doesNotMatch(tagScript, /-f Dockerfile\.build/, 'the artifact builder is never tagged as a runnable image');
});

test('both runtime images ship the workspace packages their runtime imports resolve to', () => {
  // npm links @alga-psa/* from the lockfile whether or not packages/ exists;
  // the shared-secret probe imports @alga-psa/core/secrets inside every service.
  for (const file of ['Dockerfile', 'ee/server/Dockerfile']) {
    const text = read(file);
    assert.match(text, /^COPY \.\/packages\/ \.\/packages\/$/m, `${file} copies the workspace packages`);
    assert.match(text, /test -f \/app\/packages\/core\/dist\/index\.js/, `${file} refuses to package without the core runtime export`);
    // The browser lane runs the server as 1000:1000; a page render that cannot
    // create logs/ in /app/server throws, and the image optimizer writes .next/cache.
    assert.match(text, /^COPY --chown=1000:1000 \.\/server\/\.next \.\/server\/\.next$/m, `${file} hands .next to the runtime user`);
    assert.match(text, /^RUN chown 1000:1000 \/app\/server \/app\/server\/tsconfig\.json$/m, `${file} hands the server directory to the runtime user`);
  }
});

test('a restored webpack cache is actually reusable on a fresh checkout', () => {
  // Next folds the server-action encryption key into the webpack cache version
  // and generates one per build unless it is provided.
  const workflow = yaml.load(read('.github/workflows/e2e-fresh-install-tests.yaml'));
  const build = workflow.jobs['build-images'].steps.find(step => step.name === 'Build the production application on the runner');
  assert.match(build.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, /^[A-Za-z0-9+/]{43}=$/, 'the candidates build with a fixed, test-only key');
  // Fresh checkouts give every file a new mtime; webpack must fall back to
  // content hashes or every restored module snapshot is invalid.
  const config = read('server/next.config.mjs');
  assert.match(config, /config\.snapshot = \{ \.\.\.config\.snapshot, module: byContent, resolve: byContent/);
  assert.match(config, /const byContent = \{ timestamp: true, hash: true \};/);
  // Nx refuses cache entries written on another machine unless told otherwise.
  assert.match(read('scripts/build-production-server.sh'), /^export NX_REJECT_UNKNOWN_LOCAL_CACHE=0$/m);
});

test('development-mode checks compile in the development runtime, never in the production candidate', () => {
  // The production image carries production dependencies only; `next dev`
  // needs every workspace package, so the Teams development server and the
  // Microsoft callback run from the checkout in docker-compose.e2e-development.yaml
  // with the node_modules the shard installed from the lockfile.
  const workflow = yaml.load(read('.github/workflows/e2e-fresh-install-tests.yaml'));
  const steps = workflow.jobs['production-browser'].steps;
  const resolve = steps.find(step => step.id === 'shard');
  assert.ok(resolve.run.includes('*" api "*|*" upgrade "*|*" citus "*|*" teams "*|*" microsoft "*) workspace_dependencies=true'), 'teams and microsoft install the repository dependencies');
  for (const name of ['Start explicit Teams development configuration', 'Run actual Microsoft callback against isolated authority']) {
    const step = steps.find(entry => entry.name === name);
    assert.match(step.run, /export E2E_DEVELOPMENT_WORKSPACE="\$GITHUB_WORKSPACE"/, `${name} mounts the checkout`);
    assert.match(step.run, /COMPOSE_FILE="\$COMPOSE_FILE:docker-compose\.e2e-development\.yaml/, `${name} layers the development runtime`);
  }
  assert.match(read('ee/server/Dockerfile'), /npm install --omit=dev/);
  assert.match(read('Dockerfile'), /npm install --omit=dev/);
  // /app is the mounted checkout: a mount point directly under it would be
  // materialised as an untracked file in the checkout and fail the wrapper's
  // clean-source check, which is exactly what happened to the callback once.
  const teams = steps.find(entry => entry.id === 'teams_development_server');
  assert.doesNotMatch(teams.run, /target: '\/app\/[^/']+'/, 'the Teams override mounts nothing directly under the checkout');
  assert.doesNotMatch(teams.run, /\/app\/(start-teams-development-ci|check-teams-development-auth|capture-teams-static-chunks)\.mjs/, 'the Teams harness runs from its checkout paths');
  assert.match(steps.find(entry => entry.id === 'teams_auth_preflight').run, /\/app\/e2e-tests\/harness\/check-teams-development-auth\.mjs/);
});
