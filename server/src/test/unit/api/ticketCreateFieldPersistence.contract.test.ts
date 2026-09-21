import { describe, expect, it } from 'vitest';

import {
  buildTicketCreateRow,
  ticketSchema,
  validateData,
} from '@alga-psa/shared/models/ticketModel';
import { createTicketSchema, updateTicketSchema } from '../../../lib/api/schemas/ticket';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerWorkManagementV1Routes } from '../../../lib/api/openapi/routes/workManagementV1';

const UUID = {
  ticket: '11111111-1111-4111-8111-111111111111',
  tenant: '22222222-2222-4222-8222-222222222222',
  url: 'https://support.example.com/tickets/alga-2026-0002512',
  severity: '33333333-3333-4333-8333-333333333333',
  urgency: '44444444-4444-4444-8444-444444444444',
  impact: '55555555-5555-4555-8555-555555555555',
  contact: '66666666-6666-4666-8666-666666666666',
};

const BASE = {
  ticket_id: UUID.ticket,
  tenant: UUID.tenant,
  ticket_number: 'TIC-1000',
  entered_at: '2026-09-19T12:00:00.000Z',
  updated_at: '2026-09-19T12:00:00.000Z',
};

describe('shared ticket create row mapping', () => {
  it('persists url, severity_id, urgency_id and impact_id from the input', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: {
        title: 'Persist classification',
        url: UUID.url,
        severity_id: UUID.severity,
        urgency_id: UUID.urgency,
        impact_id: UUID.impact,
      },
      resolvedBillingProfileId: null,
      attributes: null,
    });

    expect(row.url).toBe(UUID.url);
    expect(row.severity_id).toBe(UUID.severity);
    expect(row.urgency_id).toBe(UUID.urgency);
    expect(row.impact_id).toBe(UUID.impact);
  });

  it('stores nulls when the optional fields are omitted', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: { title: 'Omitted classification' },
      resolvedBillingProfileId: null,
      attributes: null,
    });

    expect(row.url).toBeNull();
    expect(row.severity_id).toBeNull();
    expect(row.urgency_id).toBeNull();
    expect(row.impact_id).toBeNull();
  });

  it('preserves supplied empty strings for the four create fields through the row map', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: {
        title: 'Empty supplied values',
        url: '',
        severity_id: '',
        urgency_id: '',
        impact_id: '',
      },
      resolvedBillingProfileId: null,
      attributes: null,
    });

    // `nullish` handling: only null/undefined become SQL NULL, so the empty
    // values survive to final validation instead of silently persisting null.
    expect(row.url).toBe('');
    expect(row.severity_id).toBe('');
    expect(row.urgency_id).toBe('');
    expect(row.impact_id).toBe('');
  });

  it('keeps empty-string-to-null normalization for other nullable columns', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: {
        title: 'Other nullable columns',
        location_id: '',
        assigned_to: '',
        assigned_team_id: '',
      },
      resolvedBillingProfileId: null,
      attributes: null,
    });

    expect(row.location_id).toBeNull();
    expect(row.assigned_to).toBeNull();
    expect(row.assigned_team_id).toBeNull();
  });

  it('ignores arbitrary input keys so generated and non-input columns cannot be supplied', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: {
        title: 'Rogue input',
        ticket_id: '99999999-9999-4999-8999-999999999999',
        tenant: '99999999-9999-4999-8999-999999999999',
        ticket_number: 'HACKED',
        is_closed: true,
        closed_at: '2026-09-19T12:00:00.000Z',
        updated_by: UUID.contact,
        closed_by: UUID.contact,
      } as never,
      resolvedBillingProfileId: null,
      attributes: null,
    });

    expect(row.ticket_id).toBe(BASE.ticket_id);
    expect(row.tenant).toBe(BASE.tenant);
    expect(row.ticket_number).toBe(BASE.ticket_number);
    expect(row.is_closed).toBeUndefined();
    expect(row.closed_at).toBeUndefined();
    expect(row.updated_by).toBeUndefined();
    expect(row.closed_by).toBeUndefined();
  });

  it('preserves contact rename and description-to-attributes transformation', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: {
        title: 'Transform compatibility',
        contact_id: UUID.contact,
        description: 'Body text',
        attributes: { source_key: 'value' },
      },
      resolvedBillingProfileId: null,
      attributes: { source_key: 'value', description: 'Body text' },
    });

    expect(row.contact_name_id).toBe(UUID.contact);
    expect(row.attributes).toEqual({ source_key: 'value', description: 'Body text' });
  });
});

