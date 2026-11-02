import { describe, expect, it } from 'vitest';
import { validateHostPattern } from '../hostPatternValidator';
import { computeEffectiveHosts } from '../fetchHostSettings';
import { BUILTIN_FETCH_HOSTS } from '../fetchHosts';

const refused = (input: string) => {
  const r = validateHostPattern(input);
  expect(r.ok, `${input} should be refused`).toBe(false);
  return r.ok ? '' : r.message;
};

describe('validateHostPattern', () => {
  it.each([
    ['scheme', 'https://files.acme.com'],
    ['scheme with path', 'https://files.acme.com/a'],
    ['path', 'files.acme.com/a'],
    ['query', 'files.acme.com?x=1'],
    ['port', 'files.acme.com:8443'],
    ['userinfo', 'user@files.acme.com'],
    ['trailing dot', 'files.acme.com.'],
    ['spaces', 'files acme.com'],
    ['empty', '   '],
  ])('refuses %s', (_l, input) => {
    refused(input);
  });

  it.each([
    ['IPv4', '203.0.113.5'],
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv6', '::1'],
    ['bracketed IPv6', '[2001:db8::1]'],
    ['decimal IPv4', '2130706433'],
    ['hex IPv4', '0x7f.0.0.1'],
  ])('refuses IP literal: %s', (_l, input) => {
    expect(refused(input)).toMatch(/IP address|port|valid host/i);
  });

  it.each(['localhost', '*.localhost', 'api.localhost', 'intranet', 'files', '*', '*.com', '*.co', '*.*.acme.com', 'a*.acme.com', 'files.*.acme.com'])(
    'refuses %s',
    (input) => {
      refused(input);
    },
  );

  it('gives the wildcard-breadth message for *.com', () => {
    expect(refused('*.com')).toMatch(/at least two labels/);
  });

  const SHARED_EXACT = [
    's3.amazonaws.com',
    's3.us-east-1.amazonaws.com',
    's3-eu-west-1.amazonaws.com',
    's3.dualstack.us-east-1.amazonaws.com',
    'blob.core.windows.net',
    'storage.googleapis.com',
    'r2.cloudflarestorage.com',
    'digitaloceanspaces.com',
    'nyc3.digitaloceanspaces.com',
    'github.io',
    'vercel.app',
  ];
  it.each(SHARED_EXACT)('refuses shared suffix %s as an exact entry, with advice', (host) => {
    const msg = refused(host);
    expect(msg).toMatch(/shared storage or hosting domain/);
    expect(msg).toMatch(/bucket or site host/);
  });

  const SHARED_WILDCARD = [
    '*.s3.amazonaws.com',
    '*.s3.us-east-1.amazonaws.com',
    '*.us-east-1.amazonaws.com',
    '*.amazonaws.com',
    '*.blob.core.windows.net',
    '*.core.windows.net',
    '*.windows.net',
    '*.storage.googleapis.com',
    '*.googleapis.com',
    '*.r2.cloudflarestorage.com',
    '*.cloudflarestorage.com',
    '*.digitaloceanspaces.com',
    '*.github.io',
    '*.vercel.app',
  ];
  it.each(SHARED_WILDCARD)('refuses shared suffix %s as a wildcard entry', (host) => {
    refused(host);
  });

  it.each([
    ['acme-uploads.s3.us-east-1.amazonaws.com', 'acme-uploads.s3.us-east-1.amazonaws.com'],
    ['acme.s3.amazonaws.com', 'acme.s3.amazonaws.com'],
    ['acme.blob.core.windows.net', 'acme.blob.core.windows.net'],
    ['acme.nyc3.digitaloceanspaces.com', 'acme.nyc3.digitaloceanspaces.com'],
    ['acme.vercel.app', 'acme.vercel.app'],
    ['*.acme-uploads.s3.us-east-1.amazonaws.com', '*.acme-uploads.s3.us-east-1.amazonaws.com'],
    ['files.acme.com', 'files.acme.com'],
    ['*.files.acme.com', '*.files.acme.com'],
    ['*.acme.com', '*.acme.com'],
    ['  Files.ACME.com ', 'files.acme.com'],
    ['bücher.example', 'xn--bcher-kva.example'],
    ['*.bücher.example', '*.xn--bcher-kva.example'],
  ])('accepts %s', (input, expected) => {
    expect(validateHostPattern(input)).toEqual({ ok: true, pattern: expected });
  });
});

describe('computeEffectiveHosts', () => {
  const builtin = BUILTIN_FETCH_HOSTS.map((h) => h.pattern);
  it('starts with the ChatGPT file host', () => {
    expect(builtin[0]).toBe('files.oaiusercontent.com');
  });
  it('is built-ins when there are no rows', () => {
    expect(computeEffectiveHosts([])).toEqual(builtin);
  });
  it('removes disabled built-ins and adds custom entries', () => {
    const rows = [
      { kind: 'builtin_disabled' as const, host_pattern: builtin[0]! },
      { kind: 'custom' as const, host_pattern: 'files.acme.com' },
    ];
    expect(computeEffectiveHosts(rows)).toEqual(['files.acme.com']);
  });
});
