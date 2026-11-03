import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn() }));
vi.mock('@alga-psa/teams/actions/team-actions/teamActions', () => ({ getTeams: vi.fn() }));
vi.mock('@alga-psa/teams/actions/team-actions/teamActionErrors', () => ({ isTeamActionError: vi.fn() }));
vi.mock('@alga-psa/reference-data/actions/priorityActions', () => ({ getPrioritiesByBoardType: vi.fn() }));
vi.mock('@alga-psa/reference-data/actions/status-actions/statusActions', () => ({ getTicketStatuses: vi.fn() }));
vi.mock('../actions/board-actions', () => ({ getAllBoards: vi.fn() }));
vi.mock('../actions/ticketCategoryActions', () => ({ getTicketCategoriesByBoard: vi.fn() }));
vi.mock('../actions/checklists/checklistTemplateActions', () => ({ getChecklistTemplates: vi.fn() }));

import { checklistTemplatesForClient } from './useTicketFieldReferenceData';

const t = (id: string, client_id: string | null) => ({ template_id: id, name: id, client_id, client_name: client_id ? `Client ${client_id}` : null });
const all = [t('wide', null), t('a', 'A'), t('b', 'B')];

describe('checklistTemplatesForClient', () => {
  it('offers tenant-wide plus the given client\'s templates', () => {
    expect(checklistTemplatesForClient(all, 'A').map((x) => x.template_id)).toEqual(['wide', 'a']);
  });
  it('excludes client-scoped templates when no client is known', () => {
    expect(checklistTemplatesForClient(all, null).map((x) => x.template_id)).toEqual(['wide']);
    expect(checklistTemplatesForClient(all, undefined).map((x) => x.template_id)).toEqual(['wide']);
  });
});
