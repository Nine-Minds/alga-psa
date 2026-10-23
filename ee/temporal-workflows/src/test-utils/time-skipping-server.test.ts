import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, inject, it } from 'vitest';

describe('time-skipping test server provisioning', () => {
  it('is cached locally before any engine test creates an environment', () => {
    expect(inject('temporalTimeSkippingServerProvisioned')).toBe(true);
    const cached = readdirSync(tmpdir()).filter((file) => file.startsWith('temporal-test-server-sdk-typescript-'));
    expect(cached).not.toHaveLength(0);
  });
});
