import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  parseDurationMinutes,
  parseShell,
  parseTcpPort,
  requestHasSameOrigin,
  validatePodTarget,
} from '../pod-access-common.mjs';
import { PodExecManager } from '../pod-exec-manager.mjs';
import { PortForwardManager } from '../port-forward-manager.mjs';
import { addPodAccessRules, ensurePodAccessRbac, missingPodAccessResources } from '../pod-access-rbac.mjs';

function runningPod(uid = 'pod-uid') {
  return {
    metadata: { uid },
    status: { phase: 'Running' },
    spec: { containers: [{ name: 'app' }] },
  };
}

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.bufferedAmount = 0;
    this.messages = [];
  }

  send(value) {
    this.messages.push(JSON.parse(value));
  }

  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.emit('close');
  }
}

class FakeServer extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler;
    this.closed = false;
  }

  listen(port, address) {
    this.port = port;
    this.address = address;
    queueMicrotask(() => this.emit('listening'));
  }

  close() {
    this.closed = true;
  }
}

function quietLogger() {
  return { info() {}, error() {} };
}

test('T001 server contract applies session, origin, body-size, capability, and pod-port boundaries', () => {
  const server = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.mjs'), 'utf8');
  assert.match(server, /if \(!isAuthenticated\(req\)\)/);
  assert.match(server, /if \(!requestHasSameOrigin\(req\)\)/);
  assert.match(server, /if \(!requireSameOrigin\(req, res\) \|\| !requirePodAccessCapability\(res\)\) return/);
  assert.match(server, /Request body exceeds 16 KiB/);
  assert.match(server, /ports: \(container\.ports \|\| \[\]\)\.map/);
});

test('T001 pod access validates origin, Kubernetes targets, shells, ports, and durations', () => {
  assert.equal(requestHasSameOrigin({ headers: { host: 'appliance.test:8080', origin: 'http://appliance.test:8080' } }), true);
  assert.equal(requestHasSameOrigin({ headers: { host: 'appliance.test:8080', origin: 'http://attacker.test' } }), false);
  assert.deepEqual(validatePodTarget({ namespace: 'msp', pod: 'app-123', container: 'sebastian' }), {
    namespace: 'msp', pod: 'app-123', container: 'sebastian',
  });
  assert.equal(parseShell('AUTO'), 'auto');
  assert.equal(parseTcpPort('5432'), 5432);
  assert.equal(parseDurationMinutes(480), 480);
  assert.throws(() => validatePodTarget({ namespace: '../msp', pod: 'app', container: 'app' }));
  assert.throws(() => parseShell('zsh'));
  assert.throws(() => parseTcpPort(0));
  assert.throws(() => parseDurationMinutes(15));
});

