import { describe, expect, it } from 'vitest';

describe('application Next.js dev origin configuration', () => {
  it('allows the loopback origin used by the browser', async () => {
    const { default: nextConfig } = await import('../../../next.config.mjs');

    expect(nextConfig.allowedDevOrigins).toContain('127.0.0.1');
  });
});
