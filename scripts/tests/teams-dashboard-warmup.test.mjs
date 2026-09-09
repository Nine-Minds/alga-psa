import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { warmTeamsDashboard } from '../../e2e-tests/harness/warm-teams-dashboard.mjs';

async function fixture(t, defect) {
  const calls = [], sockets = new Set();
  const server = http.createServer(async (req, res) => {
    calls.push(req.url);
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.url === '/api/auth/csrf') {
      res.setHeader('Set-Cookie', ['authjs.csrf-token=csrf%7Csigned; Path=/; HttpOnly; SameSite=Lax']);
      return json({ csrfToken: 'csrf' });
    }
    if (req.url === '/api/auth/callback/credentials') {
      let body = ''; for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      if (!req.headers.cookie?.includes('authjs.csrf-token=csrf%7Csigned') || form.get('csrfToken') !== 'csrf'
        || form.get('userType') !== 'internal' || form.get('email') !== 'fixture@example.test'
        || form.get('password') !== 'synthetic-password' || req.headers['x-auth-return-redirect'] !== '1') {
        res.statusCode = 403; return res.end();
      }
      res.setHeader('Set-Cookie', ['authjs.session-token.0=part1; Path=/; HttpOnly', 'authjs.session-token.1=part2; Path=/; HttpOnly',
        'authjs.csrf-token=; Max-Age=0; Path=/']);
      return json({ url: defect === 'wrong-origin' ? 'https://unexpected.example/dashboard'
        : defect === 'auth-redirect' ? `${origin}/auth/msp/signin?error=CredentialsSignin` : `${origin}/msp/dashboard` });
    }
    if (!req.headers.cookie?.includes('authjs.session-token.0=part1') || !req.headers.cookie?.includes('authjs.session-token.1=part2')
      || req.headers.cookie?.includes('authjs.csrf-token')) { res.statusCode = 401; return res.end(); }
    if (req.url === '/api/auth/session') return json({ user: { email: defect === 'wrong-session' ? 'other@example.test' : 'fixture@example.test' } });
    if (defect === 'timeout') return;
    if (defect === 'http-redirect') { res.writeHead(302, { Location: '/auth/msp/signin' }); return res.end(); }
    if (defect === 'server-error') res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    // Simulate cold compilation: response is streamed and only valid at EOF.
    res.write('<html>');
    setTimeout(() => res.end(defect === 'missing-dashboard' ? '</html>'
      : `<main data-automation-id="dashboard-main"></main>${defect === 'error-boundary' ? '<script>$RX("B:0")</script>' : ''}</html>`), 30);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { calls, run: () => warmTeamsDashboard({ timeoutMs: defect === 'timeout' ? 150 : 2000,
    env: { E2E_BASE_URL: origin, E2E_DATABASE_ISOLATED: 'true', E2E_TEAMS_DEVELOPMENT: 'true',
      E2E_USER_EMAIL: 'fixture@example.test', E2E_USER_PASSWORD: 'synthetic-password' } }) };
}
test('warms a streamed dashboard through real CSRF, credential and chunked session cookies', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).status, 'passed');
  assert.deepEqual(f.calls, ['/api/auth/csrf', '/api/auth/callback/credentials', '/api/auth/session', '/msp/dashboard']);
});
for (const defect of ['wrong-origin', 'auth-redirect', 'wrong-session', 'http-redirect', 'server-error', 'missing-dashboard', 'error-boundary', 'timeout']) {
  test(`rejects ${defect} without retrying authentication or following redirects`, async t => {
    const f = await fixture(t, defect); await assert.rejects(f.run());
    assert.equal(f.calls.filter(path => path === '/api/auth/callback/credentials').length, 1);
    assert.equal(f.calls.includes('/auth/msp/signin'), false);
  });
}
