/**
 * Basic test to verify test infrastructure is working
 */

import { describe, it, expect } from 'vitest';

describe('Basic Test Infrastructure', () => {
  it('should run a simple test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle async operations', async () => {
    const result = await Promise.resolve('test');
    expect(result).toBe('test');
  });

  it('should verify environment variables are loaded', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });
});