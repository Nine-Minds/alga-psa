/**
 * The project flavor of the smart search wire contract. The Projects list is
 * filtered in the browser over the whole project set, so the scope is the list
 * of chip-filtered project ids the page holds; the server re-authorizes them.
 * Each scored batch carries the project tags the table needs.
 */

import type { IProject, ITag } from '@alga-psa/types';
import type {
  SmartSearchEvent,
  SmartSearchRequestBody,
  SmartSearchScoredItem,
} from '@alga-psa/ui/lib/smartSearch/types';

export interface ProjectSmartSearchScope {
  projectIds: string[];
}

export interface ProjectSmartSearchRowMetadata {
  projectTags: Record<string, ITag[]>;
}

export type ProjectSmartSearchScoredItem = SmartSearchScoredItem<IProject>;
export type ProjectSmartSearchEvent = SmartSearchEvent<IProject, ProjectSmartSearchRowMetadata>;
export type ProjectSmartSearchRequestBody = SmartSearchRequestBody<ProjectSmartSearchScope>;
