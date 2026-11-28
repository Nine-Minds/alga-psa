import { describe, expect, it } from 'vitest';
import {
  RMM_KNOWN_CONNECTION_TYPES,
  describeRmmConnectionType,
  normalizeRmmConnectionType,
  parseRmmConnectionType,
  rmmConnectionTypesForProvider,
  orderRmmConnectionTypes,
  isSafeRemoteSessionUrl,
} from './connectionTypes';

describe('normalizeRmmConnectionType', () => {
  it.each(['NINJAONE_REMOTE', 'ninjaone', 'NinjaOne Remote', 'ninjaone-remote', ' ninjaoneremote '])(
    'maps %j to ninjaone_remote', (raw) => expect(normalizeRmmConnectionType(raw)).toBe('ninjaone_remote'));

  it('lower-cases known types', () => {
    expect(normalizeRmmConnectionType('SPLASHTOP')).toBe('splashtop');
    expect(normalizeRmmConnectionType('Shell')).toBe('shell');
  });

  it('passes unknown types through normalized', () => {
    expect(normalizeRmmConnectionType('Fancy Remote-Thing')).toBe('fancy_remote_thing');
  });
});

describe('describeRmmConnectionType', () => {
  it('uses registry metadata for known types', () => {
    expect(describeRmmConnectionType('shell')).toMatchObject({ labelKey: 'remoteAccess.remoteShell', icon: 'terminal', order: 50 });
    expect(describeRmmConnectionType('NinjaOne Remote')).toMatchObject({
      labelKey: 'remoteAccess.connectionTypes.ninjaoneRemote', icon: 'monitor',
    });
  });

  it('humanizes unknown ids and sorts them after known ones', () => {
    const d = describeRmmConnectionType('fancy_remote');
    expect(d.labelKey).toBeUndefined();
    expect(d.fallbackLabel).toBe('Fancy remote');
    expect(d.order).toBeGreaterThan(Math.max(...RMM_KNOWN_CONNECTION_TYPES.map((t) => t.order)));
  });

  it('falls back to the generic label key when the id is not readable', () => {
    expect(describeRmmConnectionType('4242')).toMatchObject({ labelKey: 'remoteAccess.connectionTypes.generic', fallbackLabel: '' });
    expect(describeRmmConnectionType('')).toMatchObject({ labelKey: 'remoteAccess.connectionTypes.generic' });
  });
});

describe('parseRmmConnectionType', () => {
  it('accepts and normalizes plausible ids', () => {
    expect(parseRmmConnectionType('RDP')).toBe('rdp');
    expect(parseRmmConnectionType('ninjaone')).toBe('ninjaone_remote');
    expect(parseRmmConnectionType('some_new_type')).toBe('some_new_type');
  });

  it.each(['', '   ', '../etc', 'a/b', 'x'.repeat(65), 'bad$id', '_leading'])('rejects %j', (raw) => {
    expect(parseRmmConnectionType(raw)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseRmmConnectionType(null)).toBeNull();
    expect(parseRmmConnectionType(5)).toBeNull();
  });
});

describe('rmmConnectionTypesForProvider', () => {
  it('returns an ordering hint for Tactical and Datto and an empty hint otherwise', () => {
    expect(rmmConnectionTypesForProvider('tacticalrmm')).toEqual(['splashtop', 'shell']);
    expect(rmmConnectionTypesForProvider('datto')).toEqual(['splashtop']);
    expect(rmmConnectionTypesForProvider('ninjaone')).toEqual([]);
    expect(rmmConnectionTypesForProvider(null)).toEqual([]);
  });
});

describe('orderRmmConnectionTypes', () => {
  it('keeps every reported type, known ones in registry order and unknown ones after in provider order', () => {
    expect(orderRmmConnectionTypes('ninjaone', ['zeta_remote', 'shell', 'ninjaone_remote', 'alpha_remote', 'splashtop', 'shell']))
      .toEqual(['splashtop', 'shell', 'ninjaone_remote', 'zeta_remote', 'alpha_remote']);
  });

  it('never drops a type outside a provider hint', () => {
    expect(orderRmmConnectionTypes('tacticalrmm', ['vnc', 'shell', 'splashtop', 'new_kind']))
      .toEqual(['splashtop', 'shell', 'vnc', 'new_kind']);
  });
});

describe('isSafeRemoteSessionUrl', () => {
  it.each([
    'https://app.ninjarmm.com/remote/abc',
    'http://mesh.local/control',
    'ninjarmm://session/42',
    'splashtop://launch?id=1',
    '/relative/path',
  ])('allows %j', (url) => expect(isSafeRemoteSessionUrl(url)).toBe(true));

  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'jav\u0000ascript:alert(1)',
    'data:text/html,<script>1</script>',
    'VBScript:msgbox',
    'file:///etc/passwd',
    'blob:https://x/y',
    '',
    '   ',
  ])('refuses %j', (url) => expect(isSafeRemoteSessionUrl(url)).toBe(false));

  it('refuses non-strings', () => {
    expect(isSafeRemoteSessionUrl(null)).toBe(false);
    expect(isSafeRemoteSessionUrl(42)).toBe(false);
  });
});
