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

test('the production image can run the development server the Teams chain starts inside it', () => {
  // Next's TypeScript setup requires these next to `typescript`; absent, the
  // dev server tries to npm-install them at startup inside the container.
  const server = JSON.parse(read('server/package.json'));
  for (const name of ['typescript', '@types/react', '@types/react-dom', '@types/node', 'tailwindcss', 'postcss', '@tailwindcss/postcss']) {
    assert.ok(server.dependencies[name], `${name} is a regular dependency of server`);
    assert.equal(server.devDependencies?.[name], undefined, `${name} is not also a devDependency`);
  }
  assert.match(read('ee/server/Dockerfile'), /npm install --omit=dev/);
});
