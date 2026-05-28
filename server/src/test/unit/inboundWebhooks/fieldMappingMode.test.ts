import { describe, expect, it } from 'vitest';

import {
  parseFieldMappingValue,
  serializeFieldMappingValue,
} from '@/lib/inboundWebhooks/fieldMappingMode';

describe('fieldMappingMode parser/serializer', () => {
  it('parses an empty value as an empty static value', () => {
    expect(parseFieldMappingValue('', 'string')).toEqual({
      mode: 'static',
      staticValue: '',
      expression: '',
    });
  });

  it('parses a double-quoted JSONata string literal as a static string', () => {
    expect(parseFieldMappingValue('"hello world"', 'string')).toEqual({
      mode: 'static',
      staticValue: 'hello world',
      expression: '',
    });
  });

  it('parses a single-quoted JSONata string literal as a static string', () => {
    expect(parseFieldMappingValue("'hello'", 'ref')).toEqual({
      mode: 'static',
      staticValue: 'hello',
      expression: '',
    });
  });

  it('treats a bare path expression as expression mode', () => {
    expect(parseFieldMappingValue('alert.subject', 'string')).toEqual({
      mode: 'expression',
      staticValue: '',
      expression: 'alert.subject',
    });
  });

  it('parses a number literal as a static int', () => {
    expect(parseFieldMappingValue('42', 'int')).toEqual({
      mode: 'static',
      staticValue: '42',
      expression: '',
    });
  });

  it('parses a boolean literal as static', () => {
    expect(parseFieldMappingValue('true', 'boolean')).toEqual({
      mode: 'static',
      staticValue: 'true',
      expression: '',
    });
  });

  it('serializes a static ref UUID as a JSONata string literal', () => {
    const uuid = '85401671-67b1-4fa1-b565-1b25c78f908c';
    expect(serializeFieldMappingValue('static', uuid, 'ref')).toBe(`"${uuid}"`);
  });

  it('serializes a static int as a bare number literal', () => {
    expect(serializeFieldMappingValue('static', '5', 'int')).toBe('5');
  });

  it('rejects non-integer static int values', () => {
    expect(() => serializeFieldMappingValue('static', '5.5', 'int')).toThrow();
  });

  it('serializes a static boolean as lowercase literal', () => {
    expect(serializeFieldMappingValue('static', 'True', 'boolean')).toBe('true');
  });

  it('serializes expression mode without quoting', () => {
    expect(serializeFieldMappingValue('expression', 'alert.subject', 'string')).toBe('alert.subject');
  });

  it('roundtrips a static string with embedded quotes', () => {
    const original = 'has "quotes"';
    const serialized = serializeFieldMappingValue('static', original, 'string');
    const parsed = parseFieldMappingValue(serialized, 'string');
    expect(parsed).toEqual({ mode: 'static', staticValue: original, expression: '' });
  });
});
