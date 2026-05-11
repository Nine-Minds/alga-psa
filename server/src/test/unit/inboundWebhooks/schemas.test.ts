import { describe, expect, it } from 'vitest';

import { inboundWebhookUpsertInputSchema } from '@/lib/inboundWebhooks/schemas';

function validInboundWebhookInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'RMM Alerts',
    slug: 'rmm-alerts',
    auth_type: 'hmac_sha256',
    auth_config: {
      type: 'hmac_sha256',
      signature_header: 'X-Signature',
      secret: '0123456789abcdef',
    },
    handler_type: 'direct_action',
    handler_config: {
      type: 'direct_action',
      action: 'createTicket',
      field_mapping: {
        title: 'alert.message',
      },
    },
    ...overrides,
  };
}

describe('inbound webhook schemas', () => {
  it('T004b: rejects reserved bundled integration slugs such as ninjaone', () => {
    const result = inboundWebhookUpsertInputSchema.safeParse(
      validInboundWebhookInput({
        slug: 'ninjaone',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['slug'],
          message: 'Slug is reserved for a bundled integration',
        }),
      ]),
    );
  });

  it('T010: rejects upsert input with a bogus auth_type', () => {
    const result = inboundWebhookUpsertInputSchema.safeParse(
      validInboundWebhookInput({
        auth_type: 'api_key',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['auth_type'],
        }),
      ]),
    );
  });
});
