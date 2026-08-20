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

test('support API preserves approved policy and recording error codes without details', () => {
  for (const code of [
    'pro_required', 'connected_appliance_required', 'central_service_unavailable',
    'control_plane_update_required', 'support_image_unavailable', 'expired_resume_grant',
    'recording_io_failure',
  ]) {
    const result = supportErrorPayload({ code, status: 412, message: 'secret=/private/token' });
    assert.equal(result.body.code, code);
    assert.equal(result.body.error.includes('secret'), false);
    assert.equal(result.body.error.includes('/private/token'), false);
  }
});
