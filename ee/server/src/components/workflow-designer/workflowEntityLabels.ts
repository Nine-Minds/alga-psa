'use client';

import { useEffect, useState } from 'react';

import { getTicketFieldOptions } from '@alga-psa/integrations/actions';
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
      options.clients,
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

export const useWorkflowEntityLabels = (enabled = true): WorkflowEntityLabelsState => {
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

  return state;
};
