/* @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn() }));
vi.mock('@alga-psa/teams/actions/team-actions/teamActions', () => ({ getTeams: vi.fn() }));
vi.mock('@alga-psa/reference-data/actions/priorityActions', () => ({ getPrioritiesByBoardType: vi.fn() }));
vi.mock('@alga-psa/reference-data/actions/status-actions/statusActions', () => ({ getTicketStatuses: vi.fn() }));
vi.mock('../actions/board-actions', () => ({ getAllBoards: vi.fn() }));
vi.mock('../actions/ticketCategoryActions', () => ({ getTicketCategoriesByBoard: vi.fn() }));
vi.mock('../actions/checklists/checklistTemplateActions', () => ({
  getChecklistTemplates: vi.fn(async () => { throw new Error('Permission denied: Cannot view checklist template settings'); }),
  getChecklistTemplateOptionsForEditor: vi.fn(),
}));

import { getAllUsers } from '@alga-psa/user-composition/actions/userQueryActions';
import { getTeams } from '@alga-psa/teams/actions/team-actions/teamActions';
import { getAllBoards } from '../actions/board-actions';
import { getChecklistTemplateOptionsForEditor } from '../actions/checklists/checklistTemplateActions';
import { useTicketFieldReferenceData, type TicketReferenceChecklistTemplate } from './useTicketFieldReferenceData';

const wide: TicketReferenceChecklistTemplate = { template_id: 'wide', name: 'Tenant checklist', client_id: null, client_name: null };
const scoped: TicketReferenceChecklistTemplate = { template_id: 'scoped', name: 'Client checklist', client_id: 'client-a', client_name: 'Client A' };

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAllUsers).mockResolvedValue([{ user_id: 'dispatcher' }] as Awaited<ReturnType<typeof getAllUsers>>);
  vi.mocked(getAllBoards).mockResolvedValue([{ board_id: 'service' }] as Awaited<ReturnType<typeof getAllBoards>>);
  vi.mocked(getTeams).mockResolvedValue([{ team_id: 'dispatch' }] as Awaited<ReturnType<typeof getTeams>>);
  vi.mocked(getChecklistTemplateOptionsForEditor).mockImplementation(async ({ clientId }) => clientId ? [wide, scoped] : [wide]);
});

describe('ticket editor reference loading', () => {
  it('loads dispatcher reference data when administrative checklist reads are denied', async () => {
    const { result } = renderHook(() => useTicketFieldReferenceData('recurring_ticket'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.users).toEqual([{ user_id: 'dispatcher' }]);
    expect(result.current.boards).toEqual([{ board_id: 'service' }]);
    expect(result.current.teams).toEqual([{ team_id: 'dispatch' }]);
    expect(result.current.checklistTemplates).toEqual([wide]);
  });

  it('reloads scoped choices when a recurring client override changes client', async () => {
    const { result, rerender } = renderHook(({ clientId }: { clientId: string | null }) =>
      useTicketFieldReferenceData('recurring_ticket', clientId), { initialProps: { clientId: null as string | null } });
    await waitFor(() => expect(result.current.checklistTemplates).toEqual([wide]));
    rerender({ clientId: 'client-a' });
    await waitFor(() => expect(result.current.checklistTemplates).toEqual([wide, scoped]));
    rerender({ clientId: null });
    await waitFor(() => expect(result.current.checklistTemplates).toEqual([wide]));
  });

  it('loads ticket-template choices through the ticket-template permission context', async () => {
    vi.mocked(getChecklistTemplateOptionsForEditor).mockImplementation(async ({ resource }) => {
      if (resource !== 'ticket_template') throw new Error('Permission denied');
      return [wide];
    });
    const { result } = renderHook(() => useTicketFieldReferenceData('ticket_template'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.checklistTemplates).toEqual([wide]);
  });
});
