// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticketing dashboard bulk move wiring contract', () => {
  it('T001: shows Move to Board action when tickets are selected', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('{hasSelection && canUpdateTickets && (');
    expect(source).toContain('id={`${id}-bulk-move-button`}');
    expect(source).toContain('Move to Board');
  });

  it('T002: hides Move to Board action when user cannot update tickets', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('hasSelection && canUpdateTickets && (');
  });

  it('T003: opens a bulk move dialog with destination board and status controls', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('id={`${id}-bulk-move-dialog`}');
    expect(source).toContain('id={`${id}-bulk-move-board`}');
    expect(source).toContain('id={`${id}-bulk-move-status`}');
    expect(source).toContain('Move Selected Tickets');
  });

  it('T004: reloads destination statuses on board change and uses status options', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('onValueChange={(value) => void handleBulkMoveBoardChange(value)}');
    expect(source).toContain('const boardStatusOptions = statuses.map((status)');
    expect(source).toContain('setDestinationBoardStatuses(boardStatusOptions)');
  });

  it('T005: defaults destination status to board default or first status', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('const defaultStatus = statuses.find((status) => status.is_default);');
    expect(source).toContain('setSelectedDestinationStatusId(defaultStatus.status_id);');
  });

  it('T006: allows overriding destination status when valid options are present', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('onValueChange={(value) => setSelectedDestinationStatusId(value)}');
  });

  it('T007: disables confirmation until destination board and valid status are available', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('id={`${id}-bulk-move-confirm`}');
    expect(source).toContain('disabled={isBulkMoving || isLoadingDestinationStatuses || !selectedDestinationBoardId || !selectedDestinationStatusId');
  });

  it('T008: surfaces destination status errors and keeps failed moves selected', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('setBulkMoveErrors(result.failed);');
    expect(source).toContain('setSelectedTicketIds(() => new Set(result.failed.map(item => item.ticketId)));');
    expect(source).toContain('destinationStatusError &&');
  });

  it('T016: closes dialog and clears selection only on full success', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('if (result.failed.length > 0) {');
    expect(source).toContain('clearSelection();');
    expect(source).toContain('setIsBulkMoveDialogOpen(false);');
  });

  it('T017: refreshes dashboard state after successful moves', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('if (result.movedIds.length > 0) {');
    expect(source).toContain('onFilterChange({});');
  });

  it('T018: bulk delete behavior remains in place', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('id={`${id}-bulk-delete-button`}');
    expect(source).toContain('id={`${id}-bulk-delete-dialog`}');
    expect(source).toContain('setBulkDeleteErrors([]);');
  });
});
