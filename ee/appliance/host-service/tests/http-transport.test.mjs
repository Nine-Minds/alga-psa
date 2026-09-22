import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { absoluteHostname, diagnoseResolution, httpsRequest } from '../http-transport.mjs';

function makeTlsFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { key, cert, ca: fs.readFileSync(cert) };
}

function startServer(handler, fixture) {
  const server = https.createServer({ key: fs.readFileSync(fixture.key), cert: fs.readFileSync(fixture.cert) }, handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('absoluteHostname appends a trailing dot and is idempotent', () => {
  assert.equal(absoluteHostname('ghcr.io'), 'ghcr.io.');
  assert.equal(absoluteHostname('ghcr.io.'), 'ghcr.io.');
});

test('diagnoseResolution reports no configured servers rather than guessing', async () => {
  const result = await diagnoseResolution([], 'ghcr.io');
  assert.equal(result.ok, false);
  assert.equal(result.addresses.length, 0);
  assert.match(result.error, /No DNS servers configured/);
});

test('httpsRequest sends a POST body and returns the response body over a trusted TLS fixture', async () => {
  const fixture = makeTlsFixture();
  let received = null;
  const { server, port } = await startServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  }, fixture);

  try {
    const response = await httpsRequest(`https://127.0.0.1:${port}/register`, 5000, [], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim_code: 'ABC' }),
      requestOptions: { ca: fixture.ca }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).ok, true);
    assert.equal(received.method, 'POST');
    assert.equal(received.body, JSON.stringify({ claim_code: 'ABC' }));
    assert.equal(received.headers['content-length'], String(Buffer.byteLength(received.body)));
  } finally {
    server.close();
  }
});

test('httpsRequest rejects a redirect for credential-bearing requests', async () => {
  const fixture = makeTlsFixture();
  const { server, port } = await startServer((_req, res) => {
    res.writeHead(307, { location: 'https://example.invalid/register' });
    res.end();
  }, fixture);

  try {
    await assert.rejects(
      () => httpsRequest(`https://127.0.0.1:${port}/register`, 5000, [], {
        method: 'POST',
        body: '{}',
        rejectRedirects: true,
        requestOptions: { ca: fixture.ca }
      }),
      /Refusing to follow/
    );
  } finally {
    server.close();
  }
});

test('httpsRequest rejects a non-HTTPS or unparseable URL clearly', async () => {
  await assert.rejects(
    () => httpsRequest('http://example.test/register', 1000, []),
    /only https:/
  );
  await assert.rejects(
    () => httpsRequest('not-a-url', 1000, []),
    /Unsupported request URL/
  );
});

test('httpsRequest verifies the server certificate and records its own lookup address on failure', async () => {
  const fixture = makeTlsFixture();
  const { server, port } = await startServer((_req, res) => res.end('ok'), fixture);
  try {
    let error;
    try {
      await httpsRequest(`https://example.test:${port}/`, 5000, [], {
        lookup: (_hostname, options, callback) => {
          if (options && options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
          else callback(null, '127.0.0.1', 4);
        },
        requestOptions: { ca: fixture.ca }
      });
    } catch (err) {
      error = err;
    }
    assert.ok(error, 'a certificate-name mismatch must reject');
    // TLS certificate verification is enforced (the cert is not valid for
    // example.test); SNI uses the URL hostname, never the resolved address.
    assert.match(String(error.code || error.message), /ERR_TLS_CERT_ALTNAME_INVALID|certificate|altnames/i);
    // The failed connection's own lookup is recorded for diagnostics.
    assert.deepEqual(error.lookupAddresses, ['127.0.0.1']);
    assert.equal(error.lookupHostname, 'example.test');
  } finally {
    server.close();
  }
});

test('an OCI-style redirect drops Authorization on a cross-host hop', async () => {
  const fixture = makeTlsFixture();
  const receivedAuthorization = [];
  const { server: target, port: targetPort } = await startServer((req, res) => {
    receivedAuthorization.push(req.headers.authorization || null);
    res.writeHead(200);
    res.end('blob');
  }, fixture);
  const { server: redirector, port: redirectorPort } = await startServer((_req, res) => {
    res.writeHead(307, { location: `https://localhost:${targetPort}/blob` });
    res.end();
  }, fixture);

  try {
    const response = await httpsRequest(`https://127.0.0.1:${redirectorPort}/v2/x/blobs/abc`, 5000, [], {
      headers: { Authorization: 'Bearer secret-token' },
      followRedirects: true,
      requestOptions: { ca: fixture.ca }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'blob');
    assert.equal(receivedAuthorization[0], null, 'Authorization must not cross to the redirect host');
  } finally {
    redirector.close();
    target.close();
  }
});
