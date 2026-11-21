import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const controlPlaneDir = path.join(repoRoot, 'ee', 'appliance', 'control-plane');

test('control-plane image packages existing setup/status UI and API contracts', () => {
  const dockerfile = fs.readFileSync(path.join(controlPlaneDir, 'Dockerfile'), 'utf8');
  const readme = fs.readFileSync(path.join(controlPlaneDir, 'README.md'), 'utf8');
  const runtimePackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'ee', 'appliance', 'host-service', 'package.json'), 'utf8'));

  assert.match(dockerfile, /FROM node:22-alpine AS ui-build/);
  assert.match(dockerfile, /WORKDIR \/workspace\/ee\/appliance\/status-ui/);
  assert.match(dockerfile, /RUN npm ci/);
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, /FROM node:22-alpine AS runtime/);
  assert.match(dockerfile, /apk add --no-cache bash curl kubectl/);
  assert.match(dockerfile, /https:\/\/fluxcd\.io\/install\.sh/);
  assert.match(dockerfile, /ENV ALGA_APPLIANCE_STATUS_UI_DIR=\/opt\/alga-appliance\/status-ui\/dist/);
  assert.match(dockerfile, /ENV ALGA_APPLIANCE_MODE=kubernetes-control-plane/);
  assert.match(dockerfile, /ENV ALGA_APPLIANCE_BUNDLE_ORIGIN=baked-iso/);
  assert.match(dockerfile, /COPY ee\/appliance\/host-service\/package\.json ee\/appliance\/host-service\/package-lock\.json \.\/host-service\//);
  assert.match(dockerfile, /RUN npm ci --omit=dev --prefix \.\/host-service/);
  assert.match(dockerfile, /COPY ee\/appliance\/host-service\/\*\.mjs \.\/host-service\//);
  assert.match(dockerfile, /COPY ee\/appliance\/scripts \.\/scripts/);
  assert.match(dockerfile, /COPY ee\/appliance\/manifests \.\/manifests/);
  assert.match(dockerfile, /COPY ee\/appliance\/flux \.\/flux/);
  // Release metadata is intentionally NOT baked into the control-plane image;
  // it is resolved from the OCI registry by channel at setup time.
  assert.doesNotMatch(dockerfile, /COPY ee\/appliance\/releases/);
  assert.match(dockerfile, /COPY --from=ui-build .*status-ui\/dist \.\/status-ui\/dist/);
  assert.match(dockerfile, /control-plane-entrypoint\.sh/);
  assert.match(dockerfile, /USER 10001:10001/);
  assert.match(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /CMD \["\/opt\/alga-appliance\/scripts\/control-plane-entrypoint\.sh"\]/);

  assert.equal(runtimePackage.dependencies['@kubernetes/client-node'], '1.4.0');
  assert.equal(runtimePackage.dependencies.ws, '8.21.0');

  assert.match(readme, /docker build -f ee\/appliance\/control-plane\/Dockerfile/);
  assert.match(readme, /existing static status UI/);
  assert.match(readme, /existing setup\/status API/);
});

// Ticket alga-2026-0003233: the entrypoint `exec`s into node, so any background
// job that is still a child of the entrypoint shell becomes a child of node,
// which never waits for it; it stays a zombie for the life of the container
// even with tini as PID 1. Jobs must be orphaned so tini adopts and reaps them.
test('control-plane image runs tini as PID 1 and the entrypoint orphans its background jobs', async () => {
  const dockerfile = fs.readFileSync(path.join(controlPlaneDir, 'Dockerfile'), 'utf8');
  const entrypoint = fs.readFileSync(path.join(repoRoot, 'ee', 'appliance', 'scripts', 'control-plane-entrypoint.sh'), 'utf8');

  assert.match(dockerfile, /apk add --no-cache [^\n]*\btini\b/);
  assert.match(dockerfile, /ENTRYPOINT \["\/sbin\/tini", "--"\]/);

  // Every background job before `exec node` goes through run_detached.
  const beforeExec = entrypoint.slice(0, entrypoint.indexOf('exec node /opt/alga-appliance/host-service/server.mjs'));
  assert.match(beforeExec, /run_detached \/var\/lib\/alga-appliance\/storage-reconcile\.log repair_storage/);
  assert.match(beforeExec, /run_detached \/var\/lib\/alga-appliance\/flux-controller-tuning\.log tune_flux_controllers/);
  const backgrounded = beforeExec.split('\n').filter((line) => /&\s*$/.test(line) && !/&&\s*$/.test(line));
  assert.deepEqual(backgrounded, [], 'background jobs must be started with run_detached');

  // Run the real run_detached, then exec into a long-lived process the way the
  // entrypoint execs into node: the job must not be that process's child.
  const fnStart = entrypoint.indexOf('run_detached() {');
  const runDetached = entrypoint.slice(fnStart, entrypoint.indexOf('\n}\n', fnStart) + 3);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-entrypoint-'));
  const log = path.join(tmp, 'job.log');
  const shell = spawn('sh', ['-c', `${runDetached}
job() { echo started; sleep 3; }
run_detached "$1" job
exec sleep 30`, 'entrypoint', log], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100 && !(fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('started')); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(fs.readFileSync(log, 'utf8'), /started/, 'background job did not start');
    const children = fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry)).filter((pid) => {
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) === shell.pid;
      } catch {
        return false;
      }
    });
    assert.deepEqual(children, [], 'background job is still a child of the process that exec\'d (node)');
  } finally {
    shell.kill('SIGKILL');
  }
});
