import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { meetsPushPriorityThreshold } from '../../../lib/pushNotifications/pushTokenService';

function read(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('Per-device push priority threshold (task 35.9.2)', () => {
  it('ranks priorities low < normal < high with "low" meaning everything', () => {
    expect(meetsPushPriorityThreshold('low', 'low')).toBe(true);
    expect(meetsPushPriorityThreshold('low', 'normal')).toBe(false);
    expect(meetsPushPriorityThreshold('normal', 'normal')).toBe(true);
    expect(meetsPushPriorityThreshold('normal', 'high')).toBe(false);
    expect(meetsPushPriorityThreshold('high', 'high')).toBe(true);
    expect(meetsPushPriorityThreshold(undefined, undefined)).toBe(true);
    expect(meetsPushPriorityThreshold(null, 'high')).toBe(false);
  });

  it('stores the threshold on mobile_push_tokens with a named CHECK (Citus-safe)', () => {
    const migration = read('../../../../migrations/20260911140000_add_mobile_push_token_priority_threshold.cjs');
    expect(migration).toContain("ADD COLUMN ?? text NOT NULL DEFAULT 'low'");
    expect(migration).toContain("CHECK (?? IN ('low','normal','high'))");
    expect(migration).toContain('SELECT 1 FROM pg_constraint WHERE conname = ?');
  });

  it('lets the mobile app set the threshold at registration and via PATCH', () => {
    const route = read('../../../app/api/v1/mobile/push-token/route.ts');
    expect(route).toContain('priorityThreshold: priorityThresholdSchema.optional()');
    expect(route).toContain('export async function PATCH(');
    expect(route).toContain('updatePushPriorityThreshold(tenant, userId, parsed.deviceId, parsed.priorityThreshold)');

    const service = read('../../../lib/pushNotifications/pushTokenService.ts');
    expect(service).toContain('const thresholdPatch = priorityThreshold ? { push_priority_threshold: priorityThreshold } : {};');
    expect(service).toContain("'push_priority_threshold')");
  });
});
