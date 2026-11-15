import { describe, it, expect } from 'vitest';
import { redactToolArguments } from '../redactToolArguments';

const S3 = 'https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Credential=AKIASECRET&X-Amz-Signature=deadbeef1234';
const B64 = 'QUJD'.repeat(200);
const dump = (v: unknown) => JSON.stringify(v);

describe('redactToolArguments', () => {
  it('redacts a JSON-string body with a url source as a structure', () => {
    const body = JSON.stringify({ name: 'a', source: { type: 'url', url: S3 } });
    const result = redactToolArguments('call_api_endpoint', { body });
    expect(dump(result)).not.toContain('deadbeef1234');
    expect(dump(result)).not.toContain('AKIASECRET');
    expect(result.body).toEqual({ name: 'a', source: { type: 'url', url: '[redacted]' } });
  });

  it('redacts a JSON-string body with a base64 source', () => {
    const body = JSON.stringify({ source: { type: 'base64', content: B64 } });
    const result = redactToolArguments('call_api_endpoint', { body });
    expect(dump(result)).not.toContain(B64);
    expect(result.body).toEqual({ source: { type: 'base64', content: '[redacted]' } });
  });

  it('redacts an unparseable string body entirely', () => {
    const result = redactToolArguments('call_api_endpoint', { body: `not json ${S3}` });
    expect(result.body).toBe('[redacted]');
  });

  it('redacts a nested parameters.body JSON string', () => {
    const body = JSON.stringify({ source: { type: 'url', url: S3 } });
    const result = redactToolArguments('call_api_endpoint', { parameters: { body } });
    expect(dump(result)).not.toContain('deadbeef1234');
    expect((result.parameters as any).body).toEqual({ source: { type: 'url', url: '[redacted]' } });
  });

  it('redacts signed URLs by shape under unknown keys, case-insensitively', () => {
    const urls = [
      S3,
      'https://x.example.com/a?SIG=topsecret1',
      'https://x.example.com/a?Token=topsecret2',
      'https://acct.blob.core.windows.net/c/f?sv=2022-11-02&sr=b&sp=r&se=2030-01-01',
      'https://acct.blob.core.windows.net/c/f?SV=2022-11-02&skoid=abc123',
    ];
    const result = redactToolArguments('call_api_endpoint', { query: { weird: urls[0], more: urls.slice(1) } });
    expect(result.query).toEqual({ weird: '[redacted]', more: ['[redacted]', '[redacted]', '[redacted]', '[redacted]'] });
    expect(dump(result)).not.toMatch(/topsecret|AKIASECRET|skoid=abc123/);
  });

  it('redacts large base64 strings under non-sensitive keys inside carriers', () => {
    const result = redactToolArguments('call_api_endpoint', { body: { blob: B64, note: 'hi' } });
    expect(dump(result)).not.toContain(B64);
    expect(result.body).toEqual({ blob: '[redacted]', note: 'hi' });
  });

  it('keeps redacting object bodies with source and attach_file url', () => {
    const r1 = redactToolArguments('call_api_endpoint', { body: { source: { type: 'url', url: 'https://plain.example.com/f' } } });
    expect(dump(r1)).not.toContain('plain.example.com');
    const r2 = redactToolArguments('attach_file', { url: 'https://plain.example.com/f', ticket: 't1' });
    expect(r2).toEqual({ url: '[redacted]', ticket: 't1' });
    const r3 = redactToolArguments('x', { download_url: 'https://a/b', content_base64: 'QQ==' });
    expect(r3).toEqual({ download_url: '[redacted]', content_base64: '[redacted]' });
  });

  it('leaves ordinary strings and unsigned URLs outside carriers unchanged', () => {
    const args = { title: 'Printer broken', link: 'https://example.com/tickets/1?page=2', long: B64 };
    expect(redactToolArguments('call_api_endpoint', args)).toEqual(args);
  });
  it('redacts a doubly JSON-encoded carrier body', () => {
    const body = JSON.stringify(JSON.stringify({ source: { type: 'url', url: S3 } }));
    const result = redactToolArguments('call_api_endpoint', { body });
    expect(dump(result)).not.toContain('X-Amz-Signature');
    expect(result.body).toEqual({ source: { type: 'url', url: '[redacted]' } });
  });

  it('redacts a carrier encoded more times than the depth cap allows', () => {
    let body = JSON.stringify({ note: 'ok' });
    for (let i = 0; i < 6; i++) body = JSON.stringify(body);
    const result = redactToolArguments('call_api_endpoint', { body });
    expect(result.body).toBe('[redacted]');
  });

  it('redacts a carrier string that parses to a bare JSON string', () => {
    expect(redactToolArguments('x', { body: '"hello"' }).body).toBe('[redacted]');
    expect(redactToolArguments('x', { body: '42' }).body).toBe(42);
  });

  it('redacts a signed URL embedded in text inside a carrier, keeping the text', () => {
    const result = redactToolArguments('call_api_endpoint', { body: { note: 'see ' + S3 } });
    expect(dump(result)).not.toContain('X-Amz-Signature');
    expect(result.body).toEqual({ note: 'see [redacted]' });
  });

  it('redacts embedded signed URLs outside carriers and keeps unsigned URLs', () => {
    const result = redactToolArguments('x', {
      title: `fetch (${S3}). then done`,
      escaped: 'u https://h.example.com/a?x=1\\u0026sig=secret9 end',
      plain: 'go to https://plain.example.com/f?a=1 now',
    });
    expect(dump(result)).not.toMatch(/X-Amz-Signature|secret9/);
    expect(result.title).toBe('fetch ([redacted]). then done');
    expect(result.escaped).toBe('u [redacted] end');
    expect(result.plain).toBe('go to https://plain.example.com/f?a=1 now');
  });

  it('redacts credential headers case-insensitively', () => {
    const result = redactToolArguments('x', {
      headers: { authorization: 'Bearer abc.def.ghi', Authorization: 'x', 'X-API-Key': 'k', Cookie: 'a=b', 'set-cookie': 's', 'proxy-authorization': 'p', accept: 'json' },
    });
    expect(result.headers).toEqual({
      authorization: '[redacted]', Authorization: '[redacted]', 'X-API-Key': '[redacted]', Cookie: '[redacted]',
      'set-cookie': '[redacted]', 'proxy-authorization': '[redacted]', accept: 'json',
    });
  });

  it('redacts Bearer/Basic values under unrelated keys', () => {
    const result = redactToolArguments('x', { note: 'Bearer abc.def', other: 'basic dXNlcjpwdw==', fine: 'bearer-less' });
    expect(result).toEqual({ note: '[redacted]', other: '[redacted]', fine: 'bearer-less' });
  });
});
