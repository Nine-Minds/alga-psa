import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
const entry = fileURLToPath(new URL('../../e2e-tests/harness/start-teams-development-ci.mjs', import.meta.url));
for (const [name, nodeEnv, mode] of [['production override', 'production', 'true'], ['missing opt-in', 'development', 'false']]) {
  test(`Teams development startup rejects ${name} before credential access or server startup`, () => {
    const child = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 5000,
      env: { PATH: process.env.PATH, NODE_ENV: nodeEnv, TEAMS_EMULATOR_MODE: mode } });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /requires explicit development configuration/);
    assert.doesNotMatch(child.stderr, /ENOENT|Missing NEXTAUTH_SECRET/);
    assert.equal(child.stdout, '');
  });
}

test('Teams development compose supplies CSS configuration that generates dialog layout utilities', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const workflow = yaml.load(readFileSync(path.join(root, '.github/workflows/e2e-fresh-install-tests.yaml'), 'utf8'));
  const step = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
    .find(step => step.id === 'teams_development_server');
  const generator = step.run.match(/node --input-type=module <<'JS'\n([\s\S]*?)\nJS/)[1];
  const temporary = mkdtempSync(path.join(tmpdir(), 'teams-development-css-'));
  try {
    const generated = spawnSync(process.execPath, ['--input-type=module', '-e', generator], {
      encoding: 'utf8', env: { ...process.env, GITHUB_WORKSPACE: root, RUNNER_TEMP: temporary },
    });
    assert.equal(generated.status, 0, generated.stderr);
    const { services: { server } } = JSON.parse(readFileSync(path.join(temporary, 'teams-development-compose.json'), 'utf8'));
    // The development runtime (docker-compose.e2e-development.yaml) mounts the
    // whole checkout at /app, so the CSS configuration and the source trees
    // Tailwind scans are the checkout's own; the step's override adds nothing
    // for them and must not shadow them.
    const runtime = yaml.load(readFileSync(path.join(root, 'docker-compose.e2e-development.yaml'), 'utf8'));
    const workspace = runtime.services.server.volumes.find(volume => volume.target === '/app');
    assert.equal(workspace.type, 'bind');
    assert.match(workspace.source, /^\$\{E2E_DEVELOPMENT_WORKSPACE/);
    assert.match(step.run, /export E2E_DEVELOPMENT_WORKSPACE="\$GITHUB_WORKSPACE"/);
    assert.match(step.run, /COMPOSE_FILE="\$COMPOSE_FILE:docker-compose\.e2e-development\.yaml:/);
    for (const target of ['/app/packages', '/app/ee', '/app/server/postcss.config.mjs', '/app/server/tailwind.config.ts', '/app/node_modules']) {
      assert.equal(server.volumes.find(volume => volume.target === target), undefined, `${target} comes from the mounted checkout`);
    }
    const app = path.join(temporary, 'app');
    mkdirSync(path.join(app, 'server'), { recursive: true });
    symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'));
    for (const target of ['/app/packages', '/app/ee', '/app/server/postcss.config.mjs', '/app/server/tailwind.config.ts']) {
      // Lay the checkout's files out as the container sees them: configuration
      // copied so its discovery behaves like the mount, source trees linked so
      // Tailwind's content scan reaches them.
      const source = path.join(root, target.slice('/app/'.length));
      const destination = path.join(temporary, target);
      if (target.endsWith('.mjs') || target.endsWith('.ts')) writeFileSync(destination, readFileSync(source));
      else symlinkSync(source, destination);
    }
    writeFileSync(path.join(app, 'server/compile.mjs'), `
      import postcss from 'postcss';
      import config from './postcss.config.mjs';
      const plugins = await Promise.all(Object.entries(config.plugins).map(async ([name, options]) =>
        (await import(name)).default(options)));
      const result = await postcss(plugins).process('@tailwind utilities;', { from: 'src/app/globals.css' });
      process.stdout.write(result.css);
    `);
    const compiled = spawnSync(process.execPath, ['compile.mjs'], {
      cwd: path.join(app, 'server'), encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024,
    });
    assert.equal(compiled.status, 0, compiled.stderr);
    // These utilities position the dialog and make its contents reachable in
    // the viewport. An HTTP 200 stylesheet containing raw directives is insufficient.
    for (const rule of [/\.fixed\s*\{\s*position: fixed/, /\.flex\s*\{\s*display: flex/,
      /\.overflow-y-auto\s*\{\s*overflow-y: auto/, /\.max-w-3xl\s*\{\s*max-width: 48rem/]) {
      assert.match(compiled.stdout, rule);
    }
    assert.doesNotMatch(compiled.stdout, /@tailwind/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
