// Regression guard for the compose port policy:
//
//   - Deployment stacks (prebuilt CE/EE, source-built prod overlay) publish no
//     Postgres, PgBouncer or Redis ports.
//   - Dev and test stacks publish them on 127.0.0.1 unless
//     EXPOSE_INFRA_BIND_ADDR says otherwise.
//   - docker-compose.expose-infra.yaml is the opt-in way to publish them.
//
// Pure node:test, no npm dependencies. Renders each stack with
// `docker compose config --format json`, which needs neither secrets nor images.
//
// Run: node --test scripts/tests/compose-port-exposure.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Reading /dev/null as the env file keeps a developer's local .env from
// changing the render. (A temp file would not work with snap-packaged Docker,
// which cannot read the host /tmp.)
const EMPTY_ENV_FILE = '/dev/null';

// Variables that some files require (`:?`). The values are never used.
const DUMMY_ENV = {
  NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
  E2E_CALLBACK_TLS_DIR: '/tmp/compose-port-guard-tls',
};

const DATA_PLANE_TARGETS = new Set([5432, 6432, 6379]);
const DATA_PLANE_SERVICES = ['postgres', 'pgbouncer', 'redis', 'ai-gateway-postgres'];

function render(files, extraEnv = {}) {
  const env = { ...process.env, ...DUMMY_ENV, ...extraEnv };
  // Variables that would change which files or addresses Compose uses.
  delete env.COMPOSE_FILE;
  delete env.COMPOSE_PROFILES;
  if (!('EXPOSE_INFRA_BIND_ADDR' in extraEnv)) delete env.EXPOSE_INFRA_BIND_ADDR;

  const args = ['compose', '-p', 'guard', '--env-file', EMPTY_ENV_FILE];
  for (const file of files) args.push('-f', file);
  args.push('config', '--format', 'json');

  const result = spawnSync('docker', args, {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `docker compose config failed for [${files.join(', ')}]:\n${result.stderr}`
  );
  return JSON.parse(result.stdout);
}

function portsOf(config, serviceName) {
  return config.services?.[serviceName]?.ports ?? [];
}

// Every published/exposed port whose container target is a data-plane port, on any service.
function dataPlaneBindings(config) {
  const found = [];
  for (const [service, definition] of Object.entries(config.services ?? {})) {
    for (const port of definition.ports ?? []) {
      if (DATA_PLANE_TARGETS.has(Number(port.target))) {
        found.push({ service, ...port });
      }
    }
  }
  return found;
}

const describeBinding = (b) =>
  `${b.service} ${b.host_ip ?? '*'}:${b.published ?? ''}->${b.target}`;

function assertNoDataPlanePorts(config, label) {
  for (const service of DATA_PLANE_SERVICES) {
    assert.deepEqual(
      portsOf(config, service),
      [],
      `${label}: ${service} must not publish any port`
    );
  }
  const stray = dataPlaneBindings(config);
  assert.deepEqual(
    stray.map(describeBinding),
    [],
    `${label}: no service may publish 5432, 6432 or 6379`
  );
}

function assertLoopbackOnly(config, label, expectedAddr = '127.0.0.1') {
  const bindings = dataPlaneBindings(config);
  for (const service of DATA_PLANE_SERVICES) {
    for (const port of portsOf(config, service)) {
      assert.equal(
        port.host_ip,
        expectedAddr,
        `${label}: ${service} port ${port.published}->${port.target} must bind ${expectedAddr}`
      );
    }
  }
  for (const binding of bindings) {
    assert.equal(
      binding.host_ip,
      expectedAddr,
      `${label}: ${describeBinding(binding)} must bind ${expectedAddr}`
    );
  }
}

function assertPublishes(config, service, target, label) {
  assert.ok(
    portsOf(config, service).some((p) => Number(p.target) === target),
    `${label}: ${service} should publish ${target}`
  );
}

const PREBUILT_CE = ['docker-compose.prebuilt.base.yaml', 'docker-compose.prebuilt.ce.yaml'];
const PREBUILT_EE = ['docker-compose.prebuilt.base.yaml', 'docker-compose.prebuilt.ee.yaml'];
const DEV_CE = ['docker-compose.base.yaml', 'docker-compose.ce.yaml'];
const DEV_EE = ['docker-compose.base.yaml', 'docker-compose.ee.yaml'];
const PROD_CE = [...DEV_CE, 'docker-compose.prod.yaml'];
const PROD_EE = [...DEV_EE, 'docker-compose.prod.yaml'];
const EXPOSE_INFRA = 'docker-compose.expose-infra.yaml';

describe('deployment stacks publish no data-plane ports', () => {
  test('prebuilt CE', () => {
    assertNoDataPlanePorts(render(PREBUILT_CE), 'prebuilt CE');
  });

  test('prebuilt EE', () => {
    assertNoDataPlanePorts(render(PREBUILT_EE), 'prebuilt EE');
  });

  // docker-compose.prod.yaml needs Docker Compose 2.24 or later (`!reset`).
  test('source-built CE with the prod overlay', () => {
    assertNoDataPlanePorts(render(PROD_CE), 'base+ce+prod');
  });

  test('source-built EE with the prod overlay', () => {
    assertNoDataPlanePorts(render(PROD_EE), 'base+ee+prod');
  });
});

describe('dev stacks bind data-plane ports to loopback', () => {
  const stacks = [
    ['base+ce', DEV_CE],
    ['base+ee', DEV_EE],
    ['docker-compose.yaml+base+ce', ['docker-compose.yaml', ...DEV_CE]],
    ['docker-compose.yaml+base+ee', ['docker-compose.yaml', ...DEV_EE]],
  ];

  for (const [label, files] of stacks) {
    test(`${label}: postgres, pgbouncer, redis and ai-gateway-postgres are on 127.0.0.1`, () => {
      const config = render(files);
      assertPublishes(config, 'postgres', 5432, label);
      assertPublishes(config, 'pgbouncer', 6432, label);
      assertPublishes(config, 'redis', 6379, label);
      assertPublishes(config, 'ai-gateway-postgres', 5432, label);
      assertLoopbackOnly(config, label);
    });
  }

  test('EXPOSE_INFRA_BIND_ADDR=0.0.0.0 moves every data-plane binding', () => {
    for (const [label, files] of stacks) {
      const config = render(files, { EXPOSE_INFRA_BIND_ADDR: '0.0.0.0' });
      assertPublishes(config, 'postgres', 5432, label);
      assertLoopbackOnly(config, `${label} with EXPOSE_INFRA_BIND_ADDR=0.0.0.0`, '0.0.0.0');
    }
  });

  test('de-duplicates identical mappings from docker-compose.yaml and ce/ee', () => {
    const config = render(['docker-compose.yaml', ...DEV_EE]);
    for (const service of ['postgres', 'pgbouncer', 'redis']) {
      assert.equal(portsOf(config, service).length, 1, `${service} should publish exactly one port`);
    }
  });
});

describe('docker-compose.expose-infra.yaml', () => {
  function assertExactlyThreeLoopbackBindings(config, label) {
    const bindings = dataPlaneBindings(config);
    assert.equal(bindings.length, 3, `${label}: ${bindings.map(describeBinding).join(', ')}`);
    for (const target of DATA_PLANE_TARGETS) {
      const matches = bindings.filter((b) => Number(b.target) === target);
      assert.equal(matches.length, 1, `${label}: exactly one binding for ${target}`);
      assert.equal(matches[0].host_ip, '127.0.0.1', `${label}: ${target} must bind 127.0.0.1`);
    }
  }

  test('prebuilt CE + expose-infra gives one loopback binding each for 5432, 6432, 6379', () => {
    assertExactlyThreeLoopbackBindings(render([...PREBUILT_CE, EXPOSE_INFRA]), 'prebuilt CE+expose-infra');
  });

  test('prebuilt EE + expose-infra gives one loopback binding each for 5432, 6432, 6379', () => {
    assertExactlyThreeLoopbackBindings(render([...PREBUILT_EE, EXPOSE_INFRA]), 'prebuilt EE+expose-infra');
  });

  test('prod overlay + expose-infra gives one loopback binding each for 5432, 6432, 6379', () => {
    assertExactlyThreeLoopbackBindings(render([...PROD_CE, EXPOSE_INFRA]), 'base+ce+prod+expose-infra');
  });

  test('EXPOSE_INFRA_BIND_ADDR is honored by the overlay', () => {
    const config = render([...PREBUILT_CE, EXPOSE_INFRA], { EXPOSE_INFRA_BIND_ADDR: '10.1.2.3' });
    for (const binding of dataPlaneBindings(config)) {
      assert.equal(binding.host_ip, '10.1.2.3', describeBinding(binding));
    }
  });
});

describe('fresh-install CI combination', () => {
  const CI_BASE = [
    'docker-compose.base.yaml',
    'docker-compose.ce.yaml',
    'docker-compose.prod.yaml',
    'docker-compose.setup-ubuntu.override.yaml',
    'docker-compose.imap-test.yaml',
    'docker-compose.e2e-emulators.yaml',
  ];

  for (const [label, files] of [
    ['CE', CI_BASE],
    ['EE', [...CI_BASE, 'docker-compose.e2e-ee.yaml']],
  ]) {
    test(`${label}: only test-ingress publishes data-plane ports, on 127.0.0.1`, () => {
      const bindings = dataPlaneBindings(render(files));
      assert.ok(bindings.length > 0, 'test-ingress should publish the emulated ports');
      for (const binding of bindings) {
        assert.equal(binding.service, 'test-ingress', describeBinding(binding));
        assert.equal(binding.host_ip, '127.0.0.1', describeBinding(binding));
      }
    });
  }
});

describe('test stacks bind data-plane ports to loopback', () => {
  // Port that each file publishes for its test database, cache or pooler.
  const testStacks = {
    'docker-compose.e2e.yaml': [5433, 6380, 6433],
    'docker-compose.e2e-local.yaml': [5433, 6380, 6434],
    'docker-compose.e2e-simple.yaml': [5433, 6380],
    'server/docker-compose.e2e-simple.yaml': [5433, 6380],
    'docker-compose.e2e-with-worker.yaml': [5433, 6380],
    'server/docker-compose.e2e-with-worker.yaml': [5433, 6380],
    'docker-compose.playwright-deps.yaml': [5432, 6380],
    'docker-compose.playwright-workflow-deps.yml': [5439, 16379],
    'docker-compose.test-citus.yaml': [5433],
    'ee/temporal-workflows/docker-compose.yaml': [5432],
    'scripts/tests/test-compose.yml': [6379],
    '.github/docker-compose.yaml': [5433],
  };

  for (const [file, publishedPorts] of Object.entries(testStacks)) {
    test(`${file}`, () => {
      const config = render([file]);
      const bindings = dataPlaneBindings(config);
      assert.deepEqual(
        bindings.map((b) => Number(b.published)).sort((a, b) => a - b),
        [...publishedPorts].sort((a, b) => a - b),
        `${file}: unexpected set of published data-plane ports`
      );
      for (const binding of bindings) {
        assert.equal(binding.host_ip, '127.0.0.1', `${file}: ${describeBinding(binding)}`);
      }
    });
  }

  test('pgbouncer-test in docker-compose.e2e.yaml publishes only 6433', () => {
    const ports = portsOf(render(['docker-compose.e2e.yaml']), 'pgbouncer-test');
    assert.deepEqual(
      ports.map((p) => Number(p.published)),
      [6433]
    );
  });
});
