import { describe, expect, it } from 'vitest';

import { generateBaseDocument } from '@/lib/api/openapi';

describe('ticket bundle status propagation OpenAPI contract', () => {
  it('documents propagateToChildren and the 409 response on both status write paths', () => {
    const document = generateBaseDocument({
      title: 'AlgaPSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ee',
    }) as Record<string, any>;

    const schemas = document.components?.schemas ?? {};
    expect(JSON.stringify(schemas.WorkV1TicketUpdateBody)).toContain('propagateToChildren');
    expect(JSON.stringify(schemas.WorkV1TicketStatusUpdateBody)).toContain('propagateToChildren');

    const update = document.paths?.['/api/v1/tickets/{id}']?.put as Record<string, any> | undefined;
    const statusUpdate = document.paths?.['/api/v1/tickets/{id}/status']?.put as Record<string, any> | undefined;

    expect(update?.responses?.['409']).toBeTruthy();
    expect(statusUpdate?.responses?.['409']).toBeTruthy();
    expect(update?.responses?.['409']?.description).toMatch(/propagateToChildren|close or reopen/i);
  });
});
