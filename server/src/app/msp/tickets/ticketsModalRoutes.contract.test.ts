import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('tickets modal route infrastructure', () => {
  it('keeps list and detail composition clients on separate import entrypoints', () => {
    const listPage = read('server/src/app/msp/tickets/page.tsx');
    const detailPage = read('server/src/app/msp/tickets/[id]/page.tsx');

    expect(listPage).toContain(
      "import MspTicketsPageClient from '@alga-psa/msp-composition/tickets/MspTicketsPageClient'",
    );
    expect(listPage).not.toContain("from '@alga-psa/msp-composition/tickets'");
    expect(listPage).not.toContain('MspTicketDetailsContainerClient');

    expect(detailPage).toContain(
      "import MspTicketDetailsContainerClient from '@alga-psa/msp-composition/tickets/MspTicketDetailsContainerClient'",
    );
  });

  it('renders the tickets page and modal slot inside the shared tickets provider', () => {
    const layout = read('server/src/app/msp/tickets/layout.tsx');

    expect(layout).toContain('TicketsRouteProvider');
    expect(layout).toContain('{children}');
    expect(layout).toContain('{modal}');
  });

  it('keeps the default modal slot closed on normal tickets list loads', () => {
    const defaultSlot = read('server/src/app/msp/tickets/@modal/default.tsx');

    expect(defaultSlot).toContain('return null');
  });

  it('routes Import through plain and intercepted route entries', () => {
    const plainRoute = read('server/src/app/msp/tickets/import/page.tsx');
    const modalRoute = read('server/src/app/msp/tickets/@modal/(.)import/page.tsx');
    const routeClient = read('server/src/app/msp/tickets/_components/TicketImportDialogRouteClient.tsx');
    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');

    expect(plainRoute).toContain('closeMode="replace"');
    expect(modalRoute).toContain('closeMode="back"');
    expect(routeClient).toContain('TicketImportDialog');
    expect(routeClient).toContain('router.back()');
    expect(routeClient).toContain("router.replace('/msp/tickets')");
    expect(dashboard).toContain("router.push('/msp/tickets/import')");
    expect(dashboard).not.toContain("import TicketImportDialog from './TicketImportDialog'");
    expect(dashboard).not.toContain('<TicketImportDialog');
  });

  it('routes Export through context-backed plain and intercepted route entries', () => {
    const plainRoute = read('server/src/app/msp/tickets/export/page.tsx');
    const modalRoute = read('server/src/app/msp/tickets/@modal/(.)export/page.tsx');
    const routeClient = read('server/src/app/msp/tickets/_components/TicketExportDialogRouteClient.tsx');
    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');

    expect(plainRoute).toContain('closeMode="replace"');
    expect(modalRoute).toContain('closeMode="back"');
    expect(routeClient).toContain('TicketExportDialog');
    expect(routeClient).toContain('useTicketsRouteState');
    expect(routeClient).toContain('filters={filters}');
    expect(routeClient).toContain('selectedTicketIds={selectedTicketIdsArray}');
    expect(dashboard).toContain("router.push('/msp/tickets/export')");
    expect(dashboard).not.toContain("import TicketExportDialog from './TicketExportDialog'");
    expect(dashboard).not.toContain('<TicketExportDialog');
  });

  it('shares active filters and selected ticket ids through the route context', () => {
    const provider = read('packages/tickets/src/components/TicketsRouteProvider.tsx');
    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');

    expect(provider).toContain('filters: ITicketListFilters');
    expect(provider).toContain('totalCount: number');
    expect(provider).toContain('selectedTicketIds: Set<string>');
    expect(provider).toContain('selectedTicketIdsArray');
    expect(provider).toContain('selectedTicketDetails: TicketsRouteSelectedTicketDetail[]');
    expect(provider).toContain('selectedTicketsSharedBoardId: string | null');
    expect(provider).toContain('priorityOptions: SelectOption[]');
    expect(dashboard).toContain('useTicketsRouteState()');
    expect(dashboard).toContain('setTicketsRouteFilters(exportFilters)');
    expect(dashboard).toContain('setTicketsRouteTotalCount(totalCount)');
    expect(dashboard).toContain('setSelectedTicketIds');
    expect(dashboard).toContain('setTicketsRouteSelectedTicketDetails(selectedTicketDetails)');
    expect(dashboard).toContain('setTicketsRouteSelectedTicketsSharedBoardId(selectedTicketsSharedBoardId)');
    expect(dashboard).toContain('setTicketsRoutePriorityOptions(priorityOptions)');
  });

  it('routes all extracted bulk dialogs through plain and intercepted entries', () => {
    const cases = [
      ['bulk-assign', 'BulkAssignTicketsRouteContent', 'BulkAssignTicketsDialog', 'bulkAssignTickets'],
      ['bulk-tags', 'BulkAddTagsRouteClient', 'BulkAddTagsDialog', 'bulkAddTagsToTickets(selectedTicketIdsArray, tagTexts)'],
      ['bulk-due-date', 'BulkSetDueDateRouteClient', 'BulkSetDueDateDialog', 'bulkUpdateTicketDueDate'],
      ['bulk-status', 'BulkChangeStatusRouteClient', 'BulkChangeStatusDialog', 'bulkUpdateTicketStatus'],
      ['bulk-priority', 'BulkChangePriorityRouteClient', 'BulkChangePriorityDialog', 'bulkUpdateTicketPriority'],
    ] as const;

    for (const [segment, routeComponent, dialogName, actionCall] of cases) {
      const plainRoute = read(`server/src/app/msp/tickets/${segment}/page.tsx`);
      const modalRoute = read(`server/src/app/msp/tickets/@modal/(.)${segment}/page.tsx`);

      expect(plainRoute).toContain('closeMode="replace"');
      expect(plainRoute).toContain(routeComponent);
      expect(modalRoute).toContain('closeMode="back"');
      expect(modalRoute).toContain(routeComponent);

      const routeClientPath = segment === 'bulk-assign'
        ? 'server/src/app/msp/tickets/_components/BulkAssignTicketsRouteClient.tsx'
        : segment === 'bulk-tags'
          ? 'server/src/app/msp/tickets/_components/BulkAddTagsRouteClient.tsx'
          : segment === 'bulk-due-date'
            ? 'server/src/app/msp/tickets/_components/BulkSetDueDateRouteClient.tsx'
            : segment === 'bulk-status'
              ? 'server/src/app/msp/tickets/_components/BulkChangeStatusRouteClient.tsx'
              : 'server/src/app/msp/tickets/_components/BulkChangePriorityRouteClient.tsx';
      const routeClient = read(routeClientPath);

      expect(routeClient).toContain(dialogName);
      expect(routeClient).toContain('useTicketBulkRouteDialog(closeMode)');
      expect(routeClient).toContain(actionCall);
      expect(routeClient).toContain('keepFailedSelection(result.failed)');
      expect(routeClient).toContain('refreshList()');
      expect(routeClient).toContain('refreshAndClose()');
    }
  });

  it('keeps the bulk action bar in the list while navigating to bulk modal routes', () => {
    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');

    expect(dashboard).toContain('<BulkTicketActionBar');
    expect(dashboard).toContain("router.push('/msp/tickets/bulk-assign')");
    expect(dashboard).toContain("router.push('/msp/tickets/bulk-tags')");
    expect(dashboard).toContain("router.push('/msp/tickets/bulk-due-date')");
    expect(dashboard).toContain("router.push('/msp/tickets/bulk-status')");
    expect(dashboard).toContain("router.push('/msp/tickets/bulk-priority')");
  });

  it('threads optional notification suppression through eligible bulk dialogs and excludes tag writes', () => {
    const routedBulkClients = [
      ['server/src/app/msp/tickets/_components/BulkAssignTicketsRouteClient.tsx', 'bulkAssignTickets(selectedTicketIdsArray, selection, options)'],
      ['server/src/app/msp/tickets/_components/BulkSetDueDateRouteClient.tsx', 'bulkUpdateTicketDueDate(selectedTicketIdsArray, dueDateIso, options)'],
      ['server/src/app/msp/tickets/_components/BulkChangeStatusRouteClient.tsx', 'bulkUpdateTicketStatus(selectedTicketIdsArray, statusId, options)'],
      ['server/src/app/msp/tickets/_components/BulkChangePriorityRouteClient.tsx', 'bulkUpdateTicketPriority(selectedTicketIdsArray, priorityId, options)'],
    ] as const;

    for (const [routeClientPath, silentCall] of routedBulkClients) {
      const routeClient = read(routeClientPath);

      expect(routeClient).toContain('type TicketNotificationSuppressionOptions');
      expect(routeClient).toContain('options?: TicketNotificationSuppressionOptions');
      expect(routeClient).toContain(silentCall);
    }

    for (const dialogPath of [
      'packages/tickets/src/components/BulkAssignTicketsDialog.tsx',
      'packages/tickets/src/components/BulkSetDueDateDialog.tsx',
      'packages/tickets/src/components/BulkChangeStatusDialog.tsx',
      'packages/tickets/src/components/BulkChangePriorityDialog.tsx',
    ]) {
      const dialog = read(dialogPath);

      expect(dialog).toContain('TicketNotificationSuppressionControl');
      expect(dialog).toContain('suppressContactNotifications: false');
      expect(dialog).toContain('setNotificationSuppression');
    }

    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');
    expect(dashboard).toContain('TicketNotificationSuppressionControl');
    expect(dashboard).toContain('bulkMoveNotificationSuppression.suppressContactNotifications');
    expect(dashboard).toContain('moveTicketsToBoard(');

    const tagRoute = read('server/src/app/msp/tickets/_components/BulkAddTagsRouteClient.tsx');
    const tagDialog = read('packages/tickets/src/components/BulkAddTagsDialog.tsx');
    expect(tagRoute).not.toContain('TicketNotificationSuppressionOptions');
    expect(tagDialog).not.toContain('TicketNotificationSuppressionControl');
  });

  it('keeps select-all-matching selections in the shared selected id set for routed bulk actions', () => {
    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');

    expect(dashboard).toContain('const allIds = await getAllMatchingTicketIds(filters)');
    expect(dashboard).toContain('setSelectedTicketIds(new Set(allIds))');
    expect(dashboard).toContain('setAllMatchingMode(true)');
  });

  it('retains failed-ticket selection after partial bulk failures', () => {
    for (const routeClientPath of [
      'server/src/app/msp/tickets/_components/BulkAssignTicketsRouteClient.tsx',
      'server/src/app/msp/tickets/_components/BulkAddTagsRouteClient.tsx',
      'server/src/app/msp/tickets/_components/BulkSetDueDateRouteClient.tsx',
      'server/src/app/msp/tickets/_components/BulkChangeStatusRouteClient.tsx',
      'server/src/app/msp/tickets/_components/BulkChangePriorityRouteClient.tsx',
    ]) {
      const routeClient = read(routeClientPath);

      expect(routeClient).toContain('setFailed(result.failed)');
      expect(routeClient).toContain('keepFailedSelection(result.failed)');
    }
  });

  it('does not import the extracted bulk dialogs into the tickets dashboard', () => {
    const dashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');

    for (const dialogName of [
      'BulkAssignTicketsDialog',
      'BulkAddTagsDialog',
      'BulkSetDueDateDialog',
      'BulkChangeStatusDialog',
      'BulkChangePriorityDialog',
    ]) {
      expect(dashboard).not.toContain(dialogName);
    }
  });

  it('keeps routed import/export/bulk mutations on existing tenant-scoped server actions', () => {
    const bulkActions = read('packages/tickets/src/actions/ticketActions.ts');
    const importActions = read('packages/tickets/src/actions/ticketImportActions.ts');
    const exportActions = read('packages/tickets/src/actions/ticketExportActions.ts');

    for (const actionName of [
      'bulkAssignTickets',
      'bulkAddTagsToTickets',
      'bulkUpdateTicketDueDate',
      'bulkUpdateTicketStatus',
      'bulkUpdateTicketPriority',
    ]) {
      expect(bulkActions).toContain(`export const ${actionName} = withAuth(async (`);
    }
    expect(bulkActions).toContain('{ tenant }');
    expect(bulkActions).toContain('updateTicketInTransaction(trx, user as IUserWithRoles, tenant');
    expect(bulkActions).toContain("createTagsForEntityWithTransaction(trx, tenant, ticketId, 'ticket'");

    expect(importActions).toContain('export const importTickets = withAuth(async (');
    expect(importActions).toContain('CreateTicketInput');
    expect(importActions).toContain('createTicket(');
    expect(importActions).toContain('tenant, trx');

    expect(exportActions).toContain('export const exportTicketsToCSV = withAuth(async (');
    expect(exportActions).toContain('{ tenant }');
    expect(exportActions).toContain('getTicketsForList(filters');
    expect(exportActions).toContain('resolveNameLookups(tickets, tenant)');
  });
});
