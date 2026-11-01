import { describe, it, expect } from 'vitest';
import { redactToolResult, MAX_RESULT_SUMMARY } from '../redactToolArguments';

const SECRET = 'whsec_TopSecretValue123';
const pretty = (v: unknown) => JSON.stringify(v, null, 2);

describe('redactToolResult', () => {
  it('drops signing_secret from a call_api_endpoint result but keeps status/ok', () => {
    const text = pretty({ status: 200, ok: true, data: { signing_secret: SECRET, webhook_id: 'w1' } });
    const out = redactToolResult('call_api_endpoint', text)!;
    expect(out).not.toContain(SECRET);
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe(200);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.webhook_id).toBe('w1');
  });

  it('redacts nested secrets', () => {
    const out = redactToolResult('call_api_endpoint', pretty({ data: { webhook: { signing_secret: SECRET } } }))!;
    expect(out).not.toContain(SECRET);
  });

  it('redacts a JSON string inside a string', () => {
    const inner = JSON.stringify({ signing_secret: SECRET });
    const out = redactToolResult('call_api_endpoint', pretty({ status: 200, ok: true, data: inner }))!;
    expect(out).not.toContain(SECRET);
    expect(JSON.parse(out).status).toBe(200);
  });

  it('redacts Bearer credentials and signed URLs in plain text', () => {
    expect(redactToolResult('t', 'Bearer xyz')).toBe('[redacted]');
    expect(redactToolResult('t', 'see https://h.example.com/a?sig=abc end')).toBe('see [redacted] end');
  });

  it('leaves a benign result byte-for-byte unchanged', () => {
    const text = pretty({ status: 200, ok: true, data: { ticket_id: 't-1' } });
    expect(redactToolResult('call_api_endpoint', text)).toBe(text);
  });

  it('redacts before truncating: a secret past the old cut point is gone and output <= cap', () => {
    const text = pretty({ status: 200, ok: true, filler: 'x'.repeat(1990), signing_secret: SECRET });
    const out = redactToolResult('call_api_endpoint', text)!;
    expect(out).not.toContain(SECRET);
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_SUMMARY);
  });

  it('applies the key-suffix rule (case-insensitive)', () => {
    const out = redactToolResult('t', pretty({ foo_token: 'tok1', DB_PASSWORD: 'pw1', next_page: 'n' }))!;
    expect(out).not.toMatch(/tok1|pw1/);
    expect(JSON.parse(out).next_page).toBe('n');
  });

  it('returns null for empty input', () => {
    expect(redactToolResult('t', undefined)).toBeNull();
    expect(redactToolResult('t', '')).toBeNull();
  });
});
