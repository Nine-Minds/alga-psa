import { describe, expect, it } from 'vitest';

describe('logger', () => {
  it('exposes standard and custom log methods', async () => {
    const logger = (await import('./logger')).default as any;

    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.system).toBe('function');
  });
});

