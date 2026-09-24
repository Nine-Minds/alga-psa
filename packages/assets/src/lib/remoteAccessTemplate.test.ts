import { describe, expect, it } from 'vitest';
import { renderRemoteAccessTemplate } from './remoteAccessTemplate';

describe('renderRemoteAccessTemplate', () => {
  it('encodes values containing URL delimiters without changing URL structure', () => {
    const url = renderRemoteAccessTemplate(
      'https://remote.example/connect/{field.session}',
      { asset: {}, client: {}, field: { session: 'one/?#&two' } }
    );
    expect(url).toBe('https://remote.example/connect/one%2F%3F%23%26two');
  });

  it('supports asset, client, and custom field placeholders', () => {
    expect(renderRemoteAccessTemplate(
      'https://remote.example/{client.name}/{asset.name}/{field.session}',
      { asset: { name: 'Workstation' }, client: { name: 'Example Co' }, field: { session: 'abc' } }
    )).toBe('https://remote.example/Example%20Co/Workstation/abc');
  });

  it('returns null for a missing placeholder value', () => {
    expect(renderRemoteAccessTemplate(
      'https://remote.example/{field.session}',
      { asset: {}, client: {}, field: {} }
    )).toBeNull();
  });

  it('rejects non-http(s) URLs and malformed placeholders', () => {
    expect(renderRemoteAccessTemplate('javascript:alert(1)', { asset: {}, client: {} })).toBeNull();
    expect(renderRemoteAccessTemplate('data:text/html,hello', { asset: {}, client: {} })).toBeNull();
    expect(renderRemoteAccessTemplate('https://remote.example/{unknown.value}', { asset: {}, client: {} })).toBeNull();
    expect(renderRemoteAccessTemplate('https://remote.example/{asset.hostname}', { asset: { hostname: 'host' }, client: {} })).toBeNull();
  });

  it('does not let substituted values inject or replace the URL host', () => {
    expect(renderRemoteAccessTemplate(
      'https://{field.host}/connect', { asset: {}, client: {}, field: { host: '@evil.com' } }
    )).toBeNull();
    expect(renderRemoteAccessTemplate(
      'https://remote.example/{field.path}', { asset: {}, client: {}, field: { path: '//evil' } }
    )).toBe('https://remote.example/%2F%2Fevil');
  });

  it('rejects schemes after substitution', () => {
    expect(renderRemoteAccessTemplate(
      '{field.scheme}://remote.example/{field.payload}',
      { asset: {}, client: {}, field: { scheme: 'javascript', payload: 'alert(1)' } }
    )).toBeNull();
  });

  it('requires a literal HTTP scheme and host before substituting values', () => {
    const context = { asset: {}, client: {}, field: { x: 'evil.example', url: 'https://evil.example' } };
    expect(renderRemoteAccessTemplate('https:{field.x}', context)).toBeNull();
    expect(renderRemoteAccessTemplate('http:/{field.x}', context)).toBeNull();
    expect(renderRemoteAccessTemplate(String.raw`https:\{field.x}`, context)).toBeNull();
    expect(renderRemoteAccessTemplate('{field.url}', context)).toBeNull();
    expect(renderRemoteAccessTemplate('https://{field.x}/connect', context)).toBeNull();
    expect(renderRemoteAccessTemplate('https://user:pass@remote.example/connect', context)).toBeNull();
  });

  it('URL-encodes percent and user-info delimiters in substituted values', () => {
    expect(renderRemoteAccessTemplate(
      'https://remote.example/connect/{field.session}',
      { asset: {}, client: {}, field: { session: 'a%b@c:d' } }
    )).toBe('https://remote.example/connect/a%25b%40c%3Ad');
  });
});
