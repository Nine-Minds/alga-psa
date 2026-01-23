import { describe, it, expect, vi } from 'vitest';
import {
  resolveMappingValue,
  resolveInputMapping,
  noOpSecretResolver,
  type SecretResolver,
  type MappingResolverOptions
} from '../utils/mappingResolver';
import type { MappingValue, InputMapping } from '../types';
import type { ExpressionContext } from '../expressionEngine';

describe('mappingResolver', () => {
  const createContext = (payload: unknown = {}): ExpressionContext => ({
    payload,
    vars: { temp: 'value' },
    meta: { runId: 'run-123' }
  });

  const createOptions = (
    ctx: ExpressionContext,
    secretResolver?: SecretResolver
  ): MappingResolverOptions => ({
    expressionContext: ctx,
    secretResolver
  });

  describe('resolveMappingValue', () => {
    it('resolves literal string values', async () => {
      const options = createOptions(createContext());
      const result = await resolveMappingValue('hello', options);
      expect(result).toBe('hello');
    });

    it('resolves literal number values', async () => {
      const options = createOptions(createContext());
      const result = await resolveMappingValue(42, options);
      expect(result).toBe(42);
    });

    it('resolves literal boolean values', async () => {
      const options = createOptions(createContext());
      const result = await resolveMappingValue(true, options);
      expect(result).toBe(true);
    });

    it('resolves null values', async () => {
      const options = createOptions(createContext());
      const result = await resolveMappingValue(null, options);
      expect(result).toBe(null);
    });

    it('resolves simple numeric expression values', async () => {
      const ctx = createContext({ count: 5 });
      const options = createOptions(ctx);
      const value: MappingValue = { $expr: 'payload.count + 10' };
      const result = await resolveMappingValue(value, options);
      expect(result).toBe(15);
    });

    it('resolves expression with coalesce', async () => {
      const ctx = createContext({ name: null, defaultName: 'default' });
      const options = createOptions(ctx);
      const value: MappingValue = { $expr: 'coalesce(payload.name, payload.defaultName)' };
      const result = await resolveMappingValue(value, options);
      expect(result).toBe('default');
    });

    it('resolves secret values', async () => {
      const mockResolver: SecretResolver = {
        resolve: vi.fn().mockResolvedValue('secret-value')
      };
      const options = createOptions(createContext(), mockResolver);
      const value: MappingValue = { $secret: 'API_KEY' };
      const result = await resolveMappingValue(value, options);
      expect(result).toBe('secret-value');
      expect(mockResolver.resolve).toHaveBeenCalledWith('API_KEY', undefined);
    });

    it('throws for missing secrets with noOpResolver', async () => {
      const options = createOptions(createContext());
      const value: MappingValue = { $secret: 'MISSING' };
      await expect(
        resolveMappingValue(value, options)
      ).rejects.toThrow('Secret resolution not available');
    });

    it('resolves literal arrays', async () => {
      const options = createOptions(createContext());
      const value: MappingValue = ['a', 'b', 'c'];
      const result = await resolveMappingValue(value, options);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('resolves literal objects', async () => {
      const options = createOptions(createContext());
      const value: MappingValue = {
        name: 'test',
        count: 42,
        nested: { key: 'value' }
      };
      const result = await resolveMappingValue(value, options);
      expect(result).toEqual({
        name: 'test',
        count: 42,
        nested: { key: 'value' }
      });
    });

    it('throws for invalid expressions', async () => {
      const options = createOptions(createContext());
      const value: MappingValue = { $expr: 'payload..invalid' };
      await expect(
        resolveMappingValue(value, options)
      ).rejects.toThrow();
    });

    it('throws for disallowed functions', async () => {
      const options = createOptions(createContext());
      const value: MappingValue = { $expr: '$sum([1,2,3])' };
      await expect(
        resolveMappingValue(value, options)
      ).rejects.toThrow('disallowed function');
    });
  });

  describe('resolveInputMapping', () => {
    it('returns null for undefined mapping', async () => {
      const options = createOptions(createContext());
      const result = await resolveInputMapping(undefined, options);
      expect(result).toBeNull();
    });

    it('returns empty object for empty mapping', async () => {
      const options = createOptions(createContext());
      const result = await resolveInputMapping({}, options);
      expect(result).toEqual({});
    });

    it('resolves mixed mapping fields', async () => {
      const ctx = createContext({ count: 10 });
      const mockResolver: SecretResolver = {
        resolve: vi.fn().mockResolvedValue('secret-value')
      };
      const options = createOptions(ctx, mockResolver);

      const mapping: InputMapping = {
        literal: 'constant',
        number: 42,
        fromPayload: { $expr: 'payload.count * 2' },
        secret: { $secret: 'API_KEY' }
      };
      const result = await resolveInputMapping(mapping, options);
      expect(result).toEqual({
        literal: 'constant',
        number: 42,
        fromPayload: 20,
        secret: 'secret-value'
      });
    });

    it('handles nested literal objects', async () => {
      const options = createOptions(createContext());
      const mapping: InputMapping = {
        config: {
          host: 'localhost',
          port: 8080,
          ssl: true
        }
      };
      const result = await resolveInputMapping(mapping, options);
      expect(result).toEqual({
        config: {
          host: 'localhost',
          port: 8080,
          ssl: true
        }
      });
    });

    it('handles arrays of literals', async () => {
      const options = createOptions(createContext());
      const mapping: InputMapping = {
        items: ['a', 'b', 'c']
      };
      const result = await resolveInputMapping(mapping, options);
      expect(result).toEqual({
        items: ['a', 'b', 'c']
      });
    });
  });

  describe('noOpSecretResolver', () => {
    it('throws error for any secret', async () => {
      await expect(
        noOpSecretResolver.resolve('ANY_SECRET')
      ).rejects.toThrow('Secret resolution not available in this context');
    });
  });
});
