import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertAllowedDattoBaseUrl,
  isAllowedDattoHost,
  normalizeDattoBaseUrl,
} from '@ee/lib/integrations/datto/dattoApiClient';

describe('normalizeDattoBaseUrl', () => {
  it('expands a platform name to its API URL', () => {
    expect(normalizeDattoBaseUrl('merlot')).toBe('https://merlot-api.centrastage.net/api');
    expect(normalizeDattoBaseUrl(' Pinotage ')).toBe('https://pinotage-api.centrastage.net/api');
  });

  it('accepts a bare host', () => {
    expect(normalizeDattoBaseUrl('merlot-api.centrastage.net')).toBe('https://merlot-api.centrastage.net/api');
  });

  it('accepts full URLs with or without /api and trailing slashes', () => {
    expect(normalizeDattoBaseUrl('https://concord-api.centrastage.net')).toBe('https://concord-api.centrastage.net/api');
    expect(normalizeDattoBaseUrl('https://concord-api.centrastage.net/')).toBe('https://concord-api.centrastage.net/api');
    expect(normalizeDattoBaseUrl('https://concord-api.centrastage.net/api')).toBe('https://concord-api.centrastage.net/api');
    expect(normalizeDattoBaseUrl('https://concord-api.centrastage.net/api///')).toBe('https://concord-api.centrastage.net/api');
  });

  it('drops query strings and fragments', () => {
    expect(normalizeDattoBaseUrl('https://vidal-api.centrastage.net/api?x=1#top')).toBe('https://vidal-api.centrastage.net/api');
  });

  it('throws on empty or invalid input', () => {
    expect(() => normalizeDattoBaseUrl('')).toThrow();
    expect(() => normalizeDattoBaseUrl('   ')).toThrow();
    expect(() => normalizeDattoBaseUrl('https://')).toThrow();
    expect(() => normalizeDattoBaseUrl('ftp://merlot-api.centrastage.net')).toThrow();
  });

  it('rejects plain http except for localhost', () => {
    expect(() => normalizeDattoBaseUrl('http://merlot-api.centrastage.net/api')).toThrow(/https/);
    expect(normalizeDattoBaseUrl('http://localhost:8080')).toBe('http://localhost:8080/api');
    expect(normalizeDattoBaseUrl('http://127.0.0.1:9000/api/')).toBe('http://127.0.0.1:9000/api');
  });
});

describe('Datto host allowlist', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts *.centrastage.net and *.rmm.datto.com over https', () => {
    for (const url of [
      'https://merlot-api.centrastage.net/api',
      'https://zinfandel-api.centrastage.net/api',
      'https://eu1.rmm.datto.com/api',
    ]) {
      expect(() => assertAllowedDattoBaseUrl(url)).not.toThrow();
    }
  });

  it('rejects other hosts, lookalikes, bare suffixes, ports and plain http', () => {
    for (const url of [
      'https://attacker.example/api',
      'https://centrastage.net.attacker.example/api',
      'https://evilcentrastage.net/api',
      'https://centrastage.net/api',
      'https://rmm.datto.com/api',
      'https://merlot-api.centrastage.net:8443/api',
      'http://merlot-api.centrastage.net/api',
      'https://10.0.0.5/api',
    ]) {
      expect(() => assertAllowedDattoBaseUrl(url), url).toThrow(/Datto host/);
    }
    expect(isAllowedDattoHost('')).toBe(false);
    expect(isAllowedDattoHost('MERLOT-API.CENTRASTAGE.NET')).toBe(true);
  });

  it('allows loopback only when NODE_ENV is test', () => {
    expect(() => assertAllowedDattoBaseUrl('http://localhost:8080/api')).not.toThrow();
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertAllowedDattoBaseUrl('http://localhost:8080/api')).toThrow(/Datto host/);
    expect(() => assertAllowedDattoBaseUrl('https://127.0.0.1/api')).toThrow(/Datto host/);
  });
});
