import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createProviderIngressServer } from '../../e2e-tests/harness/provider-ingress.mjs';

for (const [port, host] of [[55433, 'upgrade-citus'], [5432, 'postgres']]) {
  test(`ingress ${port} forwards bidirectional bytes only to ${host}:5432`, { timeout: 5000 }, async t => {
    const received = [];
    const sockets = new Set();
    const upstream = net.createServer(socket => {
      sockets.add(socket);
      socket.on('data', chunk => { received.push(chunk); socket.write(Buffer.from([0x52, 0x00, 0x00, 0x00, 0x08])); });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    let ingress;
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all([ingress, upstream].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
    });
    const destinations = [];
    ingress = createProviderIngressServer(port, { connect: destination => {
      destinations.push(destination);
      const socket = net.connect({ host: '127.0.0.1', port: upstream.address().port });
      sockets.add(socket);
      return socket;
    } });
    ingress.listen(0, '127.0.0.1');
    await once(ingress, 'listening');
    const client = net.connect({ host: '127.0.0.1', port: ingress.address().port });
    sockets.add(client);
    await once(client, 'connect');
    const response = once(client, 'data');
    const request = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);
    client.write(request);
    assert.deepEqual((await response)[0], Buffer.from([0x52, 0x00, 0x00, 0x00, 0x08]));
    assert.deepEqual(Buffer.concat(received), request);
    assert.deepEqual(destinations, [{ host, port: 5432 }]);
  });
}

test('unknown ingress ports cannot select an arbitrary upstream', () => {
  assert.throws(() => createProviderIngressServer(45678), /Unknown test ingress port/);
});