describe('shared ticket schema retention', () => {
  it('keeps classification references through ticketSchema.partial() parsing', () => {
    const parsed = validateData(ticketSchema.partial(), {
      url: UUID.url,
      severity_id: UUID.severity,
      urgency_id: UUID.urgency,
      impact_id: UUID.impact,
    }) as Record<string, unknown>;

    expect(parsed.url).toBe(UUID.url);
    expect(parsed.severity_id).toBe(UUID.severity);
    expect(parsed.urgency_id).toBe(UUID.urgency);
    expect(parsed.impact_id).toBe(UUID.impact);
  });

  it('rejects an empty classification string rather than persisting it as null', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: { title: 'Empty severity', severity_id: '' },
      resolvedBillingProfileId: null,
      attributes: null,
    });

    expect(row.severity_id).toBe('');
    expect(() => validateData(ticketSchema.partial(), row)).toThrow(/severity_id/);
  });
});

describe('REST create/update schema retention', () => {
  it('accepts url and the three classification UUIDs on create without dropping them', () => {
    const parsed = createTicketSchema.parse({
      title: 'API create',
      url: UUID.url,
      board_id: UUID.tenant,
      client_id: UUID.tenant,
      status_id: UUID.tenant,
      priority_id: UUID.tenant,
      severity_id: UUID.severity,
      urgency_id: UUID.urgency,
      impact_id: UUID.impact,
    });

    expect(parsed.url).toBe(UUID.url);
    expect(parsed.severity_id).toBe(UUID.severity);
    expect(parsed.urgency_id).toBe(UUID.urgency);
    expect(parsed.impact_id).toBe(UUID.impact);
  });

  it('rejects malformed classification UUIDs on create', () => {
    expect(
      createTicketSchema.safeParse({
        title: 'API create',
        board_id: UUID.tenant,
        client_id: UUID.tenant,
        status_id: UUID.tenant,
        priority_id: UUID.tenant,
        severity_id: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  it('keeps classification references create-only while URL updates still parse', () => {
    const parsed = updateTicketSchema.parse({
      url: 'https://support.example.com/tickets/updated',
      severity_id: UUID.severity,
    }) as Record<string, unknown>;

    expect(parsed.url).toBe('https://support.example.com/tickets/updated');
    expect(parsed.severity_id).toBeUndefined();
  });
});

describe('OpenAPI create body contract', () => {
  const registry = createRegistry();
  registerWorkManagementV1Routes(registry);
  const document = registry.buildDocument({
    title: 'Ticket create OpenAPI contract',
    version: '1.0.0',
    edition: 'ce',
  });
  const createBody = (document.components?.schemas as Record<string, any> | undefined)
    ?.WorkV1CreateTicketBody;
  const requiredRuntimeFields = {
    title: 'API create',
    board_id: UUID.tenant,
    client_id: UUID.tenant,
    status_id: UUID.tenant,
    priority_id: UUID.tenant,
  };

  it('declares url as a non-nullable format=uri string matching createTicketSchema', () => {
    const urlSchema = createBody?.properties?.url;
    expect(urlSchema).toMatchObject({ type: 'string', format: 'uri' });

    // Runtime contract the declaration must mirror: omit or valid URL passes,
    // null is rejected.
    expect(createTicketSchema.safeParse(requiredRuntimeFields).success).toBe(true);
    expect(
      createTicketSchema.safeParse({ ...requiredRuntimeFields, url: UUID.url }).success,
    ).toBe(true);
    expect(
      createTicketSchema.safeParse({ ...requiredRuntimeFields, url: null }).success,
    ).toBe(false);

    expect(urlSchema.type).not.toContain('null');
    expect(urlSchema.anyOf).toBeUndefined();
    expect(String(urlSchema.description ?? '')).not.toMatch(/http\(s\)/i);
  });

  it('declares the three classification refs as optional, non-nullable UUIDs', () => {
    expect(
      createTicketSchema.safeParse({ ...requiredRuntimeFields, severity_id: null }).success,
    ).toBe(false);

    for (const key of ['severity_id', 'urgency_id', 'impact_id'] as const) {
      expect(createBody?.properties?.[key]).toMatchObject({ type: 'string', format: 'uuid' });
      expect(createBody?.required ?? []).not.toContain(key);
    }
  });
});
