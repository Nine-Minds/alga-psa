import assert from 'node:assert/strict';
import { postSafeOutboundForm, UnsafeUrlError } from '../dist/packages/core/src/lib/net/safeFetch.js';

// Load the emitted helper from the final image's dependency tree. Workspace
// hoisting during compilation can otherwise hide missing worker dependencies.
const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'runtime-check' });
await assert.rejects(postSafeOutboundForm('https://127.0.0.1/token', form), UnsafeUrlError);

let requests = 0;
const result = await postSafeOutboundForm('https://oauth.example.test/token', form, {
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  request: async ({ url, address, method, body }) => {
    requests++;
    assert.equal(url.hostname, 'oauth.example.test');
    assert.equal(address, '93.184.216.34');
    assert.equal(method, 'POST');
    assert.equal(new URLSearchParams(body).get('refresh_token'), 'runtime-check');
    return {
      status: 200,
      headers: {},
      body: (async function* () { yield Buffer.from('{"access_token":"runtime-access"}'); })(),
    };
  },
});
assert.equal(requests, 1);
assert.equal(result.data.access_token, 'runtime-access');
console.log('Worker OAuth runtime rejects private targets and exchanges a form through the pinned transport.');
