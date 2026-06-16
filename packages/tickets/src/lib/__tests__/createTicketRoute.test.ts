import { describe, expect, it } from 'vitest';
import {
  CREATE_TICKET_PATH,
  buildCreateTicketHref,
  parseCreateTicketPrefill,
  type CreateTicketPrefill,
} from '../createTicketRoute';

// Parse the query string a built href produces, the way the route's server component does.
function roundTrip(prefill: CreateTicketPrefill): CreateTicketPrefill {
  const href = buildCreateTicketHref(prefill);
  const qs = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  const params = new URLSearchParams(qs);
  const obj: Record<string, string> = {};
  params.forEach((v, k) => { obj[k] = v; });
  return parseCreateTicketPrefill(obj);
}

describe('createTicketRoute href encode/decode', () => {
  it('returns the bare path when there is no prefill', () => {
    expect(buildCreateTicketHref()).toBe(CREATE_TICKET_PATH);
    expect(buildCreateTicketHref({})).toBe(CREATE_TICKET_PATH);
  });

  it('round-trips a full prefill (client, contact, asset, fields, agents, algadesk)', () => {
    const prefill: CreateTicketPrefill = {
      client: { id: 'c1', name: 'Acme Corp' },
      contact: { id: 'p1', name: 'Jane Doe' },
      assetId: 'a1',
      assetName: 'Server-01',
      title: 'Disk full',
      description: 'Root volume at 98%',
      assignedTo: 'u1',
      dueDate: '2026-07-01',
      additionalAgents: [{ user_id: 'u2', name: 'Bob' }],
      isAlgaDeskMode: true,
    };
    expect(roundTrip(prefill)).toEqual(prefill);
  });

  it('preserves values needing URL encoding (spaces, ampersands, unicode)', () => {
    const prefill: CreateTicketPrefill = {
      client: { id: 'c2', name: 'A & B, Inc. — São' },
      title: 'login fails when query has ?x=1&y=2',
    };
    const out = roundTrip(prefill);
    expect(out.client).toEqual(prefill.client);
    expect(out.title).toBe(prefill.title);
  });

  it('omits empty/false fields from the URL', () => {
    const href = buildCreateTicketHref({ isAlgaDeskMode: false, title: '' });
    expect(href).toBe(CREATE_TICKET_PATH);
  });

  it('ignores a malformed agents param instead of throwing', () => {
    const result = parseCreateTicketPrefill({ agents: 'not-json' });
    expect(result.additionalAgents).toBeUndefined();
  });
});
