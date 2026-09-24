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
});
