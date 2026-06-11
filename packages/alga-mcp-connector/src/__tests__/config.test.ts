import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config';

describe('loadConfig (T008 — fail-fast configuration)', () => {
  it('throws listing every missing required variable', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/ALGA_INSTANCE_URL.*ALGA_API_TOKEN/s);
  });

  it('throws when only the token is missing', () => {
    expect(() => loadConfig({ ALGA_INSTANCE_URL: 'https://x.example.com' } as NodeJS.ProcessEnv)).toThrow(
      /ALGA_API_TOKEN/,
    );
  });

  it('throws on a malformed instance URL', () => {
    expect(() =>
      loadConfig({ ALGA_INSTANCE_URL: 'not a url', ALGA_API_TOKEN: 'k' } as NodeJS.ProcessEnv),
    ).toThrow(/not a valid URL/);
  });

  it('parses a valid config and strips a trailing slash', () => {
    const cfg = loadConfig({
      ALGA_INSTANCE_URL: 'https://alga.example.com/',
      ALGA_API_TOKEN: 'secret',
    } as NodeJS.ProcessEnv);
    expect(cfg.instanceUrl).toBe('https://alga.example.com');
    expect(cfg.apiToken).toBe('secret');
    expect(cfg.registryPath).toBe('/api/v1/meta/mcp-registry');
    expect(cfg.searchPath).toBe('/api/v1/search');
    expect(cfg.requestTimeoutMs).toBe(30000);
  });
});
