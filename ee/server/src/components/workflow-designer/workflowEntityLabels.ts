'use client';

import { useEffect, useState } from 'react';

import { getTicketFieldOptions } from '@alga-psa/integrations/actions';
import { getTeamsBasic, isTeamActionError } from '@alga-psa/teams/actions';

/**
 * Display names for entity ids that workflow definitions store (boards, statuses, priorities,
 * categories, clients, users, locations, teams). Ids are uuids, so one id → name map serves every
 * kind without knowing which kind a value is. Loaded once per page and shared by every caller.
 */
export type WorkflowEntityLabelMap = ReadonlyMap<string, string>;

let entityLabelsPromise: Promise<WorkflowEntityLabelMap> | null = null;
// Kept once loaded, so callers that mount later have names on their first render.
let loadedEntityLabels: WorkflowEntityLabelMap | null = null;

const loadEntityLabels = async (): Promise<WorkflowEntityLabelMap> => {
  const labels = new Map<string, string>();
  const [fieldOptionsResult, teamsResult] = await Promise.all([
    getTicketFieldOptions(),
    getTeamsBasic(),
  ]);

  const options = 'options' in fieldOptionsResult ? fieldOptionsResult.options : null;
  if (options) {
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

  return labels;
};

export const loadWorkflowEntityLabels = (): Promise<WorkflowEntityLabelMap> => {
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
};

const EMPTY_LABELS: WorkflowEntityLabelMap = new Map();

export const useWorkflowEntityLabels = (enabled = true): WorkflowEntityLabelsState => {
  const [state, setState] = useState<WorkflowEntityLabelsState>(() =>
    loadedEntityLabels ? { labels: loadedEntityLabels, loaded: true } : { labels: EMPTY_LABELS, loaded: false }
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadWorkflowEntityLabels()
      .then((loaded) => {
        if (active) setState({ labels: loaded, loaded: true });
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
