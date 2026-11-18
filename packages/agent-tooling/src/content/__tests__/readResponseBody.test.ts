import { describe, expect, it } from 'vitest';
import { describeBinaryBody, readResponseBody } from '../readResponseBody';

const res = (body: BodyInit | null, headers: Record<string, string>, status = 200) =>
  new Response(body, { status, headers });

describe('readResponseBody', () => {
  it('parses application/json and +json', async () => {
    expect(await readResponseBody(res('{"a":1}', { 'content-type': 'application/json; charset=utf-8' }))).toEqual({
      kind: 'json',
      value: { a: 1 },
    });
    expect(await readResponseBody(res('{"a":1}', { 'content-type': 'application/problem+json' }))).toEqual({
      kind: 'json',
      value: { a: 1 },
    });
  });

  it('falls back to text on malformed JSON', async () => {
    expect(await readResponseBody(res('{oops', { 'content-type': 'application/json' }))).toEqual({
      kind: 'text',
      value: '{oops',
    });
  });

  it('reads text/*, xml and markdown as text', async () => {
    for (const ct of ['text/plain', 'text/markdown', 'application/xml', 'application/atom+xml', 'text/html']) {
      expect(await readResponseBody(res('hello', { 'content-type': ct }))).toEqual({ kind: 'text', value: 'hello' });
    }
  });

  it('keeps an empty body as empty text', async () => {
    expect(await readResponseBody(res(null, { 'content-type': 'application/json' }, 204))).toEqual({ kind: 'text', value: '' });
  });

  it('treats a response without Content-Type as before: text, parsed when JSON', async () => {
    const r = new Response('{"x":2}');
    r.headers.delete('content-type');
    expect(await readResponseBody(r)).toEqual({ kind: 'json', value: { x: 2 } });
  });

  it('never decodes binary bodies and cancels the stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const r = new Response(stream, {
      headers: { 'content-type': 'image/jpeg', 'content-length': '123', 'content-disposition': 'attachment; filename="a b.jpg"' },
    });
    const body = await readResponseBody(r);
    expect(body).toEqual({ kind: 'binary', contentType: 'image/jpeg', byteLength: 123, fileName: 'a b.jpg' });
    expect(cancelled).toBe(true);
  });

  it('reads an RFC 5987 filename and unknown length', async () => {
    const body = await readResponseBody(
      res(new Uint8Array([1, 2]), { 'content-type': 'application/pdf', 'content-disposition': "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf" }),
    );
    expect(body).toMatchObject({ kind: 'binary', fileName: 'résumé.pdf' });
  });

  it('describes binary bodies for the model', () => {
    expect(describeBinaryBody({ kind: 'binary', contentType: 'application/pdf', byteLength: 5, fileName: null })).toEqual({
      binary: true,
      content_type: 'application/pdf',
      byte_length: 5,
      file_name: null,
      hint: 'Binary content is not returned by call_api_endpoint. Use read_attachment to read ticket attachments.',
    });
  });
});
