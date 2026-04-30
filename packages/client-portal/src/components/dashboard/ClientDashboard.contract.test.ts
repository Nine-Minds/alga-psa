import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './ClientDashboard.tsx'),
  'utf8',
);

describe('ClientDashboard quick-action distribution contract', () => {
  it('does NOT put the quick-action buttons in the hero block', () => {
    // Hero quick-action IDs were removed; presence of any of these would mean we regressed.
    expect(source).not.toContain('dashboard-quick-create-ticket');
    expect(source).not.toContain('dashboard-quick-service-request');
    expect(source).not.toContain('dashboard-quick-request-appointment');
  });

  it('attaches quick-actions to the matching KPI cards (not the broken service-request one)', () => {
    expect(source).toContain('kpi-open-tickets-create');
    expect(source).toContain('kpi-upcoming-visits-request');
    // Old broken action on Active Projects card has been removed.
    expect(source).not.toContain('kpi-active-projects-service-request');
  });

  it('renders a separate Service Requests KPI card with a server-counted value', () => {
    expect(source).toMatch(/id:\s*['"]service-requests['"]/);
    expect(source).toContain('metrics.serviceRequests');
    expect(source).toContain("href: '/client-portal/request-services'");
  });

  it('still mounts both modals so the card actions can open them', () => {
    expect(source).toContain('<ClientAddTicket');
    expect(source).toContain('<RequestAppointmentModal');
  });

  it('renders the action as a real Button, not a child of the card Link', () => {
    // The Link should wrap only the metric area, and the Button must live as a sibling
    // so its onClick can fire without triggering the card's navigation.
    expect(source).toMatch(/<Link href=\{card\.href\} className="[^"]*block[^"]*">/);
    expect(source).toMatch(/<Button[\s\S]{0,200}id=\{card\.action\.id\}/);
    // Old anti-pattern (button nested in Link with preventDefault) must be gone.
    expect(source).not.toContain('e.preventDefault()');
  });

  it('removes the duplicate Request Appointment button from the side rail', () => {
    expect(source).not.toContain('dashboard-request-appointment-quick');
  });
});
