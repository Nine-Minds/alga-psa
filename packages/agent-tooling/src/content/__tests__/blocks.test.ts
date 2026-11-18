import { describe, expect, it } from 'vitest';
import { isMcpContentBlock, jsonToolResult } from '../blocks';

describe('isMcpContentBlock', () => {
  it('accepts the four block shapes we emit', () => {
    expect(isMcpContentBlock({ type: 'text', text: 'x' })).toBe(true);
    expect(isMcpContentBlock({ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' })).toBe(true);
    expect(isMcpContentBlock({ type: 'resource', resource: { uri: 'u', mimeType: 'application/pdf', blob: 'AAAA' } })).toBe(true);
    expect(isMcpContentBlock({ type: 'resource_link', uri: 'u', name: 'n', mimeType: 'a/b', size: 3, description: 'd' })).toBe(true);
    expect(isMcpContentBlock({ type: 'resource_link', uri: 'u', name: 'n' })).toBe(true);
  });

  it('rejects unknown types, missing fields, wrong types and extra keys', () => {
    for (const bad of [
      null,
      'text',
      [],
      { type: 'audio', data: 'x', mimeType: 'audio/wav' },
      { type: 'text' },
      { type: 'text', text: 1 },
      { type: 'text', text: 'x', extra: true },
      { type: 'image', data: 'x' },
      { type: 'resource', resource: { uri: 'u', mimeType: 'a/b' } },
      { type: 'resource', resource: { uri: 'u', mimeType: 'a/b', blob: 'x', text: 'y' } },
      { type: 'resource_link', uri: 'u' },
      { type: 'resource_link', uri: 'u', name: 'n', size: 'big' },
    ]) {
      expect(isMcpContentBlock(bad)).toBe(false);
    }
  });
});

describe('jsonToolResult', () => {
  it('pretty-prints, maps undefined to null and carries the status only when given', () => {
    expect(jsonToolResult({ a: 1 }, false)).toEqual({ content: [{ type: 'text', text: '{\n  "a": 1\n}' }], isError: false });
    expect(jsonToolResult(undefined, true, 500)).toEqual({ content: [{ type: 'text', text: 'null' }], isError: true, statusCode: 500 });
  });
});
