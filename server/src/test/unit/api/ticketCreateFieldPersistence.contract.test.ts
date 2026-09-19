import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  buildTicketCreateRow,
  ticketSchema,
  validateData,
} from '@alga-psa/shared/models/ticketModel';
import { createTicketSchema, updateTicketSchema } from '../../../lib/api/schemas/ticket';

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

describe('REST service forwarding contract', () => {
  const serviceSource = readFileSync(
    resolve(__dirname, '../../../lib/api/services/TicketService.ts'),
    'utf8',
  );

  it('forwards url and the three classification UUIDs into the shared create input', () => {
    const start = serviceSource.indexOf('const createTicketInput: CreateTicketInput = {');
    const end = serviceSource.indexOf('};', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const createInput = serviceSource.slice(start, end);
    expect(createInput).toContain('url: data.url');
    expect(createInput).toContain('severity_id: data.severity_id');
    expect(createInput).toContain('urgency_id: data.urgency_id');
    expect(createInput).toContain('impact_id: data.impact_id');
  });
});
