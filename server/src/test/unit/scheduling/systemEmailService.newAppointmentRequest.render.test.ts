/**
 * alga-2026-0002367: the "New Appointment Request" email must carry a usable
 * Review & Approve link in the text/plain part and a literal subject.
 *
 * This lives under server/ because packages/email does not (and should not)
 * depend on @alga-psa/scheduling, while server can reach the scheduling link
 * helper, the migration template source and the email package.
 *
 * It drives the REAL template (migration source) through the REAL
 * SystemEmailService.sendNewAppointmentRequest; only the DB lookup and the
 * providers are mocked. Both the portal action (appointmentRequestActions.ts)
 * and the public route (api/public/appointment-request/route.ts) call this
 * one sender, so it covers both paths' rendering.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ row: null as null | Record<string, string> }));

vi.mock('@alga-psa/db', () => {
  const chain: any = { where: () => chain, first: async () => hoisted.row };
  return {
    getConnection: vi.fn(async () => ({})),
    tenantDb: vi.fn(() => ({ table: () => chain })),
  };
});
vi.mock('../../../../../packages/email/src/system/SystemEmailProviderFactory', () => ({
  SystemEmailProviderFactory: {
    getConfigFingerprint: () => 'render-test',
    createProvider: async () => ({ providerId: 'p', providerType: 'smtp', sendEmail: async () => ({ success: true }) }),
  },
}));
vi.mock('../../../../../packages/email/src/TenantEmailService', () => ({
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => false, sendEmail: vi.fn() }) },
}));

import { SystemEmailService } from '../../../../../packages/email/src/system/SystemEmailService';
import { buildAppointmentRequestReviewUrl } from '@alga-psa/scheduling/lib/appointmentRequestLinks';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getTemplate } = require('../../../../migrations/utils/templates/email/appointments/newAppointmentRequest.cjs');

const REQUEST_ID = '3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64';

describe('new-appointment-request rendering through SystemEmailService', () => {
  const service = SystemEmailService.getInstance();
  const send = vi.spyOn(service, 'sendEmail');

  beforeEach(() => {
    const en = getTemplate().translations.find((t: any) => t.language === 'en');
    hoisted.row = { subject: en.subject, html_content: en.htmlContent, text_content: en.textContent };
    send.mockReset();
    send.mockResolvedValue({ success: true });
  });

  const data = (over: Record<string, unknown> = {}) => ({
    requesterName: 'Rae Requester',
    requesterEmail: 'rae@example.test',
    clientName: 'Acme',
    serviceName: 'Network Support',
    requestedDate: '2026-10-07',
    requestedTime: '10:00 (UTC)',
    duration: 60,
    approvalLink: buildAppointmentRequestReviewUrl(REQUEST_ID),
    ...over,
  }) as any;

  it('keeps ?requestId=<uuid> literal in the text part (no &#x3D;)', async () => {
    await service.sendNewAppointmentRequest('staff@example.test', data());
    const sent = send.mock.calls[0][0];
    expect(sent.text).toContain(`?requestId=${REQUEST_ID}`);
    expect(sent.text).not.toContain('&#x3D;');
  });

  it('renders the subject literally but still HTML-escapes the html part', async () => {
    await service.sendNewAppointmentRequest('staff@example.test', data({ clientName: 'Smith & "Sons"' }));
    const sent = send.mock.calls[0][0];
    expect(sent.subject).toContain('Smith & "Sons"');
    expect(sent.subject).not.toContain('&amp;');
    expect(sent.html).toContain('Smith &amp; &quot;Sons&quot;');
    expect(sent.html).not.toContain('Smith & "Sons"');
  });

  it('portal action and public route both pass the helper-built link to this sender', () => {
    // Source-level assertion: the portal action has no unit harness, so pin the wiring.
    const root = path.resolve(__dirname, '../../../../..');
    const portal = readFileSync(path.join(root, 'packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts'), 'utf8');
    const route = readFileSync(path.join(root, 'server/src/app/api/public/appointment-request/route.ts'), 'utf8');
    expect(portal).toMatch(/sendNewAppointmentRequest\([\s\S]*?approvalLink: buildAppointmentRequestReviewUrl\(appointmentRequest\.appointment_request_id\)/);
    expect(route).toMatch(/sendNewAppointmentRequest\([\s\S]*?approvalLink: buildAppointmentRequestReviewUrl\(appointmentRequestId\)/);
  });
});
