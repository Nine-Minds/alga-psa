import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const controlPlaneDir = path.join(repoRoot, 'ee', 'appliance', 'control-plane');

test('control-plane image packages existing setup/status UI and API contracts', () => {
  const dockerfile = fs.readFileSync(path.join(controlPlaneDir, 'Dockerfile'), 'utf8');
  const readme = fs.readFileSync(path.join(controlPlaneDir, 'README.md'), 'utf8');

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
  assert.match(dockerfile, /COPY ee\/appliance\/host-service\/\*\.mjs \.\/host-service\//);
  assert.match(dockerfile, /COPY ee\/appliance\/scripts \.\/scripts/);
  assert.match(dockerfile, /COPY ee\/appliance\/manifests \.\/manifests/);
  assert.match(dockerfile, /COPY ee\/appliance\/flux \.\/flux/);
  assert.match(dockerfile, /COPY ee\/appliance\/releases \.\/releases/);
  assert.match(dockerfile, /COPY --from=ui-build .*status-ui\/dist \.\/status-ui\/dist/);
  assert.match(dockerfile, /control-plane-entrypoint\.sh/);
  assert.match(dockerfile, /USER 10001:10001/);
  assert.match(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /CMD \["\/opt\/alga-appliance\/scripts\/control-plane-entrypoint\.sh"\]/);

  assert.match(readme, /docker build -f ee\/appliance\/control-plane\/Dockerfile/);
  assert.match(readme, /existing static status UI/);
  assert.match(readme, /existing setup\/status API/);
});
