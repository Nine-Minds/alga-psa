import test from 'node:test';
import assert from 'node:assert/strict';
import { supportErrorPayload } from '../support-api-errors.mjs';

test('support API errors expose only approved redacted messages', () => {
  const result = supportErrorPayload({ code: 'cleanup_failure', status: 502, message: 'ENOENT /var/lib/alga-appliance/support-sessions/active.json secret=token' });
  assert.deepEqual(result, { status: 502, body: { code: 'cleanup_failure', error: 'Support resources could not be safely removed; retry is required.' } });
  const unknown = supportErrorPayload({ code: 'filesystem_internal', status: 500, message: '/private/path' });
  assert.equal(unknown.body.code, 'support_unavailable');
  assert.equal(unknown.body.error.includes('/private/path'), false);
});
