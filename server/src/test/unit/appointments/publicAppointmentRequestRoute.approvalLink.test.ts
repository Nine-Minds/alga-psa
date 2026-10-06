import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const APPROVER_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';

const hoisted = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; row: Record<string, any> }>,
  sendNewAppointmentRequest: vi.fn(),
  sendAppointmentRequestReceived: vi.fn(),
}));

function makeTable(name: string) {
  const chain: any = {
    insert: async (row: Record<string, any>) => {
      hoisted.inserted.push({ table: name, row });
    },
    first: async () => (name === 'tenants' ? { tenant: TENANT_ID, client_name: 'Acme MSP', suspended_at: null } : undefined),
    where: () => chain,
    whereIn: () => chain,
    select: async () =>
      name === 'users'
        ? [{ user_id: APPROVER_ID, email: 'approver@example.test', first_name: 'Ann', last_name: 'Approver', timezone: 'UTC' }]
        : [],
  };
  return chain;
}

vi.mock('@alga-psa/db', () => ({
  getTenantIdBySlug: vi.fn(),
  resolveEffectiveTimeZone: vi.fn(async () => 'UTC'),
  normalizeIanaTimeZone: vi.fn((tz: string | null) => tz || 'UTC'),
  tenantDb: vi.fn(() => ({ table: (name: string) => makeTable(name) })),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/client-portal/services/availabilityService', () => ({
  getServicesForPublicBooking: vi.fn(async () => [
    { service_id: SERVICE_ID, service_name: 'Network Support', default_duration: 60 },
  ]),
}));
vi.mock('@alga-psa/scheduling/actions', () => ({
  getTenantSettings: vi.fn(async () => ({ contactEmail: 'help@example.test', contactPhone: '555-0100' })),
  formatDate: vi.fn(async (d: string) => d),
  formatTime: vi.fn(async (t: string) => t),
}));
vi.mock('@alga-psa/msp-composition/scheduling/appointmentApprovers', () => ({
  resolveAppointmentApproverUserIds: vi.fn(async () => [APPROVER_ID]),
}));
vi.mock('@alga-psa/email', () => ({
  SystemEmailService: {
    getInstance: () => ({
      sendNewAppointmentRequest: hoisted.sendNewAppointmentRequest,
      sendAppointmentRequestReceived: hoisted.sendAppointmentRequestReceived,
    }),
  },
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('public appointment-request route: staff approvalLink', () => {
  beforeEach(() => {
    hoisted.inserted.length = 0;
    hoisted.sendNewAppointmentRequest.mockReset().mockResolvedValue({ success: true });
    hoisted.sendAppointmentRequestReceived.mockReset().mockResolvedValue({ success: true });
  });

  it('deep-links to the persisted request id and does not expose the id to the caller', async () => {
    const { POST } = await import('@/app/api/public/appointment-request/route');
    const { buildAppointmentRequestReviewUrl } = await import('@alga-psa/scheduling/lib/appointmentRequestLinks');

    const req = new NextRequest('http://localhost/api/public/appointment-request', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({
        tenant: TENANT_ID,
        name: 'Pat Public',
        email: 'pat@example.test',
        service_id: SERVICE_ID,
        requested_date: '2030-01-15',
        requested_time: '14:00',
      }),
    });

    const res = await POST(req);
    const bodyText = await res.text();
    expect(res.status).toBe(200);

    const insert = hoisted.inserted.find((i) => i.table === 'appointment_requests');
    expect(insert).toBeDefined();
    const id = insert!.row.appointment_request_id as string;
    expect(id).toBeTruthy();

    expect(hoisted.sendNewAppointmentRequest).toHaveBeenCalledTimes(1);
    const [to, data] = hoisted.sendNewAppointmentRequest.mock.calls[0];
    expect(to).toBe('approver@example.test');
    expect(data.isAuthenticated).toBe(false);
    expect(data.approvalLink).toBe(buildAppointmentRequestReviewUrl(id));
    expect(data.approvalLink.endsWith(`?requestId=${id}`)).toBe(true);

    const parsed = JSON.parse(bodyText);
    expect(parsed.reference_number).toBeTruthy();
    expect(bodyText).not.toContain(id);
  });
});
