import { describe, expect, it } from 'vitest';

import { signRequest, verifyWebhookSignature } from '../sign';

const SECRET = 'shh';
const BODY = '{"a":1}';
const TIMESTAMP = 1700000000;
// Golden vector — HMAC-SHA256 over `${ts}.${body}` with secret 'shh'.
const EXPECTED_SIGNATURE_HEX =
  'be310eac0f84daf469d630347a950258de768b365563ab68f29f2f783473d547';

describe('webhook signing (T023)', () => {
  it('signRequest emits the documented `t=<ts>,v1=<hex>` header (golden vector)', () => {
    const header = signRequest(SECRET, BODY, TIMESTAMP);
    expect(header).toBe(`t=${TIMESTAMP},v1=${EXPECTED_SIGNATURE_HEX}`);
  });

  it('verifyWebhookSignature returns true for an unmodified signature/body/secret triple', () => {
    const header = signRequest(SECRET, BODY, TIMESTAMP);
    expect(verifyWebhookSignature(header, BODY, SECRET)).toBe(true);
  });

  it('verifyWebhookSignature returns false when a single body byte changes', () => {
    const header = signRequest(SECRET, BODY, TIMESTAMP);
    const tamperedBody = '{"a":2}';
    expect(verifyWebhookSignature(header, tamperedBody, SECRET)).toBe(false);
  });

  it('verifyWebhookSignature returns false when the timestamp is skewed by ±1', () => {
    const header = signRequest(SECRET, BODY, TIMESTAMP);

    // Re-sign with the same secret/body but a skewed timestamp; substituting
    // only the `t=` portion must invalidate the v1 signature.
    const skewedHeaderPlus = signRequest(SECRET, BODY, TIMESTAMP + 1).replace(
      `t=${TIMESTAMP + 1}`,
      `t=${TIMESTAMP}`,
    );
    const skewedHeaderMinus = signRequest(SECRET, BODY, TIMESTAMP - 1).replace(
      `t=${TIMESTAMP - 1}`,
      `t=${TIMESTAMP}`,
    );

    expect(verifyWebhookSignature(skewedHeaderPlus, BODY, SECRET)).toBe(false);
    expect(verifyWebhookSignature(skewedHeaderMinus, BODY, SECRET)).toBe(false);
  });
});
