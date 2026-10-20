'use client';

import { useEffect, useState } from 'react';
import {
  ActivityType,
  IClient,
  IPriority,
  IStatus,
  ITag,
  ItemType,
  ProjectWithPhases,
  TaggedEntityType,
} from '@alga-psa/types';
import { useActivityCrossFeature } from '@alga-psa/ui/context';
import { getAllPriorities, getStatuses, getAllBoards } from '@alga-psa/reference-data/actions';
import { findAllTagsByType, isTagActionError } from '@alga-psa/tags/actions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export interface ActivityFilterOptions {
  priorities: IPriority[];
  clients: IClient[];
  projects: ProjectWithPhases[];
  boards: Array<{ board_id?: string; board_name?: string }>;
  ticketStatuses: IStatus[];
  ticketTags: ITag[];
  projectTaskTags: ITag[];
}

// The dashboard hosts this hook above any provider-dependent child, so a missing composition
// provider must degrade to "no client/project options" instead of crashing the whole screen.
function useCrossFeatureOrNull(): ReturnType<typeof useActivityCrossFeature> | null {
  try {
    return useActivityCrossFeature();
  } catch {
    return null;
  }
}

/** Option data for `ActivitiesTableFilters`. Priorities load only for a single prioritized type. */
export function useActivityFilterOptions(types: ActivityType[] | undefined): ActivityFilterOptions {
  const ctx = useCrossFeatureOrNull();
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [projects, setProjects] = useState<ProjectWithPhases[]>([]);
  const [boards, setBoards] = useState<Array<{ board_id?: string; board_name?: string }>>([]);
  const [ticketStatuses, setTicketStatuses] = useState<IStatus[]>([]);
  const [ticketTags, setTicketTags] = useState<ITag[]>([]);
  const [projectTaskTags, setProjectTaskTags] = useState<ITag[]>([]);

  // Load priorities when a single prioritized activity type is selected
  useEffect(() => {
    if (types?.length === 1) {
      const type = types[0];
      if (type === ActivityType.TICKET || type === ActivityType.PROJECT_TASK) {
        const itemType = type === ActivityType.TICKET ? 'ticket' : 'project_task';
        getAllPriorities(itemType)
          .then(setPriorities)
          .catch(err => console.error('Error loading priorities:', err));
        return;
      }
    }
    setPriorities([]);
  }, [types]);

  // Load clients for the shared client filter on mount
  useEffect(() => {
    if (!ctx) return;
    ctx.getAllClients(false)
      .then((data: unknown) => {
        if (!isActionPermissionError(data)) {
          setClients(data as IClient[]);
        }
      })
      .catch((err: unknown) => console.error('Error loading clients:', err));
  }, [ctx]);

  // Load projects with phases + statuses for the filter tree on mount
  useEffect(() => {
    if (!ctx) return;
    ctx.getProjectsWithPhases()
      .then((data: unknown) => {
        if (!isActionPermissionError(data)) {
          setProjects(data as ProjectWithPhases[]);
        }
      })
      .catch((err: unknown) => console.error('Error loading projects with phases:', err));
  }, [ctx]);

  // Load boards and ticket statuses on mount
  useEffect(() => {
    Promise.all([
      getAllBoards(true),
      getStatuses('ticket' as ItemType),
    ])
      .then(([boardsData, statusesData]) => {
        setBoards(boardsData || []);
        setTicketStatuses(statusesData || []);
      })
      .catch((err) => console.error('Error loading boards/statuses:', err));
  }, []);

  // Load tags on mount (for both ticket and project task filters)
  useEffect(() => {
    Promise.all([
      findAllTagsByType('ticket' as TaggedEntityType),
      findAllTagsByType('project_task' as TaggedEntityType),
    ])
      .then(([tt, pt]) => {
        if (isTagActionError(tt)) {
          console.error('Error loading ticket tags:', tt);
          setTicketTags([]);
        } else {
          setTicketTags(tt || []);
        }
        if (isTagActionError(pt)) {
          console.error('Error loading project task tags:', pt);
          setProjectTaskTags([]);
        } else {
          setProjectTaskTags(pt || []);
        }
      })
      .catch((err) => console.error('Error loading tags:', err));
  }, []);

  return { priorities, clients, projects, boards, ticketStatuses, ticketTags, projectTaskTags };
}
