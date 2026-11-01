'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IBoard, IPriority, ITeam, ITicketCategory, ITicketStatus, IUser } from '@alga-psa/types';
import { getAllUsers } from '@alga-psa/user-composition/actions/userQueryActions';
import { getTeams } from '@alga-psa/teams/actions/team-actions/teamActions';
import { isTeamActionError } from '@alga-psa/teams/actions/team-actions/teamActionErrors';
import { getPrioritiesByBoardType } from '@alga-psa/reference-data/actions/priorityActions';
import { getTicketStatuses } from '@alga-psa/reference-data/actions/status-actions/statusActions';
import { getAllBoards } from '../actions/board-actions';
import { getTicketCategoriesByBoard } from '../actions/ticketCategoryActions';
import { getChecklistTemplates } from '../actions/checklists/checklistTemplateActions';
import { isChecklistTemplateInScopeForClient } from '@alga-psa/shared/lib/ticketChecklists/scope';
import { unwrapRecurring } from './recurring/recurringUi';

/** What depends on the selected board: its statuses, its priority set and its categories. */
export interface TicketBoardReference {
  statuses: ITicketStatus[];
  priorities: IPriority[];
  categories: ITicketCategory[];
}

export interface TicketReferenceChecklistTemplate {
  template_id: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
}

/**
 * Templates offerable for a ticket of `clientId`: tenant-wide ones plus that client's own.
 * When no single client is known (ticket templates, multi-client recurring defaults) pass
 * null/undefined: client-scoped templates are EXCLUDED, since applying one to a ticket of another
 * client is refused at apply time and the picker must not offer what cannot be applied.
 */
export function checklistTemplatesForClient(
  templates: TicketReferenceChecklistTemplate[],
  clientId: string | null | undefined
): TicketReferenceChecklistTemplate[] {
  return templates.filter((template) => isChecklistTemplateInScopeForClient(template.client_id, clientId));
}

export interface TicketFieldReferenceData {
  loading: boolean;
  error: string | null;
  users: IUser[];
  teams: ITeam[];
  boards: IBoard[];
  /** Active templates with their scope: `client_id` null = tenant-wide. Use `checklistTemplatesForClient` to filter. */
  checklistTemplates: TicketReferenceChecklistTemplate[];
  /** Per-board data, keyed by board id; filled by `ensureBoard`. */
  boardData: Record<string, TicketBoardReference>;
  /** Load (once) the statuses/priorities/categories of a board. */
  ensureBoard: (boardId: string) => Promise<void>;
}

/**
 * Reference data for every editor of ticket fields (ticket template editor, recurring schedule editor and
 * its overrides dialog): the same lookups the quick-add ticket dialog uses, loaded once, plus a per-board
 * cache so every board mentioned is fetched at most once.
 */
export function useTicketFieldReferenceData(): TicketFieldReferenceData {
  const [state, setState] = useState<Omit<TicketFieldReferenceData, 'ensureBoard' | 'boardData'>>({
    loading: true,
    error: null,
    users: [],
    teams: [],
    boards: [],
    checklistTemplates: [],
  });
  const [boardData, setBoardData] = useState<Record<string, TicketBoardReference>>({});
  const inflight = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [users, boards, teams, templates] = await Promise.all([
          getAllUsers(false),
          getAllBoards(),
          getTeams(),
          getChecklistTemplates(),
        ]);
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          users: unwrapRecurring(users),
          boards: unwrapRecurring(boards),
          // Teams are optional context: a viewer without team access can still schedule tickets.
          teams: isTeamActionError(teams) ? [] : teams,
          checklistTemplates: unwrapRecurring(templates).map((template) => ({
            template_id: template.template_id,
            name: template.name,
            client_id: template.client_id ?? null,
            client_name: template.client_name ?? null,
          })),
        });
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureBoard = useCallback(async (boardId: string) => {
    if (!boardId) return;
    const existing = inflight.current.get(boardId);
    if (existing) return existing;
    const load = (async () => {
      const [statuses, priorities, categoryData] = await Promise.all([
        getTicketStatuses(boardId),
        getPrioritiesByBoardType(boardId, 'ticket'),
        getTicketCategoriesByBoard(boardId),
      ]);
      const categories = unwrapRecurring(categoryData);
      setBoardData((current) => ({
        ...current,
        [boardId]: {
          statuses: Array.isArray(statuses) ? statuses : [],
          priorities,
          categories: categories.categories,
        },
      }));
    })().catch((error) => {
      // Let the next call retry rather than caching the failure.
      inflight.current.delete(boardId);
      throw error;
    });
    inflight.current.set(boardId, load);
    return load;
  }, []);

  return { ...state, boardData, ensureBoard };
}
