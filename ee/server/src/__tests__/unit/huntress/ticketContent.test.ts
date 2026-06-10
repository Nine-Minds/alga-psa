import { describe, expect, it } from 'vitest';
import {
  buildPortalUrl,
  buildTicketTitle,
  buildTicketBody,
  buildCreationNote,
  buildUpdateNote,
} from '@ee/lib/integrations/huntress/incidents/ticketContent';
import type {
  HuntressAgent,
  HuntressIncidentReport,
} from '@ee/interfaces/huntress.interfaces';

const incident: HuntressIncidentReport = {
  id: 42,
  account_id: 1,
  agent_id: 7,
  organization_id: 9,
  subject: 'CRITICAL - Incident on SRV01 (Acme)',
  summary: 'Huntress detected a malicious scheduled task.',
  body: null,
  severity: 'critical',
  status: 'sent',
  platform: 'windows',
  indicator_types: ['footholds', 'process_detections'],
  indicator_counts: { footholds: 1, process_detections: 2 },
  remediations: {
    total_count: 1,
    has_more: false,
    items: [
      {
        id: 1,
        type: 'manual',
        action: 'Delete File',
        status: 'pending',
        parameters: [{ name: 'path', description: 'c:\\bad\\task' }],
      },
    ],
  },
  sent_at: '2026-06-09T10:00:00Z',
  closed_at: null,
  status_updated_at: '2026-06-09T10:00:00Z',
  updated_at: '2026-06-09T10:00:00Z',
};

const agent: HuntressAgent = {
  id: 7,
  hostname: 'SRV01',
  os: 'Windows Server 2022',
  ipv4_address: '10.0.0.5',
  external_ip: '203.0.113.9',
  serial_number: 'SN-123',
  last_callback_at: '2026-06-09T09:55:00Z',
};

describe('buildPortalUrl', () => {
  it('uses the account subdomain when known', () => {
    expect(buildPortalUrl('acme', 42)).toBe('https://acme.huntress.io/incident_reports/42');
  });

  it('falls back to the bare portal domain without a subdomain', () => {
    expect(buildPortalUrl(undefined, 42)).toBe('https://huntress.io/incident_reports/42');
  });
});

describe('buildTicketTitle', () => {
  it('prefixes the Huntress subject', () => {
    expect(buildTicketTitle(incident, { unmapped: false })).toBe(
      '[Huntress] CRITICAL - Incident on SRV01 (Acme)'
    );
  });

  it('adds an unmapped-org marker', () => {
    expect(buildTicketTitle(incident, { unmapped: true })).toBe(
      '[Huntress] [Unmapped Org] CRITICAL - Incident on SRV01 (Acme)'
    );
  });

  it('synthesizes a title when subject is missing', () => {
    expect(buildTicketTitle({ ...incident, subject: null }, { unmapped: false })).toBe(
      '[Huntress] critical incident #42'
    );
  });
});

describe('buildTicketBody', () => {
  const url = buildPortalUrl('acme', incident.id);

  it('contains severity, summary, indicators, host details, remediations, and the portal link', () => {
    const body = buildTicketBody(incident, agent, url, { unmapped: false });
    expect(body).toContain('**Severity:** critical');
    expect(body).toContain('Huntress detected a malicious scheduled task.');
    expect(body).toContain('footholds (1)');
    expect(body).toContain('process_detections (2)');
    expect(body).toContain('**Hostname:** SRV01');
    expect(body).toContain('**Internal IP:** 10.0.0.5');
    expect(body).toContain('Delete File');
    expect(body).toContain('c:\\bad\\task');
    expect(body).toContain('https://acme.huntress.io/incident_reports/42');
  });

  it('shows the organization section instead of host when no agent (e.g. M365 incidents)', () => {
    const body = buildTicketBody(incident, null, url, { unmapped: false, orgName: 'Acme' });
    expect(body).not.toContain('**Hostname:**');
    expect(body).toContain('**Huntress Organization:** Acme');
  });

  it('prepends an unmapped-org warning when unmapped', () => {
    const body = buildTicketBody(incident, agent, url, { unmapped: true, orgName: 'Acme' });
    expect(body).toContain('not mapped to a client');
    expect(body).toContain('Acme');
  });
});

describe('buildCreationNote', () => {
  it('records the raw incident identifiers', () => {
    const note = buildCreationNote(incident);
    expect(note).toContain('Incident ID: 42');
    expect(note).toContain('Severity: critical');
    expect(note).toContain('Status: sent');
  });
});

describe('buildUpdateNote', () => {
  it('describes a status transition', () => {
    const note = buildUpdateNote('sent', { ...incident, status: 'closed' });
    expect(note).toContain('sent');
    expect(note).toContain('closed');
  });

  it('still produces a note when only updated_at changed', () => {
    const note = buildUpdateNote('sent', incident);
    expect(note).toContain('updated');
  });
});
