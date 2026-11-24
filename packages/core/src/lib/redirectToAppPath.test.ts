import { describe, expect, it } from 'vitest';
import { redirectToAppPath, toAppRelativeLocation } from './redirectToAppPath';

describe('redirectToAppPath', () => {
  it('returns a 307 with a relative Location and no body', () => {
    const res = redirectToAppPath('/msp/settings?tab=a#frag');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/msp/settings?tab=a#frag');
    expect(res.body).toBeNull();
  });

  it('honours status and extra headers, and always owns Location', () => {
    const res = redirectToAppPath('/x', {
      status: 302,
      headers: { 'Cache-Control': 'no-store', Location: 'https://evil.example/' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('location')).toBe('/x');
  });

  it('merges carried query without overriding destination params', () => {
    const res = redirectToAppPath('/d?category=providers', {
      carryQuery: new URLSearchParams('category=accounting&a=1&a=2'),
    });
    const loc = new URL(res.headers.get('location')!, 'http://h');
    expect(loc.searchParams.getAll('category')).toEqual(['providers']);
    expect(loc.searchParams.getAll('a')).toEqual(['1', '2']);
  });

  it.each([
    '', 'msp/dashboard', 'https://evil.example/', 'javascript:alert(1)', '//evil.example', '///evil.example',
    '/\\evil.example', '\\\\evil.example', '\\/evil.example', '/a\\b', '/\t/evil.example', '/\n/evil.example',
    '/\r\nSet-Cookie: x=1', '/.//evil.example', '/a/..//evil.example', ' /x', 'http:/evil.example', '?x=1', '#frag',
  ])('rejects %j', (input) => {
    expect(() => toAppRelativeLocation(input)).toThrow(TypeError);
    expect(() => redirectToAppPath(input)).toThrow(TypeError);
  });

  it('accepts encoded slashes as plain path text', () => {
    expect(toAppRelativeLocation('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
  });
});