test('T002 exec manager falls back from bash to sh, relays resize/input, and expires idle sessions', async () => {
  let now = 1_000;
  const opened = [];
  const adapter = {
    async readPod() { return runningPod(); },
    async openExec(options) {
      const record = { ...options, writes: [], sizes: [], closed: false };
      opened.push(record);
      if (options.shell === 'bash') {
        queueMicrotask(() => options.onStatus({
          status: 'Failure',
          message: 'bash was not found',
          details: { causes: [{ reason: 'ExitCode', message: '126' }] },
        }));
      }
      return {
        write(value) { record.writes.push(value); },
        resize(columns, rows) { record.sizes.push([columns, rows]); },
        close() { record.closed = true; },
      };
    },
  };
  const manager = new PodExecManager({
    adapter,
    now: () => now,
    idleMs: 500,
    startTimer: false,
    logger: quietLogger(),
  });
  const webSocket = new FakeWebSocket();
  await manager.attach(webSocket, {
    namespace: 'msp', pod: 'app-123', container: 'app', shell: 'auto', columns: 100, rows: 30,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(opened.map((entry) => entry.shell), ['bash', 'sh']);
  assert.equal(webSocket.messages.filter((message) => message.type === 'ready').at(-1).shell, 'sh');

  webSocket.emit('message', JSON.stringify({ type: 'resize', columns: 132, rows: 42 }));
  webSocket.emit('message', JSON.stringify({ type: 'input', data: 'echo ready\r' }));
  assert.deepEqual(opened[1].sizes, [[132, 42]]);
  assert.deepEqual(opened[1].writes, ['echo ready\r']);

  now += 501;
  await manager.sweep();
  assert.equal(manager.size, 0);
  assert.equal(opened[1].closed, true);
  assert.equal(webSocket.messages.some((message) => message.code === 'idle_timeout'), true);
  manager.shutdown();
});

test('T003 port-forward manager allocates, extends, expires, and stops in-memory listeners', async () => {
  let now = 10_000;
  const servers = [];
  const manager = new PortForwardManager({
    adapter: {
      async readPod() { return runningPod(); },
      async openPortForward() { return { close() {} }; },
    },
    serverFactory(handler) {
      const server = new FakeServer(handler);
      servers.push(server);
      return server;
    },
    random: () => 0,
    randomPortMin: 25_000,
    randomPortMax: 25_100,
    now: () => now,
    startTimer: false,
    logger: quietLogger(),
  });
  const created = await manager.create({
    namespace: 'msp', pod: 'db-0', container: 'app', remotePort: 5432, durationMinutes: 30,
  }, { bindAddress: '192.168.122.215', clientAddress: '192.168.122.1' });
  assert.equal(created.localPort, 25_000);
  assert.equal(created.address, '192.168.122.215:25000');
  assert.equal(manager.list().length, 1);

  const extended = manager.extend(created.id, 60);
  assert.equal(new Date(extended.expiresAt).getTime(), now + 60 * 60_000);
  now += 60 * 60_000 + 1;
  await manager.sweep();
  assert.equal(manager.list().length, 0);
  assert.equal(servers[0].closed, true);
  manager.shutdown();
});

test('T004 RBAC migration adds only missing streaming subresources and verifies authorization', async () => {
  const initial = {
    metadata: { name: 'appliance-control-plane-setup-admin', resourceVersion: '1' },
    rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['get', 'list'] }],
  };
  assert.deepEqual(missingPodAccessResources(initial), ['pods/exec', 'pods/portforward']);
  const patched = addPodAccessRules(initial);
  assert.equal(patched.changed, true);
  assert.deepEqual(patched.role.rules.at(-1), {
    apiGroups: [''], resources: ['pods/exec', 'pods/portforward'], verbs: ['get', 'create'],
  });

  let replaced = null;
  const result = await ensurePodAccessRbac({
    async readClusterRole() { return initial; },
    async replaceClusterRole(_name, role) { replaced = role; },
    async canUsePodSubresource() { return true; },
  }, { logger: quietLogger() });
  assert.equal(result.available, true);
  assert.equal(result.migrated, true);
  assert.deepEqual(missingPodAccessResources(replaced), []);

  const unavailable = await ensurePodAccessRbac({
    async readClusterRole() { throw new Error('forbidden'); },
  }, { logger: quietLogger() });
  assert.equal(unavailable.available, false);
  assert.match(unavailable.message, /forbidden/);
});

test('T004b a create-only role (shipped by earlier builds) is migrated to add get', async () => {
  // WebSocket exec issues GET; create-only roles passed the access review and
  // then 403'd the real stream ("cannot get resource pods/exec").
  const createOnly = {
    metadata: { name: 'appliance-control-plane-setup-admin', resourceVersion: '2' },
    rules: [{ apiGroups: [''], resources: ['pods/exec', 'pods/portforward'], verbs: ['create'] }],
  };
  assert.deepEqual(missingPodAccessResources(createOnly), ['pods/exec', 'pods/portforward']);

  let replaced = null;
  const result = await ensurePodAccessRbac({
    async readClusterRole() { return createOnly; },
    async replaceClusterRole(_name, role) { replaced = role; },
    async canUsePodSubresource(_subresource, verb = 'get') {
      // Model the apiserver: only what the migrated role actually grants.
      return (replaced?.rules || []).some((rule) => (rule.verbs || []).includes(verb));
    },
  }, { logger: quietLogger() });
  assert.equal(result.migrated, true);
  assert.equal(result.available, true);
  assert.deepEqual(missingPodAccessResources(replaced), []);
});

test('T004c a role already granting get+create is left alone', async () => {
  const complete = {
    metadata: { name: 'appliance-control-plane-setup-admin', resourceVersion: '3' },
    rules: [{ apiGroups: [''], resources: ['pods/exec', 'pods/portforward'], verbs: ['get', 'create'] }],
  };
  assert.deepEqual(missingPodAccessResources(complete), []);
  assert.equal(addPodAccessRules(complete).changed, false);
});
