import { describe, it, expect } from 'vitest';
import { encodeJsonb } from '../../lib/extensions/storage/v2/json';

describe('Extension storage jsonb encoding', () => {
  it('encodes string values as a JSON string', () => {
    expect(encodeJsonb('eyJhbGwiOlt7InRlc3QiOjF9XX0')).toBe('"eyJhbGwiOlt7InRlc3QiOjF9XX0"');
  });

  it('encodes object values as JSON object text', () => {
    expect(encodeJsonb({ a: 1, b: true, c: null, d: ['x'] })).toBe('{"a":1,"b":true,"c":null,"d":["x"]}');
  });
});
