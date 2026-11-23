import { describe, expect, it } from 'vitest';
import { attachDocumentSchema, parseClientVisibleFormField } from 'server/src/lib/api/schemas/documentAttach';
import { ValidationError } from 'server/src/lib/api/middleware/apiErrors';

const base = {
  entity_type: 'ticket',
  entity_id: '123e4567-e89b-42d3-a456-426614174000',
  source: { type: 'base64', content: 'YQ==' },
  file_name: 'a.txt',
};

describe('POST /api/v1/documents is_client_visible', () => {
  it('is optional', () => {
    expect(attachDocumentSchema.parse(base).is_client_visible).toBeUndefined();
  });
  it.each([true, false])('accepts %s', (value) => {
    expect(attachDocumentSchema.parse({ ...base, is_client_visible: value }).is_client_visible).toBe(value);
  });
  it.each(['true', 1, null, {}])('rejects non-boolean %j (the controller turns this into a 400)', (value) => {
    expect(attachDocumentSchema.safeParse({ ...base, is_client_visible: value }).success).toBe(false);
  });
});

describe('multipart is_client_visible field', () => {
  it('maps absent, empty and "false" to internal and "true" to visible', () => {
    expect(parseClientVisibleFormField(null)).toBe(false);
    expect(parseClientVisibleFormField('')).toBe(false);
    expect(parseClientVisibleFormField('false')).toBe(false);
    expect(parseClientVisibleFormField('true')).toBe(true);
  });
  it.each(['yes', '1', 'TRUE'])('rejects %s with a 400 ValidationError', (value) => {
    expect(() => parseClientVisibleFormField(value)).toThrow(ValidationError);
  });
});
