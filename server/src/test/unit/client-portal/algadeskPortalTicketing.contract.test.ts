import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('Algadesk client portal ticketing contracts', () => {
  it('renders dashboard and ticket list/ticket detail portal surfaces', () => {
    const dashboardPage = read('src/app/client-portal/dashboard/page.tsx');
    const ticketsPage = read('src/app/client-portal/tickets/page.tsx');
    const ticketDetailPage = read('src/app/client-portal/tickets/[ticketId]/page.tsx');

    expect(dashboardPage).toContain('return <ClientDashboard />');
    expect(ticketsPage).toContain('<TicketList />');
    expect(ticketDetailPage).toContain('<TicketDetailsContainer');
  });

  it('uses free-form client ticket creation with title/description/attachments flow', () => {
    const ticketList = read('../packages/client-portal/src/components/tickets/TicketList.tsx');
    const addTicket = read('../packages/client-portal/src/components/tickets/ClientAddTicket.tsx');

    expect(ticketList).toContain('<ClientAddTicket');
    expect(addTicket).toContain("formData.append('title', title)");
    expect(addTicket).toContain("formData.append('description'");
    expect(addTicket).toContain("formData.append('priority_id', priorityId)");
    expect(addTicket).toContain("formData.append('board_id', boardId)");
  });

  it('keeps board visibility-group enforcement in portal ticket actions', () => {
    const ticketActions = read('../packages/client-portal/src/actions/client-portal-actions/client-tickets.ts');

    expect(ticketActions).toContain('resolvePortalVisibility');
    expect(ticketActions).toContain('applyVisibilityBoardFilter');
    expect(ticketActions).toContain('Selected visibility group does not allow any boards');
  });

  it('keeps portal ticket detail authorization and hides internal-comment tab', () => {
    const ticketActions = read('../packages/client-portal/src/actions/client-portal-actions/client-tickets.ts');
    const ticketDetails = read('../packages/client-portal/src/components/tickets/TicketDetails.tsx');

    expect(ticketActions).toContain('resolveVisibleTicket');
    expect(ticketDetails).toContain('hideInternalTab={true}');
    expect(ticketDetails).toContain("if (tab !== 'internal')");
  });

  it('keeps public replies and status display in ticket detail', () => {
    const ticketDetails = read('../packages/client-portal/src/components/tickets/TicketDetails.tsx');
    expect(ticketDetails).toContain('onAddNewComment={handleAddNewComment}');
    expect(ticketDetails).toContain('ResponseStateBadge');
  });

  it('avoids billing/project navigation links from portal ticket pages', () => {
    const ticketList = read('../packages/client-portal/src/components/tickets/TicketList.tsx');
    const ticketDetails = read('../packages/client-portal/src/components/tickets/TicketDetails.tsx');

    expect(ticketList).not.toContain('/client-portal/billing');
    expect(ticketList).not.toContain('/client-portal/projects');
    expect(ticketDetails).not.toContain('/client-portal/billing');
    expect(ticketDetails).not.toContain('/client-portal/projects');
  });
});
