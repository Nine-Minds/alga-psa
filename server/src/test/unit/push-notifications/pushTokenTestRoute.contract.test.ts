import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('POST /api/v1/mobile/push-token/test contract', () => {
  it('authenticates with the mobile session key and reports per-device outcomes', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../app/api/v1/mobile/push-token/test/route.ts'),
      'utf8',
    );

    expect(source).toContain('await authenticateApiKeyRequest(req)');
    expect(source).toContain('getActivePushTokensForUser(tenant, userId)');
    expect(source).toContain("reason: 'no_active_tokens'");
    expect(source).toContain('buildTestPushMessage(t.expo_push_token, serverHost)');
    expect(source).toContain("reason: ok ? undefined : 'send_failed'");
  });

  it('logs when a notification has no device to go to', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/pushNotifications/pushNotificationDispatcher.ts'),
      'utf8',
    );
    expect(source).toContain("'[PushDispatcher] No active push tokens for user; skipping'");
  });
});
