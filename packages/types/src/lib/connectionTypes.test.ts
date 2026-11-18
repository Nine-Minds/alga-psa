import { describe, expect, it } from 'vitest';
import {
  RMM_KNOWN_CONNECTION_TYPES,
  describeRmmConnectionType,
  normalizeRmmConnectionType,
  parseRmmConnectionType,
  rmmConnectionTypesForProvider,
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
  it('returns closed sets for Tactical and Datto and null (unconstrained) otherwise', () => {
    expect(rmmConnectionTypesForProvider('tacticalrmm')).toEqual(['splashtop', 'shell']);
    expect(rmmConnectionTypesForProvider('datto')).toEqual(['splashtop']);
    expect(rmmConnectionTypesForProvider('ninjaone')).toBeNull();
    expect(rmmConnectionTypesForProvider(null)).toBeNull();
  });
});
