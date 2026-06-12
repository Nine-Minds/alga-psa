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

  it('T011: rejects HMAC auth config without a signature header name', () => {
    const result = inboundWebhookUpsertInputSchema.safeParse(
      validInboundWebhookInput({
        auth_config: {
          type: 'hmac_sha256',
          secret: '0123456789abcdef',
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['auth_config', 'signature_header'],
        }),
      ]),
    );
  });

  it('T012: rejects direct_action handler config without an action name', () => {
    const result = inboundWebhookUpsertInputSchema.safeParse(
      validInboundWebhookInput({
        handler_config: {
          type: 'direct_action',
          field_mapping: {
            title: 'alert.message',
          },
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['handler_config', 'action'],
        }),
      ]),
    );
  });

  it('T013: rejects workflow handler config without a workflow_id', () => {
    const result = inboundWebhookUpsertInputSchema.safeParse(
      validInboundWebhookInput({
        handler_type: 'workflow',
        handler_config: {
          type: 'workflow',
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['handler_config', 'workflow_id'],
        }),
      ]),
    );
  });

  it('T014: rejects URL-unsafe slug characters', () => {
    const result = inboundWebhookUpsertInputSchema.safeParse(
      validInboundWebhookInput({
        slug: 'RMM Alerts!',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['slug'],
          message: 'Slug must use lowercase letters, numbers, and hyphens',
        }),
      ]),
    );
  });
});
