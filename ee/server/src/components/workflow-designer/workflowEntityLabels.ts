'use client';

import { useEffect, useMemo, useState } from 'react';

import { getTicketFieldOptions } from '@alga-psa/integrations/actions';
import { searchClientsForPicker } from '@alga-psa/clients/actions/clientPickerActions';
import { lookupClientsByIds } from '@alga-psa/ui/hooks/useClientNames';
import { getTeamsBasic, isTeamActionError } from '@alga-psa/teams/actions';

import type { WorkflowStatusRef } from './workflowStatusGroups';

/**
 * Display names for entity ids that workflow definitions store (boards, statuses, priorities,
 * categories, clients, users, locations, teams). Ids are uuids, so one id → name map serves every
 * kind without knowing which kind a value is. Loaded once per page and shared by every caller.
 */
export type WorkflowEntityLabelMap = ReadonlyMap<string, string>;

/** Every ticket status with its board, so one name on several boards can be told apart. */
export type WorkflowEntityLabelData = { labels: WorkflowEntityLabelMap; statuses: readonly WorkflowStatusRef[] };

let entityLabelsPromise: Promise<WorkflowEntityLabelData> | null = null;
// Kept once loaded, so callers that mount later have names on their first render.
let loadedEntityLabels: WorkflowEntityLabelData | null = null;

const loadEntityLabels = async (): Promise<WorkflowEntityLabelData> => {
  const labels = new Map<string, string>();
  let statuses: WorkflowStatusRef[] = [];
  const [fieldOptionsResult, teamsResult] = await Promise.all([
    getTicketFieldOptions(),
    getTeamsBasic(),
  ]);

  const options = 'options' in fieldOptionsResult ? fieldOptionsResult.options : null;
  if (options) {
    statuses = (options.statuses ?? []).map((status) => ({
      id: status.id,
      name: status.name,
      board_id: status.board_id ?? null,
      board_name: status.board_name ?? null,
    }));
    for (const list of [
      options.boards,
      options.statuses,
      options.priorities,
      options.categories,
      options.users,
      options.locations,
    ]) {
      for (const item of list ?? []) {
        if (item?.id && item.name) labels.set(item.id, item.name);
      }
    }
  }

  if (!isTeamActionError(teamsResult)) {
    for (const team of teamsResult) {
      if (team.team_id && team.team_name) labels.set(team.team_id, team.team_name);
    }
  }

  return { labels, statuses };
};

// Client names are not part of the shared map: the tenant's client list is never loaded. The ids a
// screen shows are looked up once (batched, sized by those ids) and remembered here.
const clientNames = new Map<string, string>();
const clientIdsAsked = new Set<string>();

export const resolveWorkflowClientNames = async (ids: readonly string[]): Promise<ReadonlyMap<string, string>> => {
  const pending = Array.from(new Set(ids.filter((id) => id && !clientIdsAsked.has(id))));
  if (pending.length > 0) {
    pending.forEach((id) => clientIdsAsked.add(id));
    const rows = await lookupClientsByIds(searchClientsForPicker, pending);
    for (const row of rows) clientNames.set(row.client_id, row.client_name);
  }
  return clientNames;
};

export const loadWorkflowEntityLabels = (): Promise<WorkflowEntityLabelData> => {
  if (!entityLabelsPromise) {
    entityLabelsPromise = loadEntityLabels()
      .then((labels) => {
        loadedEntityLabels = labels;
        return labels;
      })
      .catch((error) => {
        entityLabelsPromise = null;
        throw error;
      });
  }
  return entityLabelsPromise;
};

export type WorkflowEntityLabelsState = {
  /** The shared id → name map; empty until it loads (or if loading fails). */
  labels: WorkflowEntityLabelMap;
  /** True once loading has finished, so an id missing from `labels` really has no known name. */
  loaded: boolean;
  /** Ticket statuses with their boards; empty until loaded. */
  statuses?: readonly WorkflowStatusRef[];
};

const EMPTY_LABELS: WorkflowEntityLabelMap = new Map();
const toState = (data: WorkflowEntityLabelData): WorkflowEntityLabelsState => ({
  labels: data.labels,
  statuses: data.statuses,
  loaded: true,
});

/**
 * `clientIds` are the ids on screen that may be clients (e.g. the id literals of a condition); their
 * names are looked up by id and merged into `labels`.
 */
export const useWorkflowEntityLabels = (enabled = true, clientIds: readonly string[] = []): WorkflowEntityLabelsState => {
  const [state, setState] = useState<WorkflowEntityLabelsState>(() =>
    loadedEntityLabels ? toState(loadedEntityLabels) : { labels: EMPTY_LABELS, loaded: false }
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadWorkflowEntityLabels()
      .then((loaded) => {
        if (active) setState(toState(loaded));
      })
      .catch((error) => {
        console.error('Failed to load workflow entity names:', error);
        if (active) setState({ labels: EMPTY_LABELS, loaded: true });
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  const clientIdsKey = clientIds.join(',');
  const [resolvedClients, setResolvedClients] = useState<ReadonlyMap<string, string>>(clientNames);
  useEffect(() => {
    if (!enabled || clientIds.length === 0) return;
    let active = true;
    resolveWorkflowClientNames(clientIds)
      .then((names) => {
        if (active) setResolvedClients(new Map(names));
      })
      .catch((error) => console.error('Failed to load workflow client names:', error));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clientIdsKey]);

  return useMemo(() => {
    if (resolvedClients.size === 0) return state;
    const merged = new Map(resolvedClients);
    state.labels.forEach((name, id) => merged.set(id, name));
    return { ...state, labels: merged };
  }, [state, resolvedClients]);
};
