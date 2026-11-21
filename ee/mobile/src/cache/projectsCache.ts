import { TtlCache } from "./ttlCache";
import type { ProjectListItem } from "../api/projects";

const LIST_TTL_MS = 60_000;

export type ProjectsCacheValue = {
  items: ProjectListItem[];
  total: number | null;
};

const projectsListCache = new TtlCache<ProjectsCacheValue>({ defaultTtlMs: LIST_TTL_MS });

export function getCachedProjects(key: string): ProjectsCacheValue | null {
  return projectsListCache.get(key);
}

export function setCachedProjects(key: string, value: ProjectsCacheValue): void {
  projectsListCache.set(key, value);
}

export function clearProjectsCache(): void {
  projectsListCache.clear();
}
