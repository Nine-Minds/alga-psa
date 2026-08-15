import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RunnerAuthError,
  assertRunnerAuth,
  isValidRunnerToken,
  resolveRunnerToken,
} from './runnerAuth';

describe('shared extension runner auth verification', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('resolveRunnerToken', () => {
    it('returns the first non-empty configured token', () => {
      expect(resolveRunnerToken(undefined, ' ', 'configured-token')).toBe('configured-token');
    });

    it('throws when no token is configured', () => {
      expect(() => resolveRunnerToken(undefined, null, '  ')).toThrow(RunnerAuthError);
      expect(() => resolveRunnerToken()).toThrow('runner auth token not configured');
    });

    it('rejects known development defaults in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      for (const insecure of ['local-runner-key', 'changeme', 'change-me', 'secret']) {
        expect(() => resolveRunnerToken(insecure)).toThrow(RunnerAuthError);
      }
    });

    it('accepts a known development default outside production', () => {
      vi.stubEnv('NODE_ENV', 'test');
      expect(resolveRunnerToken('local-runner-key')).toBe('local-runner-key');
    });

    it('accepts a non-default token in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(resolveRunnerToken('a-real-secret')).toBe('a-real-secret');
    });
  });

  describe('assertRunnerAuth', () => {
    it('accepts a correct token with a constant-time comparison', () => {
      expect(() => assertRunnerAuth('correct-token', 'correct-token')).not.toThrow();
    });

    it('rejects an incorrect token of the same length', () => {
      expect(() => assertRunnerAuth('correct-token', 'wrong-token-00')).toThrow(
        RunnerAuthError,
      );
    });

    it('rejects an unequal-length token without comparing', () => {
      expect(() => assertRunnerAuth('short', 'a-much-longer-configured-token')).toThrow(
        RunnerAuthError,
      );
    });

    it('rejects a missing token', () => {
      expect(() => assertRunnerAuth(null, 'configured-token')).toThrow(RunnerAuthError);
      expect(() => assertRunnerAuth(undefined, 'configured-token')).toThrow(RunnerAuthError);
      expect(() => assertRunnerAuth('', 'configured-token')).toThrow(RunnerAuthError);
    });

    it('throws when configuration is missing entirely', () => {
      expect(() => assertRunnerAuth('any-token', undefined, null)).toThrow(
        'runner auth token not configured',
      );
    });

    it('throws when production is configured with a known default', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(() => assertRunnerAuth('local-runner-key', 'local-runner-key')).toThrow(
        RunnerAuthError,
      );
    });

    it('picks the first configured candidate in precedence order', () => {
      expect(() =>
        assertRunnerAuth('primary', 'primary', 'fallback')
      ).not.toThrow();
      expect(() =>
        assertRunnerAuth('fallback', undefined, 'fallback')
      ).not.toThrow();
      expect(() =>
        assertRunnerAuth('fallback', 'primary', 'fallback')
      ).toThrow(RunnerAuthError);
    });
  });

  describe('isValidRunnerToken', () => {
    it('returns true for a correct token', () => {
      expect(isValidRunnerToken('correct-token', 'correct-token')).toBe(true);
    });

    it('returns false for an incorrect token', () => {
      expect(isValidRunnerToken('nope', 'correct-token')).toBe(false);
    });

    it('returns false for an unequal-length token', () => {
      expect(isValidRunnerToken('x', 'correct-token')).toBe(false);
    });

    it('returns false when configuration is missing', () => {
      expect(isValidRunnerToken('anything', undefined, null)).toBe(false);
    });

    it('returns false for a known default in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(isValidRunnerToken('secret', 'secret')).toBe(false);
    });
  });
});
