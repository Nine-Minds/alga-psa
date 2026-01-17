import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./secrets', () => ({
  getSecret: vi.fn(async () => 'unit-test-secret'),
}));

describe('encryption', () => {
  beforeEach(() => {
    process.env.SALT_BYTES = '4';
    process.env.ITERATIONS = '10';
    process.env.KEY_LENGTH = '16';
    process.env.ALGORITHM = 'sha256';
  });

  it('hashPassword produces a verifiable hash', async () => {
    const { hashPassword, verifyPassword } = await import('./encryption');

    const stored = await hashPassword('p@ssw0rd');
    expect(stored).toContain(':');

    await expect(verifyPassword('p@ssw0rd', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false);
  });

  it('generateSecurePassword returns requested length', async () => {
    const { generateSecurePassword } = await import('./encryption');
    expect(generateSecurePassword(32)).toHaveLength(32);
  });
});

