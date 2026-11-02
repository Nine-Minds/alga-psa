import { describe, expect, it } from 'vitest';
import { AttachFileInputError, buildAttachFileRequest } from '../buildAttachFileRequest';
import { redactToolArguments } from '../redactToolArguments';
import {
  ATTACH_FILE_TOOL,
  MCP_SERVER_INSTRUCTIONS,
  OPENAI_FILE_SCHEMA,
  buildMetaToolDefinitions,
} from '../../tools/definitions';

const ID = '11111111-1111-4111-8111-111111111111';
const SIGNED = 'https://files.oaiusercontent.com/file-abc?sig=SECRET-TOKEN';

const base = { entity_type: 'ticket', entity_id: ID };
const body = (r: { body?: string }) => JSON.parse(r.body as string);

describe('buildAttachFileRequest', () => {
  it('maps a ChatGPT file object to a url source', () => {
    const req = buildAttachFileRequest({
      ...base,
      file: { download_url: SIGNED, file_id: 'file-abc', file_name: 'a.pdf', mime_type: 'application/pdf' },
    });
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/api/v1/documents');
    expect(req.isMutation).toBe(true);
    expect(body(req)).toEqual({
      entity_type: 'ticket',
      entity_id: ID,
      source: { type: 'url', url: SIGNED },
      file_name: 'a.pdf',
      mime_type: 'application/pdf',
    });
  });

  it('explicit file_name / mime_type win over the file object', () => {
    const req = buildAttachFileRequest({
      ...base,
      file_name: 'mine.pdf',
      file: { download_url: SIGNED, file_id: 'f', file_name: 'a.pdf' },
    });
    expect(body(req).file_name).toBe('mine.pdf');
  });

  it('maps url and content_base64 sources', () => {
    expect(body(buildAttachFileRequest({ ...base, url: 'https://x.test/a.png' })).source).toEqual({
      type: 'url',
      url: 'https://x.test/a.png',
    });
    const b = body(buildAttachFileRequest({ ...base, content_base64: 'aGk=', file_name: 'n.txt' }));
    expect(b.source).toEqual({ type: 'base64', content: 'aGk=' });
    expect(b.file_name).toBe('n.txt');
  });

  const failures: Array<[string, Record<string, unknown>, RegExp]> = [
    ['string file', { ...base, file: SIGNED }, /plain string/],
    ['missing download_url', { ...base, file: { file_id: 'x' } }, /no download_url/],
    ['chat_upload scheme', { ...base, file: { download_url: 'chat_upload://abc?sig=SECRET-TOKEN', file_id: 'x' } }, /chat_upload/],
    ['http file url', { ...base, file: { download_url: 'http://x.test/a?sig=SECRET-TOKEN', file_id: 'x' } }, /https/],
    ['http url', { ...base, url: 'http://x.test/a?sig=SECRET-TOKEN' }, /https/],
    ['no source', { ...base }, /exactly one/],
    ['two sources', { ...base, url: 'https://x.test/a', content_base64: 'aGk=', file_name: 'a' }, /not several/],
    ['base64 without file_name', { ...base, content_base64: 'aGk=' }, /file_name is required/],
    ['bad entity', { entity_type: 'invoice', entity_id: ID, url: 'https://x.test/a' }, /entity_type/],
    ['missing entity id', { entity_type: 'ticket', url: 'https://x.test/a' }, /entity_id/],
  ];
  it.each(failures)('fails fast: %s, without echoing the signed URL', (_n, args, re) => {
    let err: unknown;
    try {
      buildAttachFileRequest(args);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AttachFileInputError);
    expect((err as Error).message).toMatch(re);
    expect((err as Error).message).not.toContain('SECRET-TOKEN');
  });
});

describe('attach_file tool definition', () => {
  const tool = buildMetaToolDefinitions({ edition: 'ce' }).find((t) => t.name === ATTACH_FILE_TOOL)!;

  it('carries _meta openai/fileParams', () => {
    expect(tool._meta).toEqual({ 'openai/fileParams': ['file'] });
  });

  it('declares the exact OpenAIFile schema and does not require file', () => {
    const schema = tool.inputSchema as any;
    expect(schema.required).toEqual(['entity_type', 'entity_id']);
    expect(schema.properties.file).toEqual({ $ref: '#/$defs/OpenAIFile' });
    expect(schema.$defs.OpenAIFile).toEqual({
      type: 'object',
      properties: {
        download_url: { type: 'string', description: expect.any(String) },
        file_id: { type: 'string', description: expect.any(String) },
        mime_type: { type: 'string', description: expect.any(String) },
        file_name: { type: 'string', description: expect.any(String) },
      },
      required: ['download_url', 'file_id'],
      additionalProperties: false,
    });
    expect(schema.$defs.OpenAIFile).toBe(OPENAI_FILE_SCHEMA);
  });

  it('instructions steer away from multipart and base64 of user files', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/attach_file/);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/multipart/);
  });

  it('instructions and tool copy explain the download-host allowlist', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/FETCH_HOST_NOT_ALLOWED/);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/allowed download hosts/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/Settings > MCP Server/);
    expect(tool.description).toMatch(/allowed download hosts/i);
  });
});

describe('redactToolArguments', () => {
  it('redacts download_url, content_base64 and url without mutating input', () => {
    const input = { ...base, file: { download_url: SIGNED, file_id: 'f' }, content_base64: 'aGk=', url: SIGNED };
    const out = redactToolArguments('attach_file', input);
    expect(JSON.stringify(out)).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(out)).not.toContain('aGk=');
    expect((out.file as any).file_id).toBe('f');
    expect(input.file.download_url).toBe(SIGNED);
  });

  it('redacts documents source bodies sent through call_api_endpoint', () => {
    const out = redactToolArguments('call_api_endpoint', { body: { source: { type: 'url', url: SIGNED } } });
    expect(JSON.stringify(out)).not.toContain('SECRET-TOKEN');
  });
});
